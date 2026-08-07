import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export type SqliteKnowledgeRepositoryDependencies = Readonly<{
  database_path: string;
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

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS qa_knowledge_objects (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    status TEXT NOT NULL,
    object TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id)
  );

  CREATE TABLE IF NOT EXISTS qa_knowledge_history (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    version TEXT NOT NULL,
    object TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id, revision)
  );

  CREATE TABLE IF NOT EXISTS qa_knowledge_lifecycle_events (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    event TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, id, event_id)
  );

  CREATE TABLE IF NOT EXISTS qa_knowledge_idempotency (
    workspace_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    result TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, idempotency_key)
  );
`;

type Row = Readonly<{ workspace_id: string; id: string; revision: number; status: string; object: string }>;

/**
 * Local-first SQLite adapter for `KnowledgeRepository` (ADR-017): one
 * database file per Workspace, matching the same pattern
 * `SqliteEvaluationCampaignRecordStore`/`SqliteAgentRunRecordStore` already
 * use — one seam per aggregate, no shared cross-aggregate schema. Unlike
 * those two (which implement a generic `retainMutation` envelope over an
 * event-sourced aggregate), `KnowledgeRepository`'s interface already
 * exposes direct per-operation commands, so this adapter implements each
 * one directly against SQLite rows rather than through a mutation
 * indirection layer — the concurrency and lifecycle rules are identical to
 * `InMemoryKnowledgeRepository`, only the storage is durable.
 */
export class SqliteKnowledgeRepository implements KnowledgeRepository {
  readonly #database: DatabaseSync;
  readonly #workspaceId: string;
  readonly #clock: Clock;

  constructor(dependencies: SqliteKnowledgeRepositoryDependencies) {
    if (dependencies.workspace_id.trim().length === 0) {
      throw new Error("A Workspace identity is required to open a local Knowledge Repository database.");
    }
    mkdirSync(dirname(dependencies.database_path), { recursive: true });
    this.#workspaceId = dependencies.workspace_id;
    this.#clock = dependencies.clock;
    this.#database = new DatabaseSync(dependencies.database_path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#database.exec(SCHEMA);
  }

  close(): void {
    this.#database.close();
  }

  async createDraft(request: CreateKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    return this.#transaction<KnowledgeObject>(() => {
      const existingByKey = this.#loadIdempotent(request.idempotency_key);
      if (existingByKey !== undefined) return succeeded(existingByKey);

      if (this.#loadRow(request.draft.id) !== undefined) {
        return failure("conflict", `Knowledge Object "${request.draft.id}" already exists.`);
      }
      if (request.draft.workspace_id !== "global" && request.draft.workspace_id !== request.context.workspace_id) {
        return failure("authorization_failure", "Draft Workspace does not match the trusted Workspace context.");
      }

      const object: KnowledgeObject = {
        ...request.draft,
        version: request.draft.version ?? "0.1.0",
        status: "draft",
        reviewed_at: this.#clock.now().toISOString(),
      };
      this.#insertRow(object, 1);
      this.#appendHistory(object, 1);
      this.#appendEvent(object.id, 1, null, "draft", request.context.actor_id, "created", request.context.policy_version, []);
      this.#saveIdempotent(request.idempotency_key, object);
      return succeeded(object);
    });
  }

  async reviseDraft(request: ReviseKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    return this.#transaction<KnowledgeObject>(() => {
      const found = this.#requireRow(request.id);
      if (!found.ok) return found;
      const { object, revision } = found.value;

      if (object.status !== "draft") {
        return failure("unsupported_transition", `Cannot revise a Knowledge Object in status "${object.status}"; only draft revisions are allowed.`);
      }
      const concurrency = checkRevision<KnowledgeObject>(revision, request.expected_revision);
      if (concurrency !== undefined) return concurrency;

      const revised: KnowledgeObject = { ...object, ...request.changes };
      this.#updateRow(revised, revision + 1);
      this.#appendHistory(revised, revision + 1);
      this.#appendEvent(object.id, revision + 1, object.status, revised.status, request.context.actor_id, request.reason, request.context.policy_version, []);
      return succeeded(revised);
    });
  }

  async submitForReview(request: SubmitKnowledgeForReviewRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    return this.#transition(request.id, request.context, request.expected_revision, "in_review", request.context.actor_id, request.reason, request.context.policy_version, []);
  }

  async recordDecision(request: RecordKnowledgeDecisionRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const nextStatus: KnowledgeObjectStatus = request.decision === "accept" ? "accepted" : "draft";
    return this.#transition(request.id, request.context, request.expected_revision, nextStatus, request.actor_id, request.reason, request.policy_version, []);
  }

  async promoteCandidate(request: PromoteKnowledgeCandidateRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const denied = this.#denyCrossWorkspace(request.context);
    if (denied !== undefined) return denied;

    return this.#transaction<KnowledgeObject>(() => {
      const existing = this.#loadRow(request.promoted_object.id);
      if (existing !== undefined) {
        const concurrency = checkRevision<KnowledgeObject>(existing.revision, request.expected_revision);
        if (concurrency !== undefined) return concurrency;
      } else if (request.expected_revision !== 0) {
        return failure("conflict", "expected_revision must be 0 when promoting a candidate into a new Knowledge Object.");
      }

      const object: KnowledgeObject = { ...request.promoted_object, status: "accepted", reviewed_at: this.#clock.now().toISOString() };
      const nextRevision = (existing?.revision ?? 0) + 1;
      if (existing === undefined) this.#insertRow(object, nextRevision);
      else this.#updateRow(object, nextRevision);
      this.#appendHistory(object, nextRevision);
      this.#appendEvent(
        object.id,
        nextRevision,
        existing?.status ?? null,
        "accepted",
        request.actor_id,
        request.reason,
        request.policy_version,
        [`candidate:${request.candidate_id}`],
      );
      return succeeded(object);
    });
  }

  async deprecateOrSupersede(request: DeprecateOrSupersedeKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    if (request.mode === "supersede" && request.superseded_by_id === undefined) {
      return failure("validation_failure", "superseded_by_id is required when mode is supersede.");
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

  async archive(request: ArchiveKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    return this.#transition(request.id, request.context, request.expected_revision, "archived", request.actor_id, request.reason, request.policy_version, []);
  }

  async getExactVersion(context: WorkspaceContext, id: string, version: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const rows = this.#database
      .prepare(`SELECT object FROM qa_knowledge_history WHERE workspace_id = ? AND id = ? AND version = ? ORDER BY revision DESC LIMIT 1`)
      .all(this.#workspaceId, id, version) as unknown as readonly { object: string }[];
    const row = rows[0];
    if (row === undefined) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`);
    const object = JSON.parse(row.object) as KnowledgeObject;
    if (!isWorkspaceVisible(object, context)) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`);
    return succeeded(object);
  }

  async getCurrentAccepted(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const found = this.#loadRow(id);
    if (found === undefined) return failure("not_found", `Knowledge Object "${id}" has no accepted version.`);
    const object = JSON.parse(found.object) as KnowledgeObject;
    if (!isWorkspaceVisible(object, context)) return failure("not_found", `Knowledge Object "${id}" has no accepted version.`);
    if (object.status !== "accepted") return failure("not_found", `Knowledge Object "${id}" is not currently accepted.`);
    return succeeded(object);
  }

  async listHistory(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const rows = this.#database
      .prepare(`SELECT object FROM qa_knowledge_history WHERE workspace_id = ? AND id = ? ORDER BY revision ASC`)
      .all(this.#workspaceId, id) as unknown as readonly { object: string }[];
    const objects = rows.map((row) => JSON.parse(row.object) as KnowledgeObject).filter((object) => isWorkspaceVisible(object, context));
    return succeeded(objects);
  }

  async query(filter: KnowledgeQueryFilter): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const rows = this.#database.prepare(`SELECT object FROM qa_knowledge_objects WHERE workspace_id = ?`).all(this.#workspaceId) as unknown as readonly { object: string }[];
    const objects = rows
      .map((row) => JSON.parse(row.object) as KnowledgeObject)
      .filter((object) => isWorkspaceVisible(object, filter.context))
      .filter((object) => filter.type === undefined || object.type === filter.type)
      .filter((object) => filter.status === undefined || filter.status.includes(object.status))
      .filter((object) => filter.include_global !== false || object.workspace_id !== "global");
    return succeeded(objects);
  }

  async traverseRelationships(request: KnowledgeRelationshipTraversalRequest): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const startRow = this.#loadRow(request.from_id);
    if (startRow === undefined) return failure("not_found", `Knowledge Object "${request.from_id}" not found.`);
    const start = JSON.parse(startRow.object) as KnowledgeObject;
    if (!isWorkspaceVisible(start, request.context)) return failure("not_found", `Knowledge Object "${request.from_id}" not found.`);

    const visited = new Set<string>([request.from_id]);
    let frontier = [start];
    const results: KnowledgeObject[] = [];
    for (let depth = 0; depth < request.max_depth && frontier.length > 0; depth += 1) {
      const next: KnowledgeObject[] = [];
      for (const object of frontier) {
        for (const relationshipRef of object.relationships) {
          const [relationshipType, targetId] = relationshipRef.split(":");
          if (relationshipType !== request.relationship || targetId === undefined || visited.has(targetId)) continue;
          const targetRow = this.#loadRow(targetId);
          if (targetRow === undefined) continue;
          const target = JSON.parse(targetRow.object) as KnowledgeObject;
          if (!isWorkspaceVisible(target, request.context)) continue;
          visited.add(targetId);
          results.push(target);
          next.push(target);
        }
      }
      frontier = next;
    }
    return succeeded(results);
  }

  async appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<KnowledgeRepositoryResult<KnowledgeLifecycleEvent>> {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO qa_knowledge_lifecycle_events (workspace_id, id, event_id, revision, event, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.#workspaceId, event.aggregate_id, event.event_id, event.revision, JSON.stringify(event), event.occurred_at);
    return succeeded(event);
  }

  /** Test/observability accessor, mirroring InMemoryKnowledgeRepository.eventsFor(). */
  eventsFor(aggregateId: string): readonly KnowledgeLifecycleEvent[] {
    const rows = this.#database
      .prepare(`SELECT event FROM qa_knowledge_lifecycle_events WHERE workspace_id = ? AND id = ? ORDER BY revision ASC`)
      .all(this.#workspaceId, aggregateId) as unknown as readonly { event: string }[];
    return rows.map((row) => JSON.parse(row.event) as KnowledgeLifecycleEvent);
  }

  #transition(
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
    if (denied !== undefined) return Promise.resolve(denied);

    return this.#transaction<KnowledgeObject>(() => {
      const found = this.#requireRow(id);
      if (!found.ok) return found;
      const { object, revision } = found.value;

      const concurrency = checkRevision<KnowledgeObject>(revision, expectedRevision);
      if (concurrency !== undefined) return concurrency;

      if (!ALLOWED_TRANSITIONS[object.status].includes(toStatus)) {
        return failure("unsupported_transition", `Cannot transition Knowledge Object "${id}" from "${object.status}" to "${toStatus}".`);
      }

      const transitioned: KnowledgeObject = { ...object, status: toStatus, reviewed_at: this.#clock.now().toISOString() };
      this.#updateRow(transitioned, revision + 1);
      this.#appendHistory(transitioned, revision + 1);
      this.#appendEvent(id, revision + 1, object.status, toStatus, actorId, reason, policyVersion, evidenceRefs);
      return succeeded(transitioned);
    });
  }

  #denyCrossWorkspace(context: WorkspaceContext): KnowledgeRepositoryResult<never> | undefined {
    if (context.workspace_id !== this.#workspaceId) {
      return failure("authorization_failure", "The requested Workspace does not match this local database file.");
    }
    return undefined;
  }

  #transaction<Value>(operation: () => KnowledgeRepositoryResult<Value>): Promise<KnowledgeRepositoryResult<Value>> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return Promise.resolve(result);
    } catch (error) {
      this.#database.exec("ROLLBACK");
      return Promise.resolve(failure("unavailable_dependency", error instanceof Error ? error.message : "Transaction failed."));
    }
  }

  #loadRow(id: string): Row | undefined {
    return this.#database
      .prepare(`SELECT workspace_id, id, revision, status, object FROM qa_knowledge_objects WHERE workspace_id = ? AND id = ?`)
      .get(this.#workspaceId, id) as unknown as Row | undefined;
  }

  #requireRow(id: string): KnowledgeRepositoryResult<{ object: KnowledgeObject; revision: number }> {
    const row = this.#loadRow(id);
    if (row === undefined) return failure("not_found", `Knowledge Object "${id}" not found.`);
    return succeeded<{ object: KnowledgeObject; revision: number }>({
      object: JSON.parse(row.object) as KnowledgeObject,
      revision: row.revision,
    });
  }

  #insertRow(object: KnowledgeObject, revision: number): void {
    const now = this.#clock.now().toISOString();
    this.#database
      .prepare(`INSERT INTO qa_knowledge_objects (workspace_id, id, revision, status, object, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(this.#workspaceId, object.id, revision, object.status, JSON.stringify(object), now, now);
  }

  #updateRow(object: KnowledgeObject, revision: number): void {
    this.#database
      .prepare(`UPDATE qa_knowledge_objects SET revision = ?, status = ?, object = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`)
      .run(revision, object.status, JSON.stringify(object), this.#clock.now().toISOString(), this.#workspaceId, object.id);
  }

  #appendHistory(object: KnowledgeObject, revision: number): void {
    this.#database
      .prepare(`INSERT INTO qa_knowledge_history (workspace_id, id, revision, version, object, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(this.#workspaceId, object.id, revision, object.version, JSON.stringify(object), this.#clock.now().toISOString());
  }

  #appendEvent(
    aggregateId: string,
    revision: number,
    fromStatus: string | null,
    toStatus: string,
    actorId: string,
    reason: string,
    policyVersion: string,
    evidenceRefs: readonly string[],
  ): void {
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
      occurred_at: this.#clock.now().toISOString(),
    };
    this.#database
      .prepare(`INSERT INTO qa_knowledge_lifecycle_events (workspace_id, id, event_id, revision, event, occurred_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(this.#workspaceId, aggregateId, event.event_id, revision, JSON.stringify(event), event.occurred_at);
  }

  #loadIdempotent(idempotencyKey: string): KnowledgeObject | undefined {
    const row = this.#database
      .prepare(`SELECT result FROM qa_knowledge_idempotency WHERE workspace_id = ? AND idempotency_key = ?`)
      .get(this.#workspaceId, idempotencyKey) as { result: string } | undefined;
    return row === undefined ? undefined : (JSON.parse(row.result) as KnowledgeObject);
  }

  #saveIdempotent(idempotencyKey: string, object: KnowledgeObject): void {
    this.#database
      .prepare(`INSERT INTO qa_knowledge_idempotency (workspace_id, idempotency_key, result, recorded_at) VALUES (?, ?, ?, ?)`)
      .run(this.#workspaceId, idempotencyKey, JSON.stringify(object), this.#clock.now().toISOString());
  }
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
