import type {
  PostgresTransaction,
  PostgresTransactionManager,
} from "../../evaluation/postgres-evaluation-campaign-record-store.js";
import type {
  ArchiveKnowledgeRequest,
  CreateKnowledgeDraftRequest,
  DeprecateOrSupersedeKnowledgeRequest,
  KnowledgeLifecycleEvent,
  KnowledgeObject,
  KnowledgeObjectStatus,
  KnowledgeQueryFilter,
  KnowledgeRelationshipTraversalRequest,
  KnowledgeRepository,
  KnowledgeRepositoryFailureCode,
  KnowledgeRepositoryResult,
  PromoteKnowledgeCandidateRequest,
  RecordKnowledgeDecisionRequest,
  ReviseKnowledgeDraftRequest,
  SubmitKnowledgeForReviewRequest,
} from "../../knowledge/public.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

export type PostgresKnowledgeRepositoryDependencies = Readonly<{
  database: PostgresTransactionManager;
  workspace_id: string;
  clock: Clock;
}>;

/** SPEC-102 §9: draft → in_review → accepted → deprecated → superseded | archived. */
const ALLOWED_TRANSITIONS: Readonly<Record<KnowledgeObjectStatus, readonly KnowledgeObjectStatus[]>> = {
  draft: ["in_review"],
  in_review: ["draft", "accepted"],
  accepted: ["deprecated", "superseded"],
  deprecated: ["archived"],
  superseded: ["archived"],
  archived: [],
};

type ObjectRow = Readonly<{ revision: string | number; status: string; object: unknown }>;
type SerializedRow = Readonly<{ object: unknown }>;
type EventRow = Readonly<{ event: unknown }>;
type IdempotencyRow = Readonly<{ result: unknown }>;

/**
 * PostgreSQL adapter for the ADR-017 optional shared/team-profile
 * `KnowledgeRepository` seam (migration `0004_knowledge_repository`).
 * Mirrors `PostgresAgentRunRecordStore`'s transaction and Workspace-scope
 * (RLS via `qa.workspace_id`) shape, but — like `SqliteKnowledgeRepository` —
 * implements each `KnowledgeRepository` command/query directly rather than
 * through a generic `retainMutation` envelope, since the interface itself
 * already exposes direct per-operation methods.
 */
export class PostgresKnowledgeRepository implements KnowledgeRepository {
  readonly #database: PostgresTransactionManager;
  readonly #workspaceId: string;
  readonly #clock: Clock;

  constructor(dependencies: PostgresKnowledgeRepositoryDependencies) {
    if (dependencies.workspace_id.trim().length === 0) {
      throw new Error("A Workspace identity is required to open a PostgreSQL Knowledge Repository.");
    }
    this.#database = dependencies.database;
    this.#workspaceId = dependencies.workspace_id;
    this.#clock = dependencies.clock;
  }

  async createDraft(request: CreateKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);

