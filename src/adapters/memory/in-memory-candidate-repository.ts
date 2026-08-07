import type {
  AppendCandidateEvidenceRequest,
  CandidateQueryFilter,
  CandidateRepository,
  CandidateRepositoryFailureCode,
  CandidateRepositoryResult,
  CreateCandidateRequest,
  LinkCandidatePromotionResultRequest,
  RecordCandidateValidationResultRequest,
  ReviseCandidateProposalRequest,
  ReviveCandidateRequest,
  TransitionCandidateLifecycleRequest,
} from "../../candidate-repository/public.js";
import type { KnowledgeCandidate, KnowledgeCandidateStatus, KnowledgeLifecycleEvent } from "../../knowledge/public.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

type StoredRecord = Readonly<{ candidate: KnowledgeCandidate; revision: number }>;

/**
 * SPEC-102 §8's candidate lifecycle. `promoted` is reachable only from
 * `validating` and only through `linkPromotionResult` — `transitionLifecycle`
 * itself cannot target it (enforced at the type level by
 * `TransitionCandidateLifecycleRequest["to_status"]` excluding `"promoted"`),
 * making "accidental authority promotion structurally impossible"
 * (SPEC-403 §7) rather than a runtime-only check.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<KnowledgeCandidateStatus, readonly KnowledgeCandidateStatus[]>> = {
  discovered: ["proposed", "rejected", "expired"],
  proposed: ["validating", "rejected", "expired"],
  validating: ["promoted", "rejected", "expired"],
  promoted: [],
  rejected: [],
  expired: ["proposed"],
};

/**
 * SPEC-403's required reference adapter: an in-process, deterministic
 * `CandidateRepository` proving promotion separation, expiry/revival,
 * duplicate-observation idempotency, evidence retention, lifecycle
 * authorization, and Workspace isolation — the same "deterministic
 * reference adapter" pattern `InMemoryKnowledgeRepository` and
 * `InMemoryRuleRepository` established. Durable backends are separate,
 * larger scope, not attempted here.
 */
