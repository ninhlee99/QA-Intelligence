/** Provider-neutral public contracts for the Business Analysis tracer bullet (SPEC-204). */
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

export type WorkflowState = "current" | "target";

export type WorkflowActor = Readonly<{
  actor: string;
  permissions: readonly string[];
}>;

export type WorkflowActivity = Readonly<{
  step: string;
  description: string;
}>;

export type WorkflowDecision = Readonly<{
  description: string;
  rule_ref?: string;
  open_question?: string;
}>;

export type WorkflowTransition = Readonly<{
  from_state: string;
  to_state: string;
  trigger: string;
}>;

/** SPEC-204 §7: only present when `state` is `"target"` — a desired behavior SHALL NOT be documented as current fact. */
export type WorkflowGap = Readonly<{
  required_change: string;
  affected_owner: string;
  assumptions: readonly string[];
  validation: string;
}>;

/** Mirrors schemas/workflow.schema.json (SPEC-204 §6 Workflow Analysis). */
export type Workflow = Readonly<{
  id: string;
  version: string;
  name: string;
  state: WorkflowState;
  trigger: string;
  preconditions: readonly string[];
  actors: readonly WorkflowActor[];
  activities: readonly WorkflowActivity[];
  decisions: readonly WorkflowDecision[];
  data_consumed: readonly string[];
  data_produced: readonly string[];
  transitions: readonly WorkflowTransition[];
  alternate_paths: readonly string[];
  failure_paths: readonly string[];
  outcome: string;
  evidence: readonly string[];
  gap?: WorkflowGap;
  traces_to: readonly string[];
}>;

export type BusinessAnalysisFindingCategory =
  | "scope_and_actors"
  | "path_coverage"
  | "decision_traceability"
  | "state_distinction"
  | "assumption_visibility"
  | "traceability";

export type BusinessAnalysisFindingSeverity = "critical" | "high" | "medium" | "low";

export type BusinessAnalysisFinding = Readonly<{
  id: string;
  category: BusinessAnalysisFindingCategory;
  severity: BusinessAnalysisFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

/** SPEC-204 §10/§11 outcome; a verdict SHALL NOT hide a critical finding, mirroring SPEC-203/SPEC-205's rule. */
export type BusinessAnalysisAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type BusinessAnalysisQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type BusinessAnalysisAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type BusinessAnalysisAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/business-analysis-assessment.schema.json. */
export type BusinessAnalysisAssessment = Readonly<{
  id: string;
  workflow_ref: string;
  workspace_id: string;
  outcome: BusinessAnalysisAssessmentOutcome;
  verdict: BusinessAnalysisQualityVerdict;
  findings: readonly BusinessAnalysisFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: BusinessAnalysisAssessmentUncertainty;
  resolved_versions: BusinessAnalysisAssessmentResolvedVersions;
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
