import type {
  KnowledgeCandidate,
  KnowledgeCandidateStatus,
  KnowledgeLifecycleEvent,
} from "../knowledge/public.js";
import type { WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-403 (Candidate Repository Component): "persists non-authoritative
 * Knowledge Candidates and Improvement Proposals throughout discovery,
 * validation, promotion, rejection, and expiry... SHALL NOT promote
 * candidates or expose them as accepted knowledge" (§1/§2). Reuses
 * `KnowledgeCandidate`/`KnowledgeCandidateStatus`/`KnowledgeLifecycleEvent`
 * from `src/knowledge/public.ts` (already SPEC-102 §8-conformant) rather
 * than redefining the same shape — this module adds only the
 * repository-specific command/query surface `KnowledgeRepository` doesn't
 * have (it only exposes `promoteCandidate`, the write-half of promotion;
 * candidate discovery/revision/evidence/lifecycle CRUD lives here).
 *
 * Mirrors `src/rule-repository/public.ts`'s adaptation of the
 * `InMemoryKnowledgeRepository` command/query pattern to a different
 * aggregate.
 */
export type CandidateRepositoryFailureCode =
  | "invalid_evidence"
  | "conflict"
  | "duplicate_observation"
  | "expired_candidate"
  | "unauthorized_transition"
  | "unavailable_storage"
  | "retention_failure"
  | "not_found"
  | "validation_failure";

export type CandidateRepositoryFailure = Readonly<{
  code: CandidateRepositoryFailureCode;
  message: string;
  retryable: boolean;
}>;

export type CandidateRepositoryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: CandidateRepositoryFailure }>;

export type CreateCandidateRequest = Readonly<{
  context: WorkspaceContext;
  candidate: Omit<KnowledgeCandidate, "status">;
  idempotency_key: string;
}>;

export type ReviseCandidateProposalRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  changes: Partial<Pick<KnowledgeCandidate, "rationale" | "proposed_claims" | "validation_plan" | "expires_at">>;
  reason: string;
}>;

export type AppendCandidateEvidenceRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  kind: "supporting" | "contradicting";
  evidence_refs: readonly string[];
  reason: string;
}>;

export type RecordCandidateValidationResultRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  outcome: "supports" | "contradicts" | "inconclusive";
  evidence_refs: readonly string[];
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type TransitionCandidateLifecycleRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  /** Never `"promoted"` — promotion is exclusively `linkPromotionResult`'s job (§4/§7). */
  to_status: Exclude<KnowledgeCandidateStatus, "promoted">;
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

/** SPEC-403 §4: an expired candidate cannot re-enter validation without explicit revival. */
export type ReviveCandidateRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  new_expires_at: string;
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type LinkCandidatePromotionResultRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  promoted_knowledge_ref: string;
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type CandidateQueryFilter = Readonly<{
  context: WorkspaceContext;
  owner?: string;
  status?: readonly KnowledgeCandidateStatus[];
  discovery_source?: string;
  expires_before?: string;
}>;

/** SPEC-403 §3's 7 core operations. */
export interface CandidateRepository {
  createIdempotent(request: CreateCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  reviseProposal(request: ReviseCandidateProposalRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  appendEvidence(request: AppendCandidateEvidenceRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  recordValidationResult(request: RecordCandidateValidationResultRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  transitionLifecycle(request: TransitionCandidateLifecycleRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  revive(request: ReviveCandidateRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  /** Records the promotion outcome without mutating the candidate's own history (§4: "provenance is never removed during promotion"). */
  linkPromotionResult(request: LinkCandidatePromotionResultRequest): Promise<CandidateRepositoryResult<KnowledgeCandidate>>;
  query(filter: CandidateQueryFilter): Promise<CandidateRepositoryResult<readonly KnowledgeCandidate[]>>;
  appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<CandidateRepositoryResult<KnowledgeLifecycleEvent>>;
}