export class InMemoryCandidateRepository implements CandidateRepository {
  readonly #clock: Clock;
  readonly #candidates = new Map<string, StoredRecord>();
  readonly #idempotency = new Map<string, KnowledgeCandidate>();
  readonly #events: KnowledgeLifecycleEvent[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async createIdempotent(request: CreateCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const existingByKey = this.#idempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    if (this.#candidates.has(request.candidate.id)) {
      return failure("duplicate_observation", `Candidate "${request.candidate.id}" already exists.`, false);
    }
    if (request.candidate.workspace_id !== request.context.workspace_id) {
      return failure("validation_failure", "Candidate Workspace does not match the trusted Workspace context.", false);
    }

    const candidate: KnowledgeCandidate = { ...request.candidate, status: "discovered" };
    this.#candidates.set(candidate.id, { candidate, revision: 1 });
    this.#idempotency.set(request.idempotency_key, candidate);
    this.#recordEvent(candidate.id, 1, null, "discovered", request.context.actor_id, "created", request.context.policy_version, []);
    return { ok: true, value: candidate };
  }

  async reviseProposal(request: ReviseCandidateProposalRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    const expiry = this.#checkNotExpired(candidate);
    if (!expiry.ok) return expiry;

    const revised: KnowledgeCandidate = { ...candidate, ...request.changes };
    this.#candidates.set(candidate.id, { candidate: revised, revision: revision + 1 });
    this.#recordEvent(candidate.id, revision + 1, candidate.status, revised.status, request.context.actor_id, request.reason, request.context.policy_version, []);
    return { ok: true, value: revised };
  }

  async appendEvidence(request: AppendCandidateEvidenceRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    const expiry = this.#checkNotExpired(candidate);
    if (!expiry.ok) return expiry;
    if (request.evidence_refs.length === 0) {
      return failure("invalid_evidence", "At least one evidence reference is required.", false);
    }

    // SPEC-403 §4: provenance is never removed — both supporting and
    // contradicting evidence are append-only, never replaced.
    const revised: KnowledgeCandidate =
      request.kind === "supporting"
        ? { ...candidate, supporting_evidence_refs: [...candidate.supporting_evidence_refs, ...request.evidence_refs] }
        : { ...candidate, contradicting_evidence_refs: [...candidate.contradicting_evidence_refs, ...request.evidence_refs] };
    this.#candidates.set(candidate.id, { candidate: revised, revision: revision + 1 });
    this.#recordEvent(candidate.id, revision + 1, candidate.status, candidate.status, request.context.actor_id, request.reason, request.context.policy_version, request.evidence_refs);
    return { ok: true, value: revised };
  }

  async recordValidationResult(request: RecordCandidateValidationResultRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    const expiry = this.#checkNotExpired(candidate);
    if (!expiry.ok) return expiry;

    const revised: KnowledgeCandidate =
      request.outcome === "contradicts"
        ? { ...candidate, contradicting_evidence_refs: [...candidate.contradicting_evidence_refs, ...request.evidence_refs] }
        : request.outcome === "supports"
          ? { ...candidate, supporting_evidence_refs: [...candidate.supporting_evidence_refs, ...request.evidence_refs] }
          : candidate;
    this.#candidates.set(candidate.id, { candidate: revised, revision: revision + 1 });
    this.#recordEvent(candidate.id, revision + 1, candidate.status, candidate.status, request.actor_id, request.reason, request.policy_version, request.evidence_refs);
    return { ok: true, value: revised };
  }

  async transitionLifecycle(request: TransitionCandidateLifecycleRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    if (request.to_status !== "expired") {
      const expiry = this.#checkNotExpired(candidate);
      if (!expiry.ok) return expiry;
    }
    if (!ALLOWED_TRANSITIONS[candidate.status].includes(request.to_status)) {
      return failure(
        "unauthorized_transition",
        `Cannot transition Candidate "${request.id}" from "${candidate.status}" to "${request.to_status}".`,
        false,
      );
    }

    const transitioned: KnowledgeCandidate = { ...candidate, status: request.to_status };
    this.#candidates.set(candidate.id, { candidate: transitioned, revision: revision + 1 });
    this.#recordEvent(candidate.id, revision + 1, candidate.status, request.to_status, request.actor_id, request.reason, request.policy_version, []);
    return { ok: true, value: transitioned };
  }

  async revive(request: ReviveCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    if (candidate.status !== "expired") {
      return failure("unauthorized_transition", `Cannot revive Candidate "${request.id}" from status "${candidate.status}".`, false);
    }

    const revived: KnowledgeCandidate = { ...candidate, status: "proposed", expires_at: request.new_expires_at };
    this.#candidates.set(candidate.id, { candidate: revived, revision: revision + 1 });
    this.#recordEvent(candidate.id, revision + 1, "expired", "proposed", request.actor_id, request.reason, request.policy_version, []);
    return { ok: true, value: revived };
  }

  async linkPromotionResult(request: LinkCandidatePromotionResultRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { candidate, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    // SPEC-403 §4/§7: only reachable from "validating" — the same
    // structural guard `ALLOWED_TRANSITIONS` uses, kept independent so
    // `transitionLifecycle`'s type-level exclusion of "promoted" cannot be
    // bypassed by calling this method from the wrong status either.
    if (candidate.status !== "validating") {
      return failure("unauthorized_transition", `Cannot promote Candidate "${request.id}" from status "${candidate.status}".`, false);
    }

    const promoted: KnowledgeCandidate = {
      ...candidate,
      status: "promoted",
      affected_knowledge_refs: [...candidate.affected_knowledge_refs, request.promoted_knowledge_ref],
    };
    this.#candidates.set(candidate.id, { candidate: promoted, revision: revision + 1 });
    this.#recordEvent(
      candidate.id,
      revision + 1,
      "validating",
      "promoted",
      request.actor_id,
      request.reason,
      request.policy_version,
      [`knowledge:${request.promoted_knowledge_ref}`],
    );
    return { ok: true, value: promoted };
  }

  async query(filter: CandidateQueryFilter): Promise<CandidateRepositoryResult<readonly KnowledgeCandidate[]>> {
    // SPEC-403 §4: cross-Workspace search is denied by default — only the
    // requesting context's own Workspace is visible, with no "global"
    // candidate scope (unlike Knowledge Objects, candidates are never
    // Workspace-neutral per SPEC-102 §8).
    const results = [...this.#candidates.values()]
      .map((stored) => stored.candidate)
      .filter((candidate) => candidate.workspace_id === filter.context.workspace_id)
      .filter((candidate) => filter.owner === undefined || candidate.owner === filter.owner)
      .filter((candidate) => filter.status === undefined || filter.status.includes(candidate.status))
      .filter((candidate) => filter.discovery_source === undefined || candidate.discovery_source === filter.discovery_source)
      .filter((candidate) => filter.expires_before === undefined || candidate.expires_at < filter.expires_before);
    return { ok: true, value: results };
  }

  async appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<CandidateRepositoryResult<KnowledgeLifecycleEvent>> {
    this.#events.push(event);
    return { ok: true, value: event };
  }

  /** Test/observability accessor — lifecycle events are otherwise write-only from a caller's perspective. */
  eventsFor(aggregateId: string): readonly KnowledgeLifecycleEvent[] {
    return this.#events.filter((event) => event.aggregate_id === aggregateId);
  }

  #requireOwned(id: string, context: WorkspaceContext): CandidateRepositoryResult<StoredRecord> {
    const found = this.#candidates.get(id);
    if (found === undefined || found.candidate.workspace_id !== context.workspace_id) {
      return failure("not_found", `Candidate "${id}" not found.`, false);
    }
    return { ok: true, value: found };
  }

  #checkRevision(actual: number, expected: number): CandidateRepositoryResult<true> {
    if (actual !== expected) {
      return failure("conflict", `Expected revision ${expected} but found ${actual}.`, false);
    }
    return { ok: true, value: true };
  }

  #checkNotExpired(candidate: KnowledgeCandidate): CandidateRepositoryResult<true> {
    if (candidate.status === "expired" || candidate.expires_at <= this.#clock.now().toISOString()) {
      return failure("expired_candidate", `Candidate "${candidate.id}" is expired and cannot re-enter validation without revival.`, false);
    }
    return { ok: true, value: true };
  }

  #recordEvent(
    aggregateId: string,
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
      aggregate_type: "knowledge_candidate",
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

function failure<Value>(code: CandidateRepositoryFailureCode, message: string, retryable: boolean): CandidateRepositoryResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
