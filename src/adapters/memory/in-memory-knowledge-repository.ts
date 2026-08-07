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

type StoredRecord = Readonly<{ object: KnowledgeObject; revision: number }>;

/** SPEC-102 §9: draft → in_review → accepted → deprecated → superseded | archived. */
const ALLOWED_TRANSITIONS: Readonly<Record<KnowledgeObjectStatus, readonly KnowledgeObjectStatus[]>> = {
  draft: ["in_review"],
  in_review: ["draft", "accepted"],
  accepted: ["deprecated", "superseded"],
  deprecated: ["archived"],
  superseded: ["archived"],
  archived: [],
};

/**
 * SPEC-401/SPEC-103's required reference adapter: an in-process,
 * deterministic `KnowledgeRepository` proving the command/query contract's
 * optimistic concurrency, lifecycle legality, immutability, and Workspace
 * isolation — the same "deterministic reference adapter proven against a
 * shared contract suite" pattern every other repository seam in this
 * codebase already uses (record-stores, outbox, workspace-authorizer).
 * Durable SQLite/PostgreSQL adapters behind this same interface are
 * separate, larger scope (ADR-017's local-first pattern), not attempted
 * here.
 */
export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  readonly #clock: Clock;
  readonly #objects = new Map<string, StoredRecord>();
  readonly #history = new Map<string, KnowledgeObject[]>();
  readonly #idempotency = new Map<string, KnowledgeObject>();
  readonly #events: KnowledgeLifecycleEvent[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async createDraft(request: CreateKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const existingByKey = this.#idempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    if (this.#objects.has(request.draft.id)) {
      return failure("conflict", `Knowledge Object "${request.draft.id}" already exists.`, false);
    }

    const object: KnowledgeObject = {
      ...request.draft,
      version: request.draft.version ?? "0.1.0",
      status: "draft",
      reviewed_at: this.#clock.now().toISOString(),
    };
    if (object.workspace_id !== "global" && object.workspace_id !== request.context.workspace_id) {
      return failure("authorization_failure", "Draft Workspace does not match the trusted Workspace context.", false);
    }

    this.#objects.set(object.id, { object, revision: 1 });
    this.#appendHistory(object);
    this.#idempotency.set(request.idempotency_key, object);
    this.#recordEvent(object.id, "knowledge_object", 1, null, "draft", request.context.actor_id, "created", request.context.policy_version, []);
    return { ok: true, value: object };
  }

  async reviseDraft(request: ReviseKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { object, revision } = found.value;

    if (object.status !== "draft") {
      return failure("unsupported_transition", `Cannot revise a Knowledge Object in status "${object.status}"; only draft revisions are allowed.`, false);
    }
    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;

    const revised: KnowledgeObject = { ...object, ...request.changes };
    this.#objects.set(object.id, { object: revised, revision: revision + 1 });
    this.#replaceLatestHistory(revised);
    this.#recordEvent(object.id, "knowledge_object", revision + 1, object.status, revised.status, request.context.actor_id, request.reason, request.context.policy_version, []);
    return { ok: true, value: revised };
  }

  async submitForReview(request: SubmitKnowledgeForReviewRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    return this.#transition(
      request.id,
      request.context,
      request.expected_revision,
      "in_review",
      request.context.actor_id,
      request.reason,
      request.context.policy_version,
      [],
    );
  }

  async recordDecision(request: RecordKnowledgeDecisionRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const nextStatus: KnowledgeObjectStatus = request.decision === "accept" ? "accepted" : "draft";
    return this.#transition(
      request.id,
      request.context,
      request.expected_revision,
      nextStatus,
      request.actor_id,
      request.reason,
      request.policy_version,
      [],
    );
  }

  async promoteCandidate(request: PromoteKnowledgeCandidateRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    // SPEC-102 §10: promotion creates or revises a Knowledge Object — the
    // candidate itself is never mutated into unversioned authority. The
    // candidate lifecycle (discovered/proposed/validating/promoted/...) is
    // owned by the Learning Engine (SPEC-105), out of this seam's scope;
    // this operation only performs the "create/revise the resulting
    // Knowledge Object" half SPEC-401 owns.
    const existing = this.#objects.get(request.promoted_object.id);
    if (existing !== undefined) {
      const concurrency = this.#checkRevision(existing.revision, request.expected_revision);
      if (!concurrency.ok) return concurrency;
    } else if (request.expected_revision !== 0) {
      return failure("conflict", "expected_revision must be 0 when promoting a candidate into a new Knowledge Object.", false);
    }

    const object: KnowledgeObject = {
      ...request.promoted_object,
      status: "accepted",
      reviewed_at: this.#clock.now().toISOString(),
    };
    const nextRevision = (existing?.revision ?? 0) + 1;
    this.#objects.set(object.id, { object, revision: nextRevision });
    if (existing === undefined) {
      this.#appendHistory(object);
    } else {
      this.#replaceLatestHistory(object);
    }
    this.#recordEvent(
      object.id,
      "knowledge_object",
      nextRevision,
      existing?.object.status ?? null,
      "accepted",
      request.actor_id,
      request.reason,
      request.policy_version,
      [`candidate:${request.candidate_id}`],
    );
    return { ok: true, value: object };
  }

  async deprecateOrSupersede(
    request: DeprecateOrSupersedeKnowledgeRequest,
  ): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    if (request.mode === "supersede" && request.superseded_by_id === undefined) {
      return failure("validation_failure", "superseded_by_id is required when mode is supersede.", false);
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
    return this.#transition(
      request.id,
      request.context,
      request.expected_revision,
      "archived",
      request.actor_id,
      request.reason,
      request.policy_version,
      [],
    );
  }

  async getExactVersion(
    context: WorkspaceContext,
    id: string,
    version: string,
  ): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const history = this.#history.get(id) ?? [];
    const match = history.find((candidate) => candidate.version === version);
    if (match === undefined) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`, false);
    if (!isWorkspaceVisible(match, context)) return failure("not_found", `No version "${version}" of Knowledge Object "${id}".`, false);
    return { ok: true, value: match };
  }

  async getCurrentAccepted(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>> {
    const found = this.#objects.get(id);
    if (found === undefined || !isWorkspaceVisible(found.object, context)) {
      return failure("not_found", `Knowledge Object "${id}" has no accepted version.`, false);
    }
    if (found.object.status !== "accepted") {
      return failure("not_found", `Knowledge Object "${id}" is not currently accepted.`, false);
    }
    return { ok: true, value: found.object };
  }

  async listHistory(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const history = (this.#history.get(id) ?? []).filter((entry) => isWorkspaceVisible(entry, context));
    return { ok: true, value: history };
  }

  async query(filter: KnowledgeQueryFilter): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const results = [...this.#objects.values()]
      .map((record) => record.object)
      .filter((object) => isWorkspaceVisible(object, filter.context))
      .filter((object) => filter.type === undefined || object.type === filter.type)
      .filter((object) => filter.status === undefined || filter.status.includes(object.status))
      .filter((object) => filter.include_global !== false || object.workspace_id !== "global");
    return { ok: true, value: results };
  }

  async traverseRelationships(
    request: KnowledgeRelationshipTraversalRequest,
  ): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>> {
    const start = this.#objects.get(request.from_id);
    if (start === undefined || !isWorkspaceVisible(start.object, request.context)) {
      return failure("not_found", `Knowledge Object "${request.from_id}" not found.`, false);
    }

    const visited = new Set<string>([request.from_id]);
    let frontier = [start.object];
    const results: KnowledgeObject[] = [];
    for (let depth = 0; depth < request.max_depth && frontier.length > 0; depth += 1) {
      const next: KnowledgeObject[] = [];
      for (const object of frontier) {
        for (const relationshipRef of object.relationships) {
          const [relationshipType, targetId] = relationshipRef.split(":");
          if (relationshipType !== request.relationship || targetId === undefined || visited.has(targetId)) continue;
          const target = this.#objects.get(targetId);
          if (target === undefined || !isWorkspaceVisible(target.object, request.context)) continue;
          visited.add(targetId);
          results.push(target.object);
          next.push(target.object);
        }
      }
      frontier = next;
    }
    return { ok: true, value: results };
  }

  async appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<KnowledgeRepositoryResult<KnowledgeLifecycleEvent>> {
    this.#events.push(event);
    return { ok: true, value: event };
  }

  /** Test/observability accessor — lifecycle events are otherwise write-only from a caller's perspective. */
  eventsFor(aggregateId: string): readonly KnowledgeLifecycleEvent[] {
    return this.#events.filter((event) => event.aggregate_id === aggregateId);
  }

  #requireOwned(
    id: string,
    context: WorkspaceContext,
  ): KnowledgeRepositoryResult<StoredRecord> {
    const found = this.#objects.get(id);
    if (found === undefined || !isWorkspaceVisible(found.object, context)) {
      return failure("not_found", `Knowledge Object "${id}" not found.`, false);
    }
    return { ok: true, value: found };
  }

  #checkRevision(actual: number, expected: number): KnowledgeRepositoryResult<true> {
    if (actual !== expected) {
      return failure("conflict", `Expected revision ${expected} but found ${actual}.`, false);
    }
    return { ok: true, value: true };
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
    const found = this.#requireOwned(id, context);
    if (!found.ok) return Promise.resolve(found);
    const { object, revision } = found.value;

    const concurrency = this.#checkRevision(revision, expectedRevision);
    if (!concurrency.ok) return Promise.resolve(concurrency);

    if (!ALLOWED_TRANSITIONS[object.status].includes(toStatus)) {
      return Promise.resolve(
        failure("unsupported_transition", `Cannot transition Knowledge Object "${id}" from "${object.status}" to "${toStatus}".`, false),
      );
    }

    const transitioned: KnowledgeObject = { ...object, status: toStatus, reviewed_at: this.#clock.now().toISOString() };
    this.#objects.set(id, { object: transitioned, revision: revision + 1 });
    this.#replaceLatestHistory(transitioned);
    this.#recordEvent(id, "knowledge_object", revision + 1, object.status, toStatus, actorId, reason, policyVersion, evidenceRefs);
    return Promise.resolve({ ok: true, value: transitioned });
  }

  #appendHistory(object: KnowledgeObject): void {
    const list = this.#history.get(object.id) ?? [];
    list.push(object);
    this.#history.set(object.id, list);
  }

  #replaceLatestHistory(object: KnowledgeObject): void {
    const list = this.#history.get(object.id) ?? [];
    if (list.length > 0) list[list.length - 1] = object;
    else list.push(object);
    this.#history.set(object.id, list);
  }

  #recordEvent(
    aggregateId: string,
    aggregateType: "knowledge_object" | "knowledge_candidate",
    revision: number,
    fromStatus: string | null,
    toStatus: string,
    actorId: string,
    reason: string,
    policyVersion: string,
    evidenceRefs: readonly string[],
  ): void {
    this.#events.push({
      event_id: `event-${this.#events.length + 1}`,
      aggregate_id: aggregateId,
      aggregate_type: aggregateType,
      revision,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: actorId,
      reason,
      evidence_refs: evidenceRefs,
      policy_version: policyVersion,
      occurred_at: this.#clock.now().toISOString(),
    });
  }
}

function isWorkspaceVisible(object: KnowledgeObject, context: WorkspaceContext): boolean {
  return object.workspace_id === "global" || object.workspace_id === context.workspace_id;
}

function failure<Value>(
  code: KnowledgeRepositoryFailureCode,
  message: string,
  retryable: boolean,
): KnowledgeRepositoryResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
