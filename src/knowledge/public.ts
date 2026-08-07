import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-401 (Knowledge Repository Component) / SPEC-103 (Knowledge Store):
 * "governed persistence and retrieval ports for accepted Knowledge
 * Objects, versions, claims, provenance, and relationships." Before this
 * module, only a read-only, fixed-seed `KnowledgeSearch` adapter
 * (`src/adapters/memory/knowledge-search.ts`, SPEC-501) existed — it has
 * no create/revise/promote/deprecate/archive commands and does not
 * implement SPEC-102's Knowledge Object model or lifecycle at all. This
 * module is the provider-neutral command/query interface SPEC-103 §6
 * requires; it does not replace `KnowledgeSearch` (still the seam Skills
 * search through) — it is what a caller who actually creates, revises, or
 * transitions Knowledge Objects writes against.
 */
export type KnowledgeObjectStatus =
  | "draft"
  | "in_review"
  | "accepted"
  | "deprecated"
  | "superseded"
  | "archived";

export type KnowledgeCandidateStatus =
  | "discovered"
  | "proposed"
  | "validating"
  | "promoted"
  | "rejected"
  | "expired";

export type KnowledgeAuthorityClass = "authoritative" | "corroborated" | "unverified";

/** SPEC-102 §5: a claim's stable identity plus everything a caller needs to judge it. */
export type KnowledgeClaim = Readonly<{
  claim_id: string;
  statement: string;
  source_refs: readonly string[];
  evidence_refs: readonly string[];
  applicability: JsonObject;
  confidence: number;
  validation_status: "unvalidated" | "validated" | "contradicted";
  contradiction_refs: readonly string[];
}>;

/** SPEC-102 §6: provenance is required, not decorative — unavailable provenance blocks promotion to accepted (§6, §17 quality gate). */
export type KnowledgeProvenance = Readonly<{
  source_type: string;
  source_id: string;
  source_version_or_captured_at: string;
  acquired_by: string;
  acquisition_method: string;
  transformation_history: readonly string[];
  workspace_scope: string | "global";
  integrity_digest?: string;
  ai_generated?: boolean;
}>;

/** SPEC-102 §4. */
export type KnowledgeObject = Readonly<{
  id: string;
  version: string;
  type: string;
  status: KnowledgeObjectStatus;
  workspace_id: string | "global";
  title: string;
  summary: string;
  claims: readonly KnowledgeClaim[];
  provenance: readonly KnowledgeProvenance[];
  authority: KnowledgeAuthorityClass;
  confidence: number;
  owner: string;
  applicability: JsonObject;
  relationships: readonly string[];
  valid_from: string;
  valid_until: string | null;
  reviewed_at: string;
  /** SPEC-102 §11: a new version links to what it supersedes rather than mutating history. */
  supersedes?: string;
}>;

/** SPEC-102 §8. */
export type KnowledgeCandidate = Readonly<{
  id: string;
  workspace_id: string;
  status: KnowledgeCandidateStatus;
  proposed_claims: readonly KnowledgeClaim[];
  discovery_source: string;
  rationale: string;
  supporting_evidence_refs: readonly string[];
  contradicting_evidence_refs: readonly string[];
  confidence: number;
  uncertainty_reasons: readonly string[];
  affected_knowledge_refs: readonly string[];
  validation_plan: string;
  owner: string;
  expires_at: string;
}>;

/** SPEC-102 §9: every transition SHALL record actor, reason, evidence, and policy version. */
export type KnowledgeLifecycleEvent = Readonly<{
  event_id: string;
  aggregate_id: string;
  aggregate_type: "knowledge_object" | "knowledge_candidate";
  revision: number;
  from_status: string | null;
  to_status: string;
  actor_id: string;
  reason: string;
  evidence_refs: readonly string[];
  policy_version: string;
  occurred_at: string;
}>;

export type KnowledgeRepositoryFailureCode =
  | "validation_failure"
  | "authorization_failure"
  | "conflict"
  | "not_found"
  | "unavailable_dependency"
  | "stale_index"
  | "integrity_violation"
  | "unsupported_transition";

export type KnowledgeRepositoryFailure = Readonly<{
  code: KnowledgeRepositoryFailureCode;
  message: string;
  retryable: boolean;
}>;

export type KnowledgeRepositoryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: KnowledgeRepositoryFailure }>;

export type CreateKnowledgeDraftRequest = Readonly<{
  context: WorkspaceContext;
  draft: Omit<KnowledgeObject, "status" | "version" | "reviewed_at"> & Readonly<{ version?: string }>;
  idempotency_key: string;
}>;

export type ReviseKnowledgeDraftRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  changes: Partial<Pick<KnowledgeObject, "title" | "summary" | "claims" | "applicability" | "provenance">>;
  reason: string;
}>;

export type SubmitKnowledgeForReviewRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  reason: string;
}>;

export type RecordKnowledgeDecisionRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  decision: "accept" | "reject";
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type PromoteKnowledgeCandidateRequest = Readonly<{
  context: WorkspaceContext;
  candidate_id: string;
  expected_revision: number;
  actor_id: string;
  reason: string;
  policy_version: string;
  /** SPEC-102 §10: promotion creates or revises a Knowledge Object; it never mutates the candidate into unversioned authority. */
  promoted_object: Omit<KnowledgeObject, "status" | "reviewed_at">;
}>;

export type DeprecateOrSupersedeKnowledgeRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  mode: "deprecate" | "supersede";
  superseded_by_id?: string;
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type ArchiveKnowledgeRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  actor_id: string;
  reason: string;
  policy_version: string;
}>;

export type KnowledgeQueryFilter = Readonly<{
  context: WorkspaceContext;
  type?: string;
  status?: readonly KnowledgeObjectStatus[];
  applicability?: JsonObject;
  include_global?: boolean;
}>;

export type KnowledgeRelationshipTraversalRequest = Readonly<{
  context: WorkspaceContext;
  from_id: string;
  relationship: string;
  max_depth: number;
}>;

/**
 * SPEC-103 §6's 13 core operations, grouped as commands (write, revision-
 * checked) and queries (read, Workspace-scoped). All writes identify
 * actor, Workspace, expected revision, and reason (§6).
 */
export interface KnowledgeRepository {
  // Commands
  createDraft(request: CreateKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  reviseDraft(request: ReviseKnowledgeDraftRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  submitForReview(request: SubmitKnowledgeForReviewRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  recordDecision(request: RecordKnowledgeDecisionRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  promoteCandidate(request: PromoteKnowledgeCandidateRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  deprecateOrSupersede(request: DeprecateOrSupersedeKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  archive(request: ArchiveKnowledgeRequest): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;

  // Queries
  getExactVersion(context: WorkspaceContext, id: string, version: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  getCurrentAccepted(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<KnowledgeObject>>;
  listHistory(context: WorkspaceContext, id: string): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>>;
  query(filter: KnowledgeQueryFilter): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>>;
  traverseRelationships(
    request: KnowledgeRelationshipTraversalRequest,
  ): Promise<KnowledgeRepositoryResult<readonly KnowledgeObject[]>>;
  appendLifecycleEvent(event: KnowledgeLifecycleEvent): Promise<KnowledgeRepositoryResult<KnowledgeLifecycleEvent>>;
}
