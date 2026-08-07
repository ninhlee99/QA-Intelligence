import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { stableStringify } from "../shared/stable-stringify.js";
import type {
  EvaluationCampaignEvent,
  EvaluationCampaignRecord,
  EvaluationCampaignReference,
} from "./evaluation-campaign-repository.js";
import type {
  EvaluationCampaignCommandPeek,
  EvaluationCampaignMutationKind,
  EvaluationCampaignRecordStore,
  EvaluationCampaignRecordStoreFailureCode,
  EvaluationCampaignRecordStoreResult,
  PeekEvaluationCampaignCommandRequest,
  RetainEvaluationCampaignMutationRequest,
} from "./evaluation-campaign-record-store.js";

export type SqliteEvaluationCampaignRecordStoreDependencies = Readonly<{
  database_path: string;
  workspace_id: string;
}>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS qa_evaluation_campaigns (
    workspace_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT NOT NULL,
    record TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, campaign_id)
  );

  CREATE TABLE IF NOT EXISTS qa_evaluation_campaign_events (
    workspace_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    event TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, campaign_id, sequence),
    FOREIGN KEY (workspace_id, campaign_id)
      REFERENCES qa_evaluation_campaigns (workspace_id, campaign_id)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS qa_evaluation_campaign_events_revision
    ON qa_evaluation_campaign_events (workspace_id, campaign_id, revision);

  CREATE TABLE IF NOT EXISTS qa_evaluation_campaign_commands (
    workspace_id TEXT NOT NULL,
    campaign_id TEXT NOT NULL,
    command_kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    result TEXT NOT NULL,
    retained_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, campaign_id, command_kind, idempotency_key),
    FOREIGN KEY (workspace_id, campaign_id)
      REFERENCES qa_evaluation_campaigns (workspace_id, campaign_id)
  );

  CREATE TABLE IF NOT EXISTS qa_platform_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    producer_version TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_sequence INTEGER NOT NULL,
    payload TEXT NOT NULL,
    classification TEXT NOT NULL,
    integrity_algorithm TEXT NOT NULL,
    integrity_digest TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at TEXT,
    published_at TEXT,
    last_error TEXT
  );

  CREATE INDEX IF NOT EXISTS qa_platform_outbox_publishable
    ON qa_platform_outbox (available_at, event_id)
    WHERE published_at IS NULL;

  CREATE INDEX IF NOT EXISTS qa_platform_outbox_aggregate_order
    ON qa_platform_outbox (workspace_id, aggregate_id, aggregate_sequence);