        const existingByKey = await loadIdempotent(transaction, this.#workspaceId, request.idempotency_key);
        if (existingByKey !== undefined) return succeeded(existingByKey);

        const existing = await loadRow(transaction, this.#workspaceId, request.draft.id);
        if (existing !== undefined) return failure("conflict", `Knowledge Object "${request.draft.id}" already exists.`);
        if (request.draft.workspace_id !== "global" && request.draft.workspace_id !== request.context.workspace_id) {
          return failure("authorization_failure", "Draft Workspace does not match the trusted Workspace context.");
        }

        const object: KnowledgeObject = {
          ...request.draft,
          version: request.draft.version ?? "0.1.0",
          status: "draft",
          reviewed_at: this.#clock.now().toISOString(),
        };
        await insertObjectRow(transaction, this.#workspaceId, object, 1, this.#clock.now());
        await appendHistory(transaction, this.#workspaceId, object, 1, this.#clock.now());
        await appendEvent(transaction, this.#workspaceId, object.id, 1, null, "draft", request.context.actor_id, "created", request.context.policy_version, [], this.#clock.now());
        await saveIdempotent(transaction, this.#workspaceId, request.idempotency_key, object, this.#clock.now());
        return succeeded(object);
      });
    } catch {
      return failure("unavailable_dependency", "The createDraft transaction could not be committed.");
    }
  }

  async reviseDraft(request: ReviseKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const found = await requireRow(transaction, this.#workspaceId, request.id);
        if (!found.ok) return found;
        const { object, revision } = found.value;

        if (object.status !== "draft") {
          return failure("unsupported_transition", `Cannot revise a Knowledge Object in status "${object.status}"; only draft revisions are allowed.`);
        }
        const concurrency = checkRevision<KnowledgeObject>(revision, request.expected_revision);
        if (concurrency !== undefined) return concurrency;

        const revised: KnowledgeObject = { ...object, ...request.changes };
        await updateObjectRow(transaction, this.#workspaceId, revised, revision + 1, this.#clock.now());
        await appendHistory(transaction, this.#workspaceId, revised, revision + 1, this.#clock.now());
        await appendEvent(transaction, this.#workspaceId, object.id, revision + 1, object.status, revised.status, request.context.actor_id, request.reason, request.context.policy_version, [], this.#clock.now());
        return succeeded(revised);
      });
    } catch {
      return failure("unavailable_dependency", "The reviseDraft transaction could not be committed.");
    }
  }

  submitForReview(request: SubmitKnowledgeForReviewRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    return this.#transition(request.id, request.context, request.expected_revision, "in_review", request.context.actor_id, request.reason, request.context.policy_version, []);
  }

  recordDecision(request: RecordKnowledgeDecisionRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const nextStatus: KnowledgeObjectStatus = request.decision === "accept" ? "accepted" : "draft";
    return this.#transition(request.id, request.context, request.expected_revision, nextStatus, request.actor_id, request.reason, request.policy_version, []);
  }

  async promoteCandidate(request: PromoteKnowledgeCandidateRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const existing = await loadRow(transaction, this.#workspaceId, request.promoted_object.id);
        if (existing !== undefined) {
          const concurrency = checkRevision<KnowledgeObject>(existing.revision, request.expected_revision);
          if (concurrency !== undefined) return concurrency;
        } else if (request.expected_revision !== 0) {
          return failure("conflict", "expected_revision must be 0 when promoting a candidate into a new Knowledge Object.");
        }

        const object: KnowledgeObject = { ...request.promoted_object, status: "accepted", reviewed_at: this.#clock.now().toISOString() };
        const nextRevision = (existing?.revision ?? 0) + 1;
        if (existing === undefined) await insertObjectRow(transaction, this.#workspaceId, object, nextRevision, this.#clock.now());
        else await updateObjectRow(transaction, this.#workspaceId, object, nextRevision, this.#clock.now());
        await appendHistory(transaction, this.#workspaceId, object, nextRevision, this.#clock.now());
        await appendEvent(
          transaction,
          this.#workspaceId,
          object.id,
          nextRevision,
          existing?.object.status ?? null,
          "accepted",
          request.actor_id,
          request.reason,
          request.policy_version,
          [`candidate:${request.candidate_id}`],
          this.#clock.now(),
        );
        return succeeded(object);
      });
    } catch {
      return failure("unavailable_dependency", "The promoteCandidate transaction could not be committed.");
    }
  }

  deprecateOrSupersede(request: DeprecateOrSupersedeKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    if (request.mode === "supersede" && request.superseded_by_id === undefined) {
      return Promise.resolve(failure("validation_failure", "superseded_by_id is required when mode is supersede."));
    }
    return this.#transition(
      request.id,
      request.context,
      request.expected_revision,
      request.mode === "deprecate" ? "deprecated" : "superseded",
      request.actor_id,
      request.reason,
      request.policy_version,
      request.superseded_by_id !== undefined ? [`superseded_by:${request.superseded_by_id}`] : [],
    );
  }

  archive(request: ArchiveKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    return this.#transition(request.id, request.context, request.expected_revision, "archived", request.actor_id, request.reason, request.policy_version, []);
  }

  async getExactVersion(context: WorkspaceContext, id: string, version: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const result = await transaction.query<SerializedRow>({
          name: "knowledge_history_exact_version",
          text: `SELECT object FROM qa_knowledge_history WHERE workspace_id = $1 AND id = $2 AND version = $3 ORDER BY revision DESC LIMIT 1`,
          values: [this.#workspaceId, id, version],
        });
        const row = result.rows[0];
        if (row === undefined) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`);
        const object = row.object as KnowledgeObject;
        if (!isWorkspaceVisible(object, context)) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`);
        return succeeded(object);
      });
    } catch {
      return failure("unavailable_dependency", "The getExactVersion query could not be completed.");
    }
  }

  async getCurrentAccepted(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const found = await loadRow(transaction, this.#workspaceId, id);
        if (found === undefined) return failure("not_found", `Knowledge Object "${id}" has no accepted version.`);
        if (!isWorkspaceVisible(found.object, context)) return failure("not_found", `Knowledge Object "${id}" has no accepted version.`);
        if (found.object.status !== "accepted") return failure("not_found", `Knowledge Object "${id}" is not currently accepted.`);
        return succeeded(found.object);
      });
    } catch {
      return failure("unavailable_dependency", "The getCurrentAccepted query could not be completed.");
    }
  }

  async listHistory(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const result = await transaction.query<SerializedRow>({
          name: "knowledge_history_list",
          text: `SELECT object FROM qa_knowledge_history WHERE workspace_id = $1 AND id = $2 ORDER BY revision ASC`,
          values: [this.#workspaceId, id],
        });
        const objects = result.rows.map((row) => row.object as KnowledgeObject).filter((object) => isWorkspaceVisible(object, context));
        return succeeded(objects);
      });
    } catch {
      return failure("unavailable_dependency", "The listHistory query could not be completed.");
    }
  }

  async query(filter: KnowledgeQueryFilter): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const result = await transaction.query<SerializedRow>({
          name: "knowledge_query",
          text: `SELECT object FROM qa_knowledge_objects WHERE workspace_id = $1 OR workspace_id = 'global'`,
          values: [this.#workspaceId],
        });
        const objects = result.rows
          .map((row) => row.object as KnowledgeObject)
          .filter((object) => isWorkspaceVisible(object, filter.context))
          .filter((object) => filter.type === undefined || object.type === filter.type)
          .filter((object) => filter.status === undefined || filter.status.includes(object.status))
          .filter((object) => filter.include_global !== false || object.workspace_id !== "global");
        return succeeded(objects);
      });
    } catch {
      return failure("unavailable_dependency", "The query could not be completed.");
    }
  }

  async traverseRelationships(request: KnowledgeRelationshipTraversalRequest): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const startRow = await loadRow(transaction, this.#workspaceId, request.from_id);
        if (startRow === undefined || !isWorkspaceVisible(startRow.object, request.context)) {
          return failure("not_found", `Knowledge Object "${request.from_id}" not found.`);
        }

        const visited = new Set<string>([request.from_id]);
        let frontier = [startRow.object];
        const results: KnowledgeObject[] = [];
        for (let depth = 0; depth < request.max_depth && frontier.length > 0; depth += 1) {
          const next: KnowledgeObject[] = [];
          for (const object of frontier) {
            for (const relationshipRef of object.relationships) {
              const [relationshipType, targetId] = relationshipRef.split(":");
              if (relationshipType !== request.relationship || targetId === undefined || visited.has(targetId)) continue;
              const targetRow = await loadRow(transaction, this.#workspaceId, targetId);
              if (targetRow === undefined || !isWorkspaceVisible(targetRow.object, request.context)) continue;
              visited.add(targetId);
              results.push(targetRow.object);
              next.push(targetRow.object);
            }
          }
          frontier = next;
        }
        return succeeded(results);
      });
    } catch {
      return failure("unavailable_dependency", "The traverseRelationships query could not be completed.");
    }
  }

  async appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<KnowledgeRepositoryResult<KnowledgeLifecycleEvent>> {
    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        await transaction.query({
          name: "knowledge_lifecycle_event_append",
          text: `
            INSERT INTO qa_knowledge_lifecycle_events (workspace_id, id, event_id, revision, event, occurred_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
            ON CONFLICT DO NOTHING
          `,
          values: [this.#workspaceId, event.aggregate_id, event.event_id, event.revision, JSON.stringify(event), event.occurred_at],
        });
        return succeeded(event);
      });
    } catch {
      return failure("unavailable_dependency", "The appendLifecycleEvent transaction could not be committed.");
    }
  }

  async eventsFor(aggregateId: string): Promise<readonly KnowledgeLifecycleEvent[]> {
    return this.#database.transaction(async (transaction) => {
      await setWorkspaceScope(transaction, this.#workspaceId);
      const result = await transaction.query<EventRow>({
        name: "knowledge_lifecycle_events_list",
        text: `SELECT event FROM qa_knowledge_lifecycle_events WHERE workspace_id = $1 AND id = $2 ORDER BY revision ASC`,
        values: [this.#workspaceId, aggregateId],
      });
      return result.rows.map((row) => row.event as KnowledgeLifecycleEvent);
    });
  }

  #denyCrossWorkspace(context: WorkspaceContext): KnowledgeRepositoryResult<never> | undefined {
    if (context.workspace_id !== this.#workspaceId) {
      return failure("authorization_failure", "The requested Workspace does not match this adapter's configured Workspace.");
    }
    return undefined;
  }

  async #transition(
    id: string,
    context: WorkspaceContext,
    expectedRevision: number,
    toStatus: KnowledgeObjectStatus,
    actorId: string,
    reason: string,
    policyVersion: string,
    evidenceRefs: readonly string[],
  ): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(context);
    if (denied !== undefined) return denied;

    try {
      return await this.#database.transaction(async (transaction) => {
        await setWorkspaceScope(transaction, this.#workspaceId);
        const found = await requireRow(transaction, this.#workspaceId, id);
        if (!found.ok) return found;
        const { object, revision } = found.value;

        const concurrency = checkRevision<KnowledgeObject>(revision, expectedRevision);
        if (concurrency !== undefined) return concurrency;

        if (!ALLOWED_TRANSITIONS[object.status].includes(toStatus)) {
          return failure("unsupported_transition", `Cannot transition Knowledge Object "${id}" from "${object.status}" to "${toStatus}".`);
        }

        const transitioned: KnowledgeObject = { ...object, status: toStatus, reviewed_at: this.#clock.now().toISOString() };
        await updateObjectRow(transaction, this.#workspaceId, transitioned, revision + 1, this.#clock.now());
        await appendHistory(transaction, this.#workspaceId, transitioned, revision + 1, this.#clock.now());
        await appendEvent(transaction, this.#workspaceId, id, revision + 1, object.status, toStatus, actorId, reason, policyVersion, evidenceRefs, this.#clock.now());
        return succeeded(transitioned);
      });
    } catch {
      return failure("unavailable_dependency", "The transition transaction could not be committed.");
    }
  }
}

async function setWorkspaceScope(transaction: PostgresTransaction, workspaceId: string): Promise<void> {
  await transaction.query({
    name: "knowledge_workspace_scope_set",
    text: "SELECT set_config('qa.workspace_id', $1, true)",
    values: [workspaceId],
  });
}

async function loadRow(
  transaction: PostgresTransaction,
  workspaceId: string,
  id: string,
): Promise<Readonly<{ object: KnowledgeObject; revision: number }> | undefined> {
  const result = await transaction.query<ObjectRow>({
    name: "knowledge_object_load",
    text: `SELECT revision, status, object FROM qa_knowledge_objects WHERE workspace_id = $1 AND id = $2`,
    values: [workspaceId, id],
  });
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return { object: row.object as KnowledgeObject, revision: Number(row.revision) };
}

async function requireRow(
  transaction: PostgresTransaction,
  workspaceId: string,
  id: string,
): Promise<KnowledgeRepositoryResult<{ object: KnowledgeObject; revision: number }>> {
  const row = await loadRow(transaction, workspaceId, id);
  if (row === undefined) return failure("not_found", `Knowledge Object "${id}" not found.`);
  return succeeded<{ object: KnowledgeObject; revision: number }>(row);
}

async function insertObjectRow(
  transaction: PostgresTransaction,
  workspaceId: string,
  object: KnowledgeObject,
  revision: number,
  now: Date,
): Promise<void> {
  await transaction.query({
    name: "knowledge_object_insert",
    text: `
      INSERT INTO qa_knowledge_objects (workspace_id, id, revision, status, object, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz, $7::timestamptz)
    `,
    values: [workspaceId, object.id, revision, object.status, JSON.stringify(object), now.toISOString(), now.toISOString()],
  });
}

async function updateObjectRow(
  transaction: PostgresTransaction,
  workspaceId: string,
  object: KnowledgeObject,
  revision: number,
  now: Date,
): Promise<void> {
  await transaction.query({
    name: "knowledge_object_update",
    text: `
      UPDATE qa_knowledge_objects SET revision = $3, status = $4, object = $5::jsonb, updated_at = $6::timestamptz
      WHERE workspace_id = $1 AND id = $2
    `,
    values: [workspaceId, object.id, revision, object.status, JSON.stringify(object), now.toISOString()],
  });
}

async function appendHistory(
  transaction: PostgresTransaction,
  workspaceId: string,
  object: KnowledgeObject,
  revision: number,
  now: Date,
): Promise<void> {
  await transaction.query({
    name: "knowledge_history_append",
    text: `
      INSERT INTO qa_knowledge_history (workspace_id, id, revision, version, object, recorded_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
    `,
    values: [workspaceId, object.id, revision, object.version, JSON.stringify(object), now.toISOString()],
  });
}

async function appendEvent(
  transaction: PostgresTransaction,
  workspaceId: string,
  aggregateId: string,
  revision: number,
  fromStatus: string | null,
  toStatus: string,
  actorId: string,
  reason: string,
  policyVersion: string,
  evidenceRefs: readonly string[],
  now: Date,
): Promise<void> {
  const event: KnowledgeLifecycleEvent = {
    event_id: `${aggregateId}-r${revision}`,
    aggregate_id: aggregateId,
    aggregate_type: "knowledge_object",
    revision,
    from_status: fromStatus,
    to_status: toStatus,
    actor_id: actorId,
    reason,
    evidence_refs: evidenceRefs,
    policy_version: policyVersion,
    occurred_at: now.toISOString(),
  };
  await transaction.query({
    name: "knowledge_lifecycle_event_append_internal",
    text: `
      INSERT INTO qa_knowledge_lifecycle_events (workspace_id, id, event_id, revision, event, occurred_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
    `,
    values: [workspaceId, aggregateId, event.event_id, revision, JSON.stringify(event), event.occurred_at],
  });
}

async function loadIdempotent(
  transaction: PostgresTransaction,
  workspaceId: string,
  idempotencyKey: string,
): Promise<KnowledgeObject | undefined> {
  const result = await transaction.query<IdempotencyRow>({
    name: "knowledge_idempotency_load",
    text: `SELECT result FROM qa_knowledge_idempotency WHERE workspace_id = $1 AND idempotency_key = $2`,
    values: [workspaceId, idempotencyKey],
  });
  const row = result.rows[0];
  return row === undefined ? undefined : (row.result as KnowledgeObject);
}

async function saveIdempotent(
  transaction: PostgresTransaction,
  workspaceId: string,
  idempotencyKey: string,
  object: KnowledgeObject,
  now: Date,
): Promise<void> {
  await transaction.query({
    name: "knowledge_idempotency_save",
    text: `
      INSERT INTO qa_knowledge_idempotency (workspace_id, idempotency_key, result, recorded_at)
      VALUES ($1, $2, $3::jsonb, $4::timestamptz)
    `,
    values: [workspaceId, idempotencyKey, JSON.stringify(object), now.toISOString()],
  });
}

function checkRevision<Value>(actual: number, expected: number): KnowledgeRepositoryResult<Value> | undefined {
  if (actual !== expected) {
    return failure("conflict", `Expected revision ${expected} but found ${actual}.`);
  }
  return undefined;
}

function isWorkspaceVisible(object: KnowledgeObject, context: WorkspaceContext): boolean {
  return object.workspace_id === "global" || object.workspace_id === context.workspace_id;
}

function succeeded<Value>(value: Value): KnowledgeRepositoryResult<Value> {
  return { ok: true, value };
}

function failure<Value>(code: KnowledgeRepositoryFailureCode, message: string): KnowledgeRepositoryResult<Value> {
  return { ok: false, failure: { code, message, retryable: false } };
}
