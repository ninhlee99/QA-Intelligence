import { createHash } from "node:crypto";

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

export type PostgresQuery = Readonly<{
  name: string;
  text: string;
  values: readonly unknown[];
}>;

export type PostgresQueryResult<Row> = Readonly<{
  row_count: number;
  rows: readonly Row[];
}>;

export interface PostgresTransaction {
  query<Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresTransactionManager {
  transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value>;
}

export type PostgresEvaluationCampaignRecordStoreDependencies = Readonly<{
  database: PostgresTransactionManager;
}>;

/** PostgreSQL transaction adapter for retained campaign state and outbox intent. */
export class PostgresEvaluationCampaignRecordStore implements EvaluationCampaignRecordStore {
  readonly #database: PostgresTransactionManager;

  constructor(dependencies: PostgresEvaluationCampaignRecordStoreDependencies) {
    this.#database = dependencies.database;
  }

  async retainMutation(
    request: RetainEvaluationCampaignMutationRequest,
  ): Promise<EvaluationCampaignRecordStoreResult> {
    const retained = immutableCopy(request);
    const invalid = validateMutation(retained);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const { snapshot } = retained.record;
    const event = retained.record.events.at(-1) as EvaluationCampaignEvent;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, snapshot.workspace_id);
        const retainedCommand = await loadCommand(transaction, retained);
        const prior = retainedCommand.rows[0];
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
          ? await insertCampaign(transaction, retained.record)
          : await updateCampaign(
              transaction,
              retained.record,
              retained.expected_revision,
            );
        if (mutation.row_count !== 1) {
          const concurrentCommand = await loadCommand(transaction, retained);
          const winner = concurrentCommand.rows[0];
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
            "The retained campaign revision changed before the mutation committed.",
          );
        }

        await requireInserted(
          transaction.query({
            name: "campaign_event_append",
            text: `
              INSERT INTO qa_evaluation_campaign_events
                (workspace_id, campaign_id, sequence, revision, event, occurred_at)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
              ON CONFLICT DO NOTHING
              RETURNING sequence
            `,
            values: [
              snapshot.workspace_id,
              snapshot.campaign_id,
              event.sequence,
              event.revision,
              JSON.stringify(event),
              event.occurred_at,
            ],
          }),
          "campaign event",
        );
        await requireInserted(
          transaction.query({
            name: "campaign_command_retain",
            text: `
              INSERT INTO qa_evaluation_campaign_commands
                (workspace_id, campaign_id, command_kind, idempotency_key,
                 request_digest, result, retained_at)
              VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
              ON CONFLICT DO NOTHING
              RETURNING idempotency_key
            `,
            values: [
              snapshot.workspace_id,
              snapshot.campaign_id,
              retained.command.kind,
              retained.command.idempotency_key,
              retained.command.request_digest,
              JSON.stringify(retained.record),
              event.occurred_at,
            ],
          }),
          "campaign command",
        );
        const outboxPayload = stableStringify({ event, snapshot });
        const outboxDigest = `sha256:${createHash("sha256")
          .update(outboxPayload)
          .digest("hex")}`;
        await requireInserted(
          transaction.query({
            name: "campaign_outbox_append",
            text: `
              INSERT INTO qa_platform_outbox
                (event_id, event_type, schema_version, occurred_at, recorded_at,
                 producer_id, producer_version, workspace_id, actor_id,
                 correlation_id, causation_id, aggregate_id, aggregate_sequence,
                 payload, classification, integrity_algorithm, integrity_digest)
              VALUES ($1, $2, $3, $4::timestamptz, transaction_timestamp(),
                      $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16)
              ON CONFLICT DO NOTHING
              RETURNING event_id
            `,
            values: [
              retained.outbox.event_id,
              retained.outbox.event_type,
              retained.outbox.schema_version,
              event.occurred_at,
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
            ],
          }),
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
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, reference.workspace_id);
        const loaded = await transaction.query<RecordRow>({
          name: "campaign_load",
          text: `
            SELECT record
              FROM qa_evaluation_campaigns
             WHERE workspace_id = $1 AND campaign_id = $2
          `,
          values: [reference.workspace_id, reference.campaign_id],
        });
        const row = loaded.rows[0];
        if (row === undefined) {
          return failed("not_found", "The campaign record was not found.");
        }
        const record = decodeRecord(row.record, reference);
        return record === undefined
          ? failed("persistence_corrupt", "The retained campaign record is invalid.")
          : succeeded(record);
      });
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
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, request.workspace_id);
        const loaded = await transaction.query<CommandRow>({
          name: "campaign_command_load",
          text: `
            SELECT request_digest, result
              FROM qa_evaluation_campaign_commands
             WHERE workspace_id = $1
               AND campaign_id = $2
               AND command_kind = $3
               AND idempotency_key = $4
          `,
          values: [request.workspace_id, request.campaign_id, request.kind, request.idempotency_key],
        });
        const row = loaded.rows[0];
        if (row === undefined) return undefined;
        const record = decodeRecord(row.result, {
          workspace_id: request.workspace_id,
          campaign_id: request.campaign_id,
        });
        return record === undefined
          ? undefined
          : { request_digest: row.request_digest, record };
      });
    } catch {
      return undefined;
    }
  }
}