`;

/**
 * Local-first SQLite adapter (ADR-017): one database file per Workspace,
 * owned exclusively by the parent runtime process on the user's machine.
 */
export class SqliteEvaluationCampaignRecordStore implements EvaluationCampaignRecordStore {
  readonly #database: DatabaseSync;
  readonly #workspaceId: string;

  constructor(dependencies: SqliteEvaluationCampaignRecordStoreDependencies) {
    if (dependencies.workspace_id.trim().length === 0) {
      throw new Error("A Workspace identity is required to open a local campaign store.");
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
    request: RetainEvaluationCampaignMutationRequest,
  ): Promise<EvaluationCampaignRecordStoreResult> {
    const retained = immutableCopy(request);
    const invalid = validateMutation(retained);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const { snapshot } = retained.record;
    if (snapshot.workspace_id !== this.#workspaceId) {
      return failed(
        "workspace_denied",
        "The campaign record does not belong to this local Workspace database.",
      );
    }
    const event = retained.record.events.at(-1) as EvaluationCampaignEvent;

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
          ? this.#insertCampaign(retained.record)
          : this.#updateCampaign(retained.record, retained.expected_revision);
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
            "The retained campaign revision changed before the mutation committed.",
          );
        }

        this.#requireChanged(
          () =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO qa_evaluation_campaign_events
                   (workspace_id, campaign_id, sequence, revision, event, occurred_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshot.workspace_id,
                snapshot.campaign_id,
                event.sequence,
                event.revision,
                JSON.stringify(event),
                event.occurred_at,
              ),
          "campaign event",
        );
        this.#requireChanged(
          () =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO qa_evaluation_campaign_commands
                   (workspace_id, campaign_id, command_kind, idempotency_key,
                    request_digest, result, retained_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshot.workspace_id,
                snapshot.campaign_id,
                retained.command.kind,
                retained.command.idempotency_key,
                retained.command.request_digest,
                JSON.stringify(retained.record),
                event.occurred_at,
              ),
          "campaign command",
        );
        const outboxPayload = stableStringify({ event, snapshot });
        const outboxDigest = `sha256:${createHash("sha256").update(outboxPayload).digest("hex")}`;
        this.#requireChanged(
          () =>
            this.#database
              .prepare(
                `INSERT OR IGNORE INTO qa_platform_outbox
                   (event_id, event_type, schema_version, occurred_at, recorded_at,
                    producer_id, producer_version, workspace_id, actor_id,
                    correlation_id, causation_id, aggregate_id, aggregate_sequence,
                    payload, classification, integrity_algorithm, integrity_digest,
                    available_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                retained.outbox.event_id,
                retained.outbox.event_type,
                retained.outbox.schema_version,
                event.occurred_at,
                new Date().toISOString(),
                retained.outbox.producer_id,
                retained.outbox.producer_version,
                snapshot.workspace_id,
                event.actor_id,
                retained.outbox.correlation_id,
                retained.outbox.causation_id,
                snapshot.campaign_id,
                event.sequence,
                outboxPayload,
                retained.outbox.classification,
                "sha256",
                outboxDigest,
                event.occurred_at,
              ),
          "outbox intent",
        );
        return succeeded(retained.record);
      });
    } catch {
      return failed(
        "persistence_unavailable",
        "The campaign mutation transaction could not be committed.",
      );
    }
  }

  async load(
    reference: EvaluationCampaignReference,
  ): Promise<EvaluationCampaignRecordStoreResult> {
    if (reference.workspace_id.trim().length === 0 || reference.campaign_id.trim().length === 0) {
      return failed("invalid_request", "Workspace and campaign identity are required.");
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
          `SELECT record FROM qa_evaluation_campaigns
            WHERE workspace_id = ? AND campaign_id = ?`,
        )
        .get(reference.workspace_id, reference.campaign_id) as
        | { record: string }
        | undefined;
      if (row === undefined) {
        return failed("not_found", "The campaign record was not found.");
      }
      const record = decodeRecord(JSON.parse(row.record), reference);
      return record === undefined
        ? failed("persistence_corrupt", "The retained campaign record is invalid.")
        : succeeded(record);
    } catch {
      return failed(
        "persistence_unavailable",
        "The campaign record could not be loaded.",
      );
    }
  }

  async peekCommand(
    request: PeekEvaluationCampaignCommandRequest,
  ): Promise<EvaluationCampaignCommandPeek | undefined> {
    if (request.workspace_id !== this.#workspaceId) return undefined;
    const row = this.#loadCommandByKey(
      request.workspace_id,
      request.campaign_id,
      request.kind,
      request.idempotency_key,
    );
    if (row === undefined) return undefined;
    const record = decodeRecord(JSON.parse(row.result), {
      workspace_id: request.workspace_id,
      campaign_id: request.campaign_id,
    });
    return record === undefined
      ? undefined
      : { request_digest: row.request_digest, record };
  }

  #transaction(
    operation: () => EvaluationCampaignRecordStoreResult,
  ): EvaluationCampaignRecordStoreResult {
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
    request: RetainEvaluationCampaignMutationRequest,
  ): { request_digest: string; result: string } | undefined {
    const { snapshot } = request.record;
    return this.#loadCommandByKey(
      snapshot.workspace_id,
      snapshot.campaign_id,
      request.command.kind,
      request.command.idempotency_key,
    );
  }

  #loadCommandByKey(
    workspaceId: string,
    campaignId: string,
    kind: EvaluationCampaignMutationKind,
    idempotencyKey: string,
  ): { request_digest: string; result: string } | undefined {
    return this.#database
      .prepare(
        `SELECT request_digest, result FROM qa_evaluation_campaign_commands
          WHERE workspace_id = ? AND campaign_id = ?
            AND command_kind = ? AND idempotency_key = ?`,
      )
      .get(workspaceId, campaignId, kind, idempotencyKey) as
      | { request_digest: string; result: string }
      | undefined;
  }

  #insertCampaign(record: EvaluationCampaignRecord): boolean {
    const { snapshot } = record;
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO qa_evaluation_campaigns
           (workspace_id, campaign_id, revision, state, record, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.workspace_id,
        snapshot.campaign_id,
        snapshot.revision,
        snapshot.state,
        JSON.stringify(record),
        snapshot.created_at,
        snapshot.updated_at,
      );
    return result.changes === 1;
  }

  #updateCampaign(record: EvaluationCampaignRecord, expectedRevision: number): boolean {
    const { snapshot } = record;
    const result = this.#database
      .prepare(
        `UPDATE qa_evaluation_campaigns
            SET revision = ?, state = ?, record = ?, updated_at = ?
          WHERE workspace_id = ? AND campaign_id = ? AND revision = ?`,
      )
      .run(
        snapshot.revision,
        snapshot.state,
        JSON.stringify(record),
        snapshot.updated_at,
        snapshot.workspace_id,
        snapshot.campaign_id,
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

function validateMutation(
  request: RetainEvaluationCampaignMutationRequest,
): string | undefined {
  const { snapshot } = request.record;
  const event = request.record.events.at(-1);
  const required = [
    snapshot.workspace_id,
    snapshot.campaign_id,
    request.command.idempotency_key,
    request.command.request_digest,
    request.outbox.event_id,
    request.outbox.event_type,
    request.outbox.producer_id,
    request.outbox.producer_version,
    request.outbox.correlation_id,
    request.outbox.causation_id,
    request.outbox.classification,
  ];
  if (required.some((value) => value.trim().length === 0) || event === undefined) {
    return "Campaign, command, event, producer, correlation, classification and integrity identity are required.";
  }
  if (!isMutationKind(request.command.kind)) {
    return "The campaign mutation kind is unsupported.";
  }
  const expectedEvent = MUTATION_EVENTS[request.command.kind];
  if (
    request.outbox.schema_version !== "1.0.0" ||
    event.kind !== expectedEvent.kind ||
    request.outbox.event_type !== expectedEvent.type ||
    (request.expected_revision === null) !== (request.command.kind === "create")
  ) {
    return "Command kind, revision mode, domain event and outbox type must describe the same mutation.";
  }
  const expectedNextRevision = request.expected_revision === null
    ? 1
    : request.expected_revision + 1;
  if (
    !Number.isInteger(expectedNextRevision) ||
    snapshot.revision !== expectedNextRevision ||
    event.revision !== snapshot.revision ||
    event.sequence !== request.record.events.length
  ) {
    return "The retained record must contain exactly the next campaign revision and event sequence.";
  }
  return undefined;
}

const MUTATION_EVENTS: Readonly<
  Record<EvaluationCampaignMutationKind, Readonly<{ kind: string; type: string }>>
> = Object.freeze({
  create: {
    kind: "campaign_created",
    type: "evaluation.campaign.created",
  },
  transition: {
    kind: "campaign_transitioned",
    type: "evaluation.campaign.transitioned",
  },
  trial_boundary: {
    kind: "trial_boundary_recorded",
    type: "evaluation.campaign.trial-boundary-recorded",
  },
  recovery: {
    kind: "campaign_recovered",
    type: "evaluation.campaign.recovered",
  },
});

function isMutationKind(value: unknown): value is EvaluationCampaignMutationKind {
  return typeof value === "string" && MUTATION_KINDS.has(value);
}

const MUTATION_KINDS = new Set([
  "create",
  "transition",
  "trial_boundary",
  "recovery",
]);

function decodeRecord(
  value: unknown,
  reference: EvaluationCampaignReference,
): EvaluationCampaignRecord | undefined {
  if (!isObject(value) || !isObject(value.snapshot) || !Array.isArray(value.events)) {
    return undefined;
  }
  const snapshot = value.snapshot;
  if (
    snapshot.schema_version !== "1.0.0" ||
    snapshot.workspace_id !== reference.workspace_id ||
    snapshot.campaign_id !== reference.campaign_id ||
    !isCampaignState(snapshot.state) ||
    !Number.isInteger(snapshot.revision) ||
    (snapshot.revision as number) < 1 ||
    !isUtcTimestamp(snapshot.created_at) ||
    !isUtcTimestamp(snapshot.updated_at) ||
    !isObject(snapshot.definition) ||
    !Array.isArray(snapshot.trials)
  ) return undefined;
  const definition = snapshot.definition;
  if (
    !isObject(definition.subject) ||
    (definition.subject.type !== "agent" && definition.subject.type !== "skill") ||
    typeof definition.subject.id !== "string" ||
    typeof definition.subject.version !== "string" ||
    !isObject(definition.suite) ||
    typeof definition.suite.id !== "string" ||
    typeof definition.suite.version !== "string" ||
    !isObject(definition.resolved_versions) ||
    !Object.values(definition.resolved_versions).every(
      (entry) => typeof entry === "string",
    ) ||
    !Array.isArray(definition.trials) ||
    !definition.trials.every(isTrialDefinition)
  ) return undefined;
  const definitionTrials = definition.trials;
  if (
    !snapshot.trials.every(isTrialSnapshot) ||
    snapshot.trials.length !== definitionTrials.length ||
    !snapshot.trials.every((trial, index) =>
      isObject(trial) && sameTrialIdentity(trial, definitionTrials[index])) ||
    !value.events.every((event, index) =>
      isCampaignEvent(event) &&
      event.sequence === index + 1 &&
      event.revision === index + 1) ||
    value.events.length !== snapshot.revision
  ) return undefined;
  const finalEvent = value.events.at(-1);
  if (
    !isObject(finalEvent) ||
    finalEvent.sequence !== value.events.length ||
    finalEvent.revision !== snapshot.revision ||
    finalEvent.to_state !== snapshot.state
  ) return undefined;
  return immutableCopy(value) as EvaluationCampaignRecord;
}

function isTrialSnapshot(value: unknown): boolean {
  return isObject(value) &&
    typeof value.case_id === "string" &&
    typeof value.trial_id === "string" &&
    typeof value.attempt_id === "string" &&
    isTrialState(value.state) &&
    (value.effect_state === "none" ||
      value.effect_state === "known" ||
      value.effect_state === "unknown") &&
    typeof value.cleanup_completed === "boolean";
}

function isTrialDefinition(value: unknown): boolean {
  return isObject(value) &&
    typeof value.case_id === "string" && value.case_id.length > 0 &&
    typeof value.trial_id === "string" && value.trial_id.length > 0 &&
    typeof value.attempt_id === "string" && value.attempt_id.length > 0;
}

function sameTrialIdentity(
  snapshot: Record<string, unknown>,
  definition: unknown,
): boolean {
  return isObject(definition) &&
    snapshot.case_id === definition.case_id &&
    snapshot.trial_id === definition.trial_id &&
    snapshot.attempt_id === definition.attempt_id;
}

function isCampaignEvent(value: unknown): boolean {
  return isObject(value) &&
    Number.isInteger(value.sequence) && (value.sequence as number) > 0 &&
    Number.isInteger(value.revision) && (value.revision as number) > 0 &&
    typeof value.kind === "string" && CAMPAIGN_EVENT_KINDS.has(value.kind) &&
    (value.from_state === null || isCampaignState(value.from_state)) &&
    isCampaignState(value.to_state) &&
    (value.trial_id === null || typeof value.trial_id === "string") &&
    (value.attempt_id === null || typeof value.attempt_id === "string") &&
    (value.trial_from_state === null || isTrialState(value.trial_from_state)) &&
    (value.trial_to_state === null || isTrialState(value.trial_to_state)) &&
    typeof value.actor_id === "string" &&
    Array.isArray(value.evidence) &&
    value.evidence.every((entry) => typeof entry === "string") &&
    isUtcTimestamp(value.occurred_at);
}

function isCampaignState(value: unknown): boolean {
  return typeof value === "string" && CAMPAIGN_STATES.has(value);
}

function isTrialState(value: unknown): boolean {
  return typeof value === "string" && TRIAL_STATES.has(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUtcTimestamp(value: unknown): boolean {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

const CAMPAIGN_STATES = new Set([
  "draft",
  "validating",
  "ready",
  "running",
  "analyzing",
  "awaiting_review",
  "approved",
  "conditionally_approved",
  "rejected",
  "indeterminate",
  "blocked",
  "cancelled",
  "failed",
]);

const TRIAL_STATES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "not_executed",
]);

const CAMPAIGN_EVENT_KINDS = new Set([
  "campaign_created",
  "campaign_transitioned",
  "trial_boundary_recorded",
  "campaign_recovered",
]);

function succeeded(value: EvaluationCampaignRecord): EvaluationCampaignRecordStoreResult {
  return immutableCopy({ ok: true as const, value });
}

function failed(
  code: EvaluationCampaignRecordStoreFailureCode,
  message: string,
): EvaluationCampaignRecordStoreResult {
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
