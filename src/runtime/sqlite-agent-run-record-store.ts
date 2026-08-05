import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AgentRunEvent,
  AgentRunReference,
  AgentRunState,
} from "./public.js";
import type {
  AgentRunCommandPeek,
  AgentRunMutationKind,
  AgentRunRecord,
  AgentRunRecordStore,
  AgentRunRecordStoreFailureCode,
  AgentRunRecordStoreResult,
  PeekAgentRunCommandRequest,
  RetainAgentRunMutationRequest,
} from "./agent-run-record-store.js";

export type SqliteAgentRunRecordStoreDependencies = Readonly<{
  database_path: string;
  workspace_id: string;
}>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS qa_agent_runs (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL,
    record TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, run_id)
  );

  CREATE TABLE IF NOT EXISTS qa_agent_run_events (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    event TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, run_id, sequence),
    FOREIGN KEY (workspace_id, run_id)
      REFERENCES qa_agent_runs (workspace_id, run_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS qa_agent_run_events_revision
    ON qa_agent_run_events (workspace_id, run_id, revision);

  CREATE TABLE IF NOT EXISTS qa_agent_run_commands (
    workspace_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    command_kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result TEXT NOT NULL,
    retained_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, run_id, command_kind, idempotency_key),
    FOREIGN KEY (workspace_id, run_id)
      REFERENCES qa_agent_runs (workspace_id, run_id)
  );
