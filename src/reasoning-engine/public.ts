import type {
  ConsequenceClass,
  JsonObject,
  StableResult,
  VersionReference,
  WorkspaceContext,
} from "../requirement-review/public.js";

/**
 * SPEC-308 (Reasoning Engine Architecture): "coordinates deterministic
 * rules, governed knowledge retrieval, bounded AI inference, evidence
 * evaluation, and uncertainty reporting for decisions that cannot be
 * resolved by rules alone" (§1). This is a pure composition problem —
 * `WorkspaceAuthorizer`, `DeterministicRuleEngine` (SPEC-104/502),
 * `KnowledgeSearch` (SPEC-501), and `ReasoningProvider` (SPEC-507) all
 * already exist; this module only sequences them per §3's 8-step
 * pipeline and enforces §2's prohibitions ("SHALL NOT grant itself
 * authority, invent evidence, or persist conclusions as accepted
 * knowledge"). No new lower-level contract, no new persistence.
 */
export type ReasoningEngineKnowledgeQuery = Readonly<{
  query: string;
  scopes: readonly string[];
  applicability: JsonObject;
}>;

/** Present only when the caller has determined AI inference may be justified for this request (§2: "when justified"). */
export type ReasoningEngineAiCapability = Readonly<{
  prompt: VersionReference;
  output_schema: VersionReference;
  allowed_tools: readonly VersionReference[];
  safety_policy: VersionReference;
}>;

export type ReasoningEngineRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  purpose: string;
  consequence_class: ConsequenceClass;
  rule_set: VersionReference;
  knowledge_query: ReasoningEngineKnowledgeQuery;
  ai_capability?: ReasoningEngineAiCapability;
}>;

/** §6: "prefer indeterminate over unsupported certainty." */
export type ReasoningEngineOutcome = "resolved" | "indeterminate" | "blocked";

export type ReasoningEngineStatus = "rules_only" | "ai_invoked";

export type ReasoningEngineUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type ReasoningEngineModelIdentity = Readonly<{
  provider_id: string;
  provider_version: string;
  model_id: string;
}>;

/** SPEC-308 §4's Result Contract, field for field. */
export type ReasoningEngineResult = Readonly<{
  outcome: ReasoningEngineOutcome;
  status: ReasoningEngineStatus;
  deterministic_findings: readonly JsonObject[];
  inferred_claims: readonly JsonObject[];
  source_citations: readonly string[];
  contradictions: readonly string[];
  uncertainty: ReasoningEngineUncertainty;
  model_identity: ReasoningEngineModelIdentity | null;
  policy_version: string;
  workspace_id: string;
  required_human_action: string | null;
}>;

/**
 * SPEC-308 §6: distinct failure codes for missing authority, insufficient
 * evidence, provider failure, invalid output, policy denial, and unsafe
 * request. §6 also names "conflicting sources" as a distinct failure
 * mode, but `KnowledgeSearchHit` (SPEC-501) carries no claim/statement
 * field this engine could compare across hits to detect a real
 * contradiction — a free-text `warnings` substring match would be a
 * fabricated signal, not a real one, so that code is omitted until
 * SPEC-501 exposes something this engine can actually check.
 */
export type ReasoningEngineFailureCode =
  | "missing_authority"
  | "insufficient_evidence"
  | "provider_failure"
  | "invalid_output"
  | "policy_denial"
  | "unsafe_request"
  | "configuration_invalid";

export type ReasoningEngineFailure = Readonly<{
  code: ReasoningEngineFailureCode;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ReasoningEngineOutput = StableResult<ReasoningEngineResult, ReasoningEngineFailure>;
