/** Provider-neutral public contracts for the Test Strategy tracer bullet (SPEC-206). */
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

export type TestStrategyStatus = "draft" | "in_review" | "accepted" | "deprecated" | "superseded";

/** SPEC-206 §4. */
export type TestLevel =
  | "unit"
  | "component"
  | "contract"
  | "integration"
  | "system"
  | "end_to_end"
  | "acceptance"
  | "production_verification";

export type TestStrategyEnvironment = Readonly<{
  name: string;
  representativeness: string;
  controlled_differences?: readonly string[];
  reset_and_recovery?: string;
}>;

/** Mirrors schemas/test-strategy.schema.json (SPEC-206 §3 Strategy Contract). */
export type TestStrategy = Readonly<{
  id: string;
  version: string;
  status: TestStrategyStatus;
  scope: string;
  objectives: readonly string[];
  governing_requirement_refs?: readonly string[];
  governing_risk_refs?: readonly string[];
  quality_characteristics: readonly string[];
  test_levels: readonly TestLevel[];
  techniques: readonly string[];
  coverage_model?: string;
  environments: readonly TestStrategyEnvironment[];
  test_data_approach: string;
  automation_approach: string;
  entry_criteria: readonly string[];
  exit_criteria: readonly string[];
  evidence_and_reporting: string;
  roles_and_escalation?: string;
  exclusions?: readonly string[];
  assumptions?: readonly string[];
  residual_risk?: string;
  owner: string;
}>;

export type TestStrategyFindingCategory = "completeness" | "traceability" | "risk_coverage" | "governance";
export type TestStrategyFindingSeverity = "critical" | "high" | "medium" | "low";

export type TestStrategyFinding = Readonly<{
  id: string;
  category: TestStrategyFindingCategory;
  severity: TestStrategyFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type TestStrategyAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type TestStrategyQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type TestStrategyAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type TestStrategyAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/test-strategy-assessment.schema.json. */
export type TestStrategyAssessment = Readonly<{
  id: string;
  test_strategy_ref: string;
  workspace_id: string;
  outcome: TestStrategyAssessmentOutcome;
  verdict: TestStrategyQualityVerdict;
  findings: readonly TestStrategyFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: TestStrategyAssessmentUncertainty;
  resolved_versions: TestStrategyAssessmentResolvedVersions;
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