`;

/**
 * Local-first SQLite adapter (ADR-017, SPEC-410 §5) for Agent Run state: one
 * database file per Workspace, owned exclusively by the parent Agent Runner
 * process. Mirrors SqliteEvaluationCampaignRecordStore's transaction and
 * idempotent-replay shape for the Agent Run aggregate instead of the
 * Evaluation Campaign aggregate.
 */
export class SqliteAgentRunRecordStore implements AgentRunRecordStore {
  readonly #database: DatabaseSync;
  readonly #workspaceId: string;

  constructor(dependencies: SqliteAgentRunRecordStoreDependencies) {
    if (dependencies.workspace_id.trim().length === 0) {
      throw new Error("A Workspace identity is required to open a local Agent Run store.");
    }
    mkdirSync(dirname(dependencies.database_path), { recursive: true });
    this.#workspaceId = dependencies.workspace_id;
    this.#database = new DatabaseSync(dependencies.database_path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(SCHEMA);
  }

  close(): void {
    this.#database.close();
  }

  async retainMutation(
    request: RetainAgentRunMutationRequest,
  ): Promise<AgentRunRecordStoreResult> {
    const retained = immutableCopy(request);
    const invalid = validateMutation(retained);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const { snapshot } = retained.record;
    if (snapshot.workspace_id !== this.#workspaceId) {
      return failed(
        "workspace_denied",
        "The Agent Run record does not belong to this local Workspace database.",
      );
    }
    const event = retained.record.events.at(-1) as AgentRunEvent;

    try {
      return this.#transaction(() => {
        const prior = this.#loadCommand(retained);
        if (prior !== undefined) {
          if (prior.request_digest !== retained.command.request_digest) {
            return failed(
              "idempotency_conflict",
              "The command idempotency key is bound to different input.",
            );
          }
          const priorRecord = decodeRecord(JSON.parse(prior.result), snapshot);
          return priorRecord === undefined
            ? failed("persistence_corrupt", "The retained command result is invalid.")
            : succeeded(priorRecord);
        }

        const mutated = retained.expected_revision === null
          ? this.#insertRun(retained.record)
          : this.#updateRun(retained.record, retained.expected_revision);
        if (!mutated) {
          const winner = this.#loadCommand(retained);
          if (winner !== undefined) {
            if (winner.request_digest !== retained.command.request_digest) {
              return failed(
                "idempotency_conflict",
                "The command idempotency key is bound to different input.",
              );
            }
            const winnerRecord = decodeRecord(JSON.parse(winner.result), snapshot);
            return winnerRecord === undefined
              ? failed("persistence_corrupt", "The retained command result is invalid.")
              : succeeded(winnerRecord);
          }
          return failed(
            "stale_revision",
            "The retained Agent Run revision changed before the mutation committed.",
          );
        }

        this.#requireChanged(
          () =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO qa_agent_run_events
                   (workspace_id, run_id, sequence, revision, event, occurred_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshot.workspace_id,
                snapshot.run_id,
                event.sequence,
                event.sequence,
                JSON.stringify(event),
                event.occurred_at,
              ),
          "run event",
        );
        this.#requireChanged(
          () =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO qa_agent_run_commands
                   (workspace_id, run_id, command_kind, idempotency_key,
                    request_digest, result, retained_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshot.workspace_id,
                snapshot.run_id,
                retained.command.kind,
                retained.command.idempotency_key,
                retained.command.request_digest,
                JSON.stringify(retained.record),
                event.occurred_at,
              ),
          "run command",
        );
        return succeeded(retained.record);
      });
    } catch {
      return failed(
        "persistence_unavailable",
        "The Agent Run mutation transaction could not be committed.",
      );
    }
  }

  async load(reference: AgentRunReference): Promise<AgentRunRecordStoreResult> {
    if (reference.workspace_id.trim().length === 0 || reference.run_id.trim().length === 0) {
      return failed("invalid_request", "Workspace and run identity are required.");
    }
    if (reference.workspace_id !== this.#workspaceId) {
      return failed(
        "workspace_denied",
        "The requested Workspace does not match this local database file.",
      );
    }
    try {
      const row = this.#database
        .prepare(
          `SELECT record FROM qa_agent_runs
            WHERE workspace_id = ? AND run_id = ?`,
        )
        .get(reference.workspace_id, reference.run_id) as { record: string } | undefined;
      if (row === undefined) {
        return failed("not_found", "The Agent Run record was not found.");
      }
      const record = decodeRecord(JSON.parse(row.record), reference);
      return record === undefined
        ? failed("persistence_corrupt", "The retained Agent Run record is invalid.")
        : succeeded(record);
    } catch {
      return failed("persistence_unavailable", "The Agent Run record could not be loaded.");
    }
  }

  async peekCommand(
    request: PeekAgentRunCommandRequest,
  ): Promise<AgentRunCommandPeek | undefined> {
    if (request.workspace_id !== this.#workspaceId) return undefined;
    const row = this.#loadCommandByKey(
      request.workspace_id,
      request.run_id,
      request.kind,
      request.idempotency_key,
    );
    if (row === undefined) return undefined;
    const record = decodeRecord(JSON.parse(row.result), {
      schema_version: "1.0.0",
      workspace_id: request.workspace_id,
      run_id: request.run_id,
    });
    return record === undefined ? undefined : { request_digest: row.request_digest, record };
  }

  #transaction(
    operation: () => AgentRunRecordStoreResult,
  ): AgentRunRecordStoreResult {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #loadCommand(
    request: RetainAgentRunMutationRequest,
  ): { request_digest: string; result: string } | undefined {
    const { snapshot } = request.record;
    return this.#loadCommandByKey(
      snapshot.workspace_id,
      snapshot.run_id,
      request.command.kind,
      request.command.idempotency_key,
    );
  }

  #loadCommandByKey(
    workspaceId: string,
    runId: string,
    kind: AgentRunMutationKind,
    idempotencyKey: string,
  ): { request_digest: string; result: string } | undefined {
    return this.#database
      .prepare(
        `SELECT request_digest, result FROM qa_agent_run_commands
          WHERE workspace_id = ? AND run_id = ?
            AND command_kind = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, runId, kind, idempotencyKey) as
      | { request_digest: string; result: string }
      | undefined;
  }

  #insertRun(record: AgentRunRecord): boolean {
    const { snapshot } = record;
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO qa_agent_runs
           (workspace_id, run_id, revision, state, record, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.workspace_id,
        snapshot.run_id,
        snapshot.revision,
        snapshot.state,
        JSON.stringify(record),
        record.started_at,
        snapshot.updated_at,
      );
    return result.changes === 1;
  }

  #updateRun(record: AgentRunRecord, expectedRevision: number): boolean {
    const { snapshot } = record;
    const result = this.#database
      .prepare(
        `UPDATE qa_agent_runs
            SET revision = ?, state = ?, record = ?, updated_at = ?
          WHERE workspace_id = ? AND run_id = ? AND revision = ?`,
      )
      .run(
        snapshot.revision,
        snapshot.state,
        JSON.stringify(record),
        snapshot.updated_at,
        snapshot.workspace_id,
        snapshot.run_id,
        expectedRevision,
      );
    return result.changes === 1;
  }

  #requireChanged(mutation: () => { changes: number | bigint }, artifact: string): void {
    const result = mutation();
    if (Number(result.changes) !== 1) {
      throw new Error(`Failed to retain ${artifact}.`);
    }
  }
}

