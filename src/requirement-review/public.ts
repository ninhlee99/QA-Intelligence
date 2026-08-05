/** Provider-neutral public contracts for the Requirement Review tracer bullet. */

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | JsonObject
  | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type StableResult<Value, Failure> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: Failure }>;

export type VersionReference = Readonly<{
  id: string;
  version: string;
}>;

export type ConsequenceClass =
  | "advisory"
  | "reversible"
  | "controlled_side_effect"
  | "high_consequence";

export type RequirementStatus =
  | "draft"
  | "in_review"
  | "accepted"
  | "implemented"
  | "verified"
  | "deprecated"
  | "superseded";

export type RequirementTraceability = Readonly<{
  relationship: string;
  target_id: string;
}>;

/** Mirrors schemas/requirement.schema.json. */
export type Requirement = Readonly<{
  id: string;
  version: string;
  status: RequirementStatus;
  title: string;
  statement: string;
  source: readonly string[];
  owner: string;
  capability_id: string;
  scope: JsonObject;
  /** SPEC-202 §4: why the requirement exists, not repeated statement text. */
  rationale?: string;
  acceptance_criteria: readonly JsonObject[];
  assumptions?: readonly string[];
  traceability: readonly RequirementTraceability[];
}>;

export type RequirementAssessmentOutcome =
  | "completed"
  | "indeterminate"
  | "blocked";

export type RequirementQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type RequirementFindingCategory =
  | "atomicity"
  | "clarity"
  | "completeness"
  | "consistency"
  | "correctness_against_authority"
  | "feasibility"
  | "necessity"
  | "testability"
  | "traceability"
  | "applicability"
  | "security_and_privacy"
  | "workspace_safety"
  | "ambiguity"
  | "risk"
  | "missing_acceptance_criterion";

export type FindingSeverity = "critical" | "high" | "medium" | "low";

export type RequirementFinding = Readonly<{
  id: string;
  category: RequirementFindingCategory;
  severity: FindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type AssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type RequirementAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  prompt: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
}>;

/** Mirrors schemas/requirement-assessment.schema.json. */
export type RequirementAssessment = Readonly<{
  id: string;
  requirement_ref: string;
  workspace_id: string;
  /** Runtime completion status; never use this as the quality decision. */
  outcome: RequirementAssessmentOutcome;
  /** Requirement-quality decision from SPEC-203. */
  verdict: RequirementQualityVerdict;
  findings: readonly RequirementFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: AssessmentUncertainty;
  resolved_versions: RequirementAssessmentResolvedVersions;
}>;

export type WorkspaceAdministrativeScope = Readonly<{
  purpose: string;
  target_workspace_ids: readonly string[];
  approval_ref: string;
}>;

/** Trusted, immutable context issued according to SPEC-506. */
export type WorkspaceContext = Readonly<{
  schema_version: string;
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  roles: readonly string[];
  permissions: readonly string[];
  policy_version: string;
  request_id: string;
  correlation_id: string;
  audience: readonly string[];
  environment: string;
  issued_at: string;
  expires_at: string;
  issuer: string;
  integrity_proof: string;
  administrative_scope?: WorkspaceAdministrativeScope;
}>;

export type WorkspaceAuthorizationRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  purpose: string;
  consequence_class: ConsequenceClass;
  required_permissions: readonly string[];
  resource_refs: readonly string[];
}>;

export type WorkspaceAuthorization = Readonly<{
  policy_version: string;
  effective_permissions: readonly string[];
  authorized_resource_refs: readonly string[];
  decision_evidence: readonly string[];
}>;

export type WorkspaceAuthorizationFailure = Readonly<{
  code:
    | "missing_context"
    | "expired_context"
    | "invalid_context"
    | "wrong_audience"
    | "stale_policy"
    | "suspended_workspace"
    | "insufficient_permission";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type WorkspaceAuthorizationResult = StableResult<
  WorkspaceAuthorization,
  WorkspaceAuthorizationFailure
>;

export interface WorkspaceAuthorizer {
  authorize(
    request: WorkspaceAuthorizationRequest,
  ): Promise<WorkspaceAuthorizationResult>;
}

export type KnowledgeSearchRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  query: string;
  scopes: readonly string[];
  authority_statuses: readonly string[];
  applicability: JsonObject;
  limit: number;
  knowledge_snapshot: string;
}>;

