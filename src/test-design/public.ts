/** Provider-neutral public contracts for the Test Design tracer bullet (SPEC-207). */
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

export type TestCaseStatus = "draft" | "in_review" | "accepted" | "deprecated" | "archived";

export type TestCaseStep = Readonly<{
  action: string;
  input?: JsonObject;
}>;

export type TestCaseExpectedResult = Readonly<{
  assertion: string;
  authority: string;
}>;

export type TestCasePriority = "critical" | "high" | "medium" | "low";

/** Mirrors schemas/test-case.schema.json (SPEC-207 §2 Test Case Contract). */
export type TestCase = Readonly<{
  id: string;
  version: string;
  status: TestCaseStatus;
  purpose: string;
  traceability: readonly string[];
  preconditions: readonly string[];
  workspace_scope: string;
  data_requirements?: readonly string[];
  steps: readonly TestCaseStep[];
  expected_results: readonly TestCaseExpectedResult[];
  owner: string;
  actor_scope?: string;
  priority?: TestCasePriority;
  tags?: readonly string[];
  cleanup?: readonly string[];
}>;

export type TestCaseFindingCategory =
  | "completeness"
  | "traceability"
  | "authority"
  | "independence";

export type TestCaseFindingSeverity = "critical" | "high" | "medium" | "low";

export type TestCaseFinding = Readonly<{
  id: string;
  category: TestCaseFindingCategory;
  severity: TestCaseFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type TestCaseAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type TestCaseQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type TestCaseAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type TestCaseAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/test-case-assessment.schema.json. */
export type TestCaseAssessment = Readonly<{
  id: string;
  test_case_ref: string;
  workspace_id: string;
  outcome: TestCaseAssessmentOutcome;
  verdict: TestCaseQualityVerdict;
  findings: readonly TestCaseFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: TestCaseAssessmentUncertainty;
  resolved_versions: TestCaseAssessmentResolvedVersions;
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