type CommandRow = Readonly<{ request_digest: string; result: unknown }>;
type RecordRow = Readonly<{ record: unknown }>;

function loadCommand(
  transaction: PostgresTransaction,
  request: RetainEvaluationCampaignMutationRequest,
): Promise<PostgresQueryResult<CommandRow>> {
  const { snapshot } = request.record;
  return transaction.query({
    name: "campaign_command_load",
    text: `
      SELECT request_digest, result
        FROM qa_evaluation_campaign_commands
       WHERE workspace_id = $1
         AND campaign_id = $2
         AND command_kind = $3
         AND idempotency_key = $4
    `,
    values: [
      snapshot.workspace_id,
      snapshot.campaign_id,
      request.command.kind,
      request.command.idempotency_key,
    ],
  });
}

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

function insertCampaign(
  transaction: PostgresTransaction,
  record: EvaluationCampaignRecord,
): Promise<PostgresQueryResult<RecordRow>> {
  const { snapshot } = record;
  return transaction.query({
    name: "campaign_create",
    text: `
      INSERT INTO qa_evaluation_campaigns
        (workspace_id, campaign_id, revision, state, record, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
      ON CONFLICT DO NOTHING
      RETURNING record
    `,
    values: [
      snapshot.workspace_id,
      snapshot.campaign_id,
      snapshot.revision,
      snapshot.state,
      JSON.stringify(record),
      snapshot.created_at,
      snapshot.updated_at,
    ],
  });
}

function updateCampaign(
  transaction: PostgresTransaction,
  record: EvaluationCampaignRecord,
  expectedRevision: number,
): Promise<PostgresQueryResult<RecordRow>> {
  const { snapshot } = record;
  return transaction.query({
    name: "campaign_update",
    text: `
      UPDATE qa_evaluation_campaigns
         SET revision = $3, state = $4, record = $5::jsonb,
             updated_at = $6::timestamptz
       WHERE workspace_id = $1 AND campaign_id = $2 AND revision = $7
      RETURNING record
    `,
    values: [
      snapshot.workspace_id,
      snapshot.campaign_id,
      snapshot.revision,
      snapshot.state,
      JSON.stringify(record),
      snapshot.updated_at,
      expectedRevision,
    ],
  });
}

async function requireInserted(
  insertion: Promise<PostgresQueryResult<unknown>>,
  artifact: string,
): Promise<void> {
  const result = await insertion;
  if (result.row_count !== 1) {
    throw new Error(`Failed to retain ${artifact}.`);
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
