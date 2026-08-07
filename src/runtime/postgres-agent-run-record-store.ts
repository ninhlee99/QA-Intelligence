import type {
  PostgresTransaction,
  PostgresTransactionManager,
} from "../evaluation/postgres-evaluation-campaign-record-store.js";

import type { AgentRunEvent, AgentRunReference, AgentRunState } from "./public.js";
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

export type PostgresAgentRunRecordStoreDependencies = Readonly<{
  database: PostgresTransactionManager;
}>;

/**
 * PostgreSQL adapter for the ADR-017/SPEC-410 §5 Agent Run record-store seam
 * (shared/team profile). Mirrors PostgresEvaluationCampaignRecordStore's
 * transaction, Workspace-scope (RLS), and idempotent-replay shape for the
 * Agent Run aggregate instead of the Evaluation Campaign aggregate — the
 * Agent Run seam carries no outbox intent (see agent-run-record-store.ts),
 * so this adapter retains only the run row, its events, and its commands.
 */
export class PostgresAgentRunRecordStore implements AgentRunRecordStore {
  readonly #database: PostgresTransactionManager;

  constructor(dependencies: PostgresAgentRunRecordStoreDependencies) {
    this.#database = dependencies.database;
  }

  async retainMutation(
    request: RetainAgentRunMutationRequest,
  ): Promise<AgentRunRecordStoreResult> {
    const retained = immutableCopy(request);
    const invalid = validateMutation(retained);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const { snapshot } = retained.record;
    const event = retained.record.events.at(-1) as AgentRunEvent;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, snapshot.workspace_id);
        const prior = await this.#loadCommand(transaction, retained);
        if (prior !== undefined) {
          if (prior.request_digest !== retained.command.request_digest) {
            return failed(
              "idempotency_conflict",
              "The command idempotency key is bound to different input.",
            );
          }
          const priorRecord = decodeRecord(prior.result, snapshot);
          return priorRecord === undefined
            ? failed("persistence_corrupt", "The retained command result is invalid.")
            : succeeded(priorRecord);
        }

        const mutation = retained.expected_revision === null
          ? await insertRun(transaction, retained.record)
          : await updateRun(transaction, retained.record, retained.expected_revision);
        if (mutation.row_count !== 1) {
          const winner = await this.#loadCommand(transaction, retained);
          if (winner !== undefined) {
            if (winner.request_digest !== retained.command.request_digest) {
              return failed(
                "idempotency_conflict",
                "The command idempotency key is bound to different input.",
              );
            }
            const winnerRecord = decodeRecord(winner.result, snapshot);
            return winnerRecord === undefined
              ? failed("persistence_corrupt", "The retained command result is invalid.")
              : succeeded(winnerRecord);
          }
          return failed(
            "stale_revision",
            "The retained Agent Run revision changed before the mutation committed.",
          );
        }