export type KnowledgeSearchHit = Readonly<{
  knowledge_ref: string;
  title: string;
  excerpt: string;
  authority_status: string;
  provenance: readonly string[];
  evidence: readonly string[];
  relevance: number;
}>;

export type KnowledgeSearchValue = Readonly<{
  hits: readonly KnowledgeSearchHit[];
  knowledge_snapshot: string;
  projection_freshness: string;
  warnings: readonly string[];
}>;

export type KnowledgeSearchFailure = Readonly<{
  code:
    | "not_found"
    | "conflict"
    | "invalid"
    | "unauthorized"
    | "forbidden"
    | "integrity_failure"
    | "stale_projection"
    | "unavailable";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type KnowledgeSearchResult = StableResult<
  KnowledgeSearchValue,
  KnowledgeSearchFailure
>;

export interface KnowledgeSearch {
  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>;
}

export type RuleEvaluationRequest = Readonly<{
  evaluation_id: string;
  context: WorkspaceContext;
  rule_set: VersionReference;
  effective_at: string;
  facts: JsonObject;
  fact_provenance: readonly string[];
  requested_decisions: readonly string[];
  trace_level: "none" | "summary" | "full";
}>;

export type RuleEvaluationValue = Readonly<{
  outcome:
    | "satisfied"
    | "not_satisfied"
    | "indeterminate"
    | "not_applicable"
    | "error";
  rule_set: VersionReference;
  rule_versions: readonly VersionReference[];
  matched_conditions: readonly string[];
  relevant_facts: readonly string[];
  outputs: JsonObject;
  conflicts: readonly string[];
  missing_facts: readonly string[];
  explanation_trace: readonly string[];
  policy_version: string;
  duration_ms: number;
}>;

export type RuleEvaluationFailure = Readonly<{
  code:
    | "invalid_facts"
    | "unknown_rule_set"
    | "incompatible_version"
    | "authorization_denied"
    | "conflict"
    | "unsafe_expression"
    | "timeout"
    | "unavailable_repository";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type RuleEvaluationResult = StableResult<
  RuleEvaluationValue,
  RuleEvaluationFailure
>;

export interface DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult>;
}

export type ReasoningRequest = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  purpose: string;
  consequence_class: ConsequenceClass;
  capability_constraints: readonly string[];
  prompt: VersionReference;
  authorized_context_refs: readonly string[];
  output_schema: VersionReference;
  allowed_tools: readonly VersionReference[];
  limits: Readonly<{
    max_tokens: number;
    max_cost: number;
    timeout_ms: number;
    max_retries: number;
  }>;
  safety_policy: VersionReference;
}>;

export type ReasoningValue = Readonly<{
  structured_output: JsonObject;
  provider_id: string;
  provider_version: string;
  model_id: string;
  finish_status: "completed" | "length_limited" | "tool_requested";
  safety_outcomes: readonly string[];
  tool_calls: readonly JsonObject[];
  usage: Readonly<{
    input_tokens: number;
    output_tokens: number;
    cost: number;
  }>;
  latency_ms: number;
  citations: readonly string[];
  diagnostics: JsonObject;
}>;

export type ReasoningFailure = Readonly<{
  code:
    | "unsupported_capability"
    | "authorization_denied"
    | "schema_failure"
    | "safety_refusal"
    | "tool_denied"
    | "usage_limit"
    | "timeout"
    | "cancelled"
    | "provider_unavailable"
    | "provider_error";
  message: string;
  retryable: boolean;
  provider_id?: string;
  evidence: readonly string[];
}>;

export type ReasoningProviderResult = StableResult<
  ReasoningValue,
  ReasoningFailure
>;

export interface ReasoningProvider {
  generate(request: ReasoningRequest): Promise<ReasoningProviderResult>;
}