function validateMutation(request: RetainAgentRunMutationRequest): string | undefined {
  const { snapshot } = request.record;
  const event = request.record.events.at(-1);
  const required = [
    snapshot.workspace_id,
    snapshot.run_id,
    request.command.idempotency_key,
    request.command.request_digest,
  ];
  if (required.some((value) => value.trim().length === 0) || event === undefined) {
    return "Run, command, and event identity are required.";
  }
  if (!isMutationKind(request.command.kind)) {
    return "The Agent Run mutation kind is unsupported.";
  }
  if ((request.expected_revision === null) !== (request.command.kind === "start")) {
    return "Only a start command may omit an expected revision.";
  }
  if (event.sequence !== request.record.events.length) {
    return "The retained record must contain exactly the next Agent Run event sequence.";
  }
  if (request.expected_revision === null) {
    // A `start` command's initial revision is whatever the Agent Runtime
    // assigned while resolving/authorizing the run before it became
    // observable (e.g. InMemoryAgentRuntime reaches revision 3 after 5
    // internal events) — this store SHALL NOT assume revision 1, only that
    // it is a positive integer with no prior mutation on record.
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      return "A start command's initial revision must be a positive integer.";
    }
    return undefined;
  }
  if (snapshot.revision !== request.expected_revision + 1) {
    return "The retained record must advance the Agent Run revision by exactly one.";
  }
  return undefined;
}

function isMutationKind(value: unknown): value is AgentRunMutationKind {
  return typeof value === "string" && MUTATION_KINDS.has(value);
}

const MUTATION_KINDS = new Set([
  "start",
  "authorize",
  "execute",
  "approve",
  "resume",
  "cancel",
]);

function decodeRecord(
  value: unknown,
  reference: AgentRunReference,
): AgentRunRecord | undefined {
  if (
    !isObject(value) ||
    !isObject(value.snapshot) ||
    !Array.isArray(value.events) ||
    !isObject(value.start_request) ||
    typeof value.started_at !== "string" ||
    typeof value.start_fingerprint !== "string" ||
    !(value.result === null || isObject(value.result))
  ) {
    return undefined;
  }
  const snapshot = value.snapshot;
  if (
    snapshot.schema_version !== "1.0.0" ||
    snapshot.workspace_id !== reference.workspace_id ||
    snapshot.run_id !== reference.run_id ||
    !isAgentRunState(snapshot.state) ||
    !Number.isInteger(snapshot.revision) ||
    (snapshot.revision as number) < 1 ||
    typeof snapshot.updated_at !== "string"
  ) {
    return undefined;
  }
  // Revision (an Agent Runtime transition counter) and event count are
  // independent: InMemoryAgentRuntime's `start` alone reaches revision 3
  // after 5 internal events, so this store SHALL NOT assume they're equal —
  // only that events are contiguously sequenced from 1.
  if (
    !value.events.every(
      (event, index) => isAgentRunEvent(event) && event.sequence === index + 1,
    )
  ) {
    return undefined;
  }
  return immutableCopy(value) as AgentRunRecord;
}

function isAgentRunEvent(value: unknown): value is AgentRunEvent {
  return (
    isObject(value) &&
    typeof value.event_id === "string" &&
    value.event_id.length > 0 &&
    Number.isInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    typeof value.type === "string" &&
    typeof value.occurred_at === "string"
  );
}

function isAgentRunState(value: unknown): value is AgentRunState {
  return typeof value === "string" && AGENT_RUN_STATES.has(value as AgentRunState);
}

const AGENT_RUN_STATES = new Set<AgentRunState>([
  "requested",
  "resolving",
  "awaiting_authorization",
  "ready",
  "running",
  "awaiting_approval",
  "suspended",
  "validating",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function succeeded(value: AgentRunRecord): AgentRunRecordStoreResult {
  return immutableCopy({ ok: true as const, value });
}

function failed(
  code: AgentRunRecordStoreFailureCode,
  message: string,
): AgentRunRecordStoreResult {
  return immutableCopy({ ok: false as const, failure: { code, message } });
}

function immutableCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableCopy(entry))) as Value;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ),
    ) as Value;
  }
  return value;
}