        await requireInserted(
          transaction.query({
            name: "run_event_append",
            text: `
              INSERT INTO qa_agent_run_events
                (workspace_id, run_id, sequence, revision, event, occurred_at)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
              ON CONFLICT DO NOTHING
              RETURNING sequence
            `,
            values: [
              snapshot.workspace_id,
              snapshot.run_id,
              event.sequence,
              event.sequence,
              JSON.stringify(event),
              event.occurred_at,
            ],
          }),
          "run event",
        );
        await requireInserted(
          transaction.query({
            name: "run_command_retain",
            text: `
              INSERT INTO qa_agent_run_commands
                (workspace_id, run_id, command_kind, idempotency_key,
                 request_digest, result, retained_at)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
              ON CONFLICT DO NOTHING
              RETURNING idempotency_key
            `,
            values: [
              snapshot.workspace_id,
              snapshot.run_id,
              retained.command.kind,
              retained.command.idempotency_key,
              retained.command.request_digest,
              JSON.stringify(retained.record),
              event.occurred_at,
            ],
          }),
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
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, reference.workspace_id);
        const loaded = await transaction.query<RecordRow>({
          name: "run_load",
          text: `
            SELECT record
              FROM qa_agent_runs
             WHERE workspace_id = $1 AND run_id = $2
          `,
          values: [reference.workspace_id, reference.run_id],
        });
        const row = loaded.rows[0];
        if (row === undefined) {
          return failed("not_found", "The Agent Run record was not found.");
        }
        const record = decodeRecord(row.record, reference);
        return record === undefined
          ? failed("persistence_corrupt", "The retained Agent Run record is invalid.")
          : succeeded(record);
      });
    } catch {
      return failed("persistence_unavailable", "The Agent Run record could not be loaded.");
    }
  }

  async peekCommand(
    request: PeekAgentRunCommandRequest,
  ): Promise<AgentRunCommandPeek | undefined> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspace_id);
        const loaded = await transaction.query<CommandRow>({
          name: "run_command_load",
          text: `
            SELECT request_digest, result
              FROM qa_agent_run_commands
             WHERE workspace_id = $1
               AND run_id = $2
               AND command_kind = $3
               AND idempotency_key = $4
          `,
          values: [request.workspace_id, request.run_id, request.kind, request.idempotency_key],
        });
        const row = loaded.rows[0];
        if (row === undefined) return undefined;
        const record = decodeRecord(row.result, {
          schema_version: "1.0.0",
          workspace_id: request.workspace_id,
          run_id: request.run_id,
        });
        return record === undefined
          ? undefined
          : { request_digest: row.request_digest, record };
      });
    } catch {
      return undefined;
    }
  }

  async #loadCommand(
    transaction: PostgresTransaction,
    request: RetainAgentRunMutationRequest,
  ): Promise<CommandRow | undefined> {
    const { snapshot } = request.record;
    const loaded = await transaction.query<CommandRow>({
      name: "run_command_load",
      text: `
        SELECT request_digest, result
          FROM qa_agent_run_commands
         WHERE workspace_id = $1
           AND run_id = $2
           AND command_kind = $3
           AND idempotency_key = $4
      `,
      values: [
        snapshot.workspace_id,
        snapshot.run_id,
        request.command.kind,
        request.command.idempotency_key,
      ],
    });
    return loaded.rows[0];
  }
}

type CommandRow = Readonly<{ request_digest: string; result: unknown }>;
type RecordRow = Readonly<{ record: unknown }>;

async function setWorkspaceScope(
  transaction: PostgresTransaction,
  workspaceId: string,
): Promise<void> {
  await transaction.query({
    name: "workspace_scope_set",
    text: "SELECT set_config('qa.workspace_id', $1, true)",
    values: [workspaceId],
  });
}

function insertRun(transaction: PostgresTransaction, record: AgentRunRecord) {
  const { snapshot } = record;
  return transaction.query<RecordRow>({
    name: "run_create",
    text: `
      INSERT INTO qa_agent_runs
        (workspace_id, run_id, revision, state, record, started_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING record
    `,
    values: [
      snapshot.workspace_id,
      snapshot.run_id,
      snapshot.revision,
      snapshot.state,
      JSON.stringify(record),
      record.started_at,
      snapshot.updated_at,
    ],
  });
}

function updateRun(
  transaction: PostgresTransaction,
  record: AgentRunRecord,
  expectedRevision: number,
) {
  const { snapshot } = record;
  return transaction.query<RecordRow>({
    name: "run_update",
    text: `
      UPDATE qa_agent_runs
         SET revision = $3, state = $4, record = $5::jsonb, updated_at = $6::timestamptz
       WHERE workspace_id = $1 AND run_id = $2 AND revision = $7
      RETURNING record
    `,
    values: [
      snapshot.workspace_id,
      snapshot.run_id,
      snapshot.revision,
      snapshot.state,
      JSON.stringify(record),
      snapshot.updated_at,
      expectedRevision,
    ],
  });
}

async function requireInserted(
  insertion: Promise<{ row_count: number }>,
  artifact: string,
): Promise<void> {
  const result = await insertion;
  if (result.row_count !== 1) {
    throw new Error(`Failed to retain ${artifact}.`);
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
    // observable — this store SHALL NOT assume revision 1, only that it is
    // a positive integer with no prior mutation on record. Mirrors
    // SqliteAgentRunRecordStore's validateMutation.
    if (!Number.isInteger(snapshot.revision) || snapshot.revision < 1) {
      return "A start command's initial revision must be a positive integer.";
    }
    return undefined;
  }
  // A single public command can internally advance the run through several
  // transitions before this store ever sees it — the record's revision only
  // has to have advanced past what the caller expected.
  if (snapshot.revision <= request.expected_revision) {
    return "The retained record must advance past the expected Agent Run revision.";
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
  // independent, so this store SHALL NOT assume they're equal — only that
  // events are contiguously sequenced from 1. Mirrors
  // SqliteAgentRunRecordStore's decodeRecord.
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
