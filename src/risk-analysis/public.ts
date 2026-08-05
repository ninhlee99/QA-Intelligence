/** Provider-neutral public contracts for the Risk Analysis tracer bullet (SPEC-205). */
import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  ReasoningProvider,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../requirement-review/public.js";

export type RiskStatus = "draft" | "in_review" | "accepted" | "monitoring" | "closed" | "superseded";

/** SPEC-205 §3. */
export type RiskCategory =
  | "product_and_business"
  | "functional_quality"
  | "security_and_privacy"
  | "workspace_isolation"
  | "data_integrity"
  | "ai_and_model_behavior"
  | "compatibility_and_migration"
  | "performance_and_resilience"
  | "operability"
  | "compliance";

export type RiskStatement = Readonly<{
  cause: string;
  event: string;
  consequence: string;
}>;

export type RiskAffected = Readonly<{
  capability_id?: string;
  requirement_refs?: readonly string[];
  workspace_id: string;
  consumer_refs?: readonly string[];
}>;

export type RiskTreatment = "avoid" | "reduce" | "transfer" | "accept" | "monitor";

/** Mirrors schemas/risk.schema.json (SPEC-205 §2 Risk Model). */
export type Risk = Readonly<{
  id: string;
  version: string;
  status: RiskStatus;
  statement: RiskStatement;
  category: RiskCategory;
  affected: RiskAffected;
  likelihood_rationale: string;
  impact_rationale: string;
  detectability?: string;
  evidence: readonly string[];
  assumptions?: readonly string[];
  owner: string;
  controls: readonly string[];
  residual_risk: string;
  treatment?: RiskTreatment;
}>;

export type RiskFindingCategory =
  | "completeness"
  | "traceability"
  | "prioritization"
  | "treatment_governance";

export type RiskFindingSeverity = "critical" | "high" | "medium" | "low";

export type RiskFinding = Readonly<{
  id: string;
  category: RiskFindingCategory;
  severity: RiskFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

/** SPEC-205 §9/§10 outcome; a score SHALL NOT hide a critical-category risk (§5), mirroring SPEC-203 §7's rule. */
export type RiskAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type RiskQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type RiskAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type RiskAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/risk-assessment.schema.json. */
export type RiskAssessment = Readonly<{
  id: string;
  risk_ref: string;
  workspace_id: string;
  outcome: RiskAssessmentOutcome;
  verdict: RiskQualityVerdict;
  findings: readonly RiskFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: RiskAssessmentUncertainty;
  resolved_versions: RiskAssessmentResolvedVersions;
}>;

export type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  ReasoningProvider,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
};
