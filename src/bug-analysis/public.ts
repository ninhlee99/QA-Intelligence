/** Provider-neutral public contracts for the Bug Analysis tracer bullet (SPEC-211). */
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

export type DefectStatus =
  | "draft"
  | "triaged"
  | "confirmed"
  | "in_progress"
  | "fixed"
  | "verified"
  | "closed"
  | "wont_fix"
  | "duplicate";

export type DefectSeverity = "critical" | "high" | "medium" | "low";
export type DefectPriority = "p0" | "p1" | "p2" | "p3";

/** SPEC-211 §4. */
export type DefectClassification =
  | "product_defect"
  | "requirement_or_rule_defect"
  | "test_design_defect"
  | "automation_defect"
  | "test_data_defect"
  | "environment_or_infrastructure_defect"
  | "configuration_defect"
  | "security_incident"
  | "expected_behavior_or_duplicate"
  | "unresolved_indeterminate";

/** Mirrors schemas/defect.schema.json (SPEC-211 §2 Defect Contract). */
export type Defect = Readonly<{
  id: string;
  version: string;
  status: DefectStatus;
  summary: string;
  observed_behavior: string;
  expected_behavior: string;
  expected_behavior_authority: string;
  affected_capability_id?: string;
  affected_requirement_refs?: readonly string[];
  workspace_scope: string;
  environment_ref: string;
  artifact_version_refs?: readonly string[];
  reproduction_conditions: readonly string[];
  evidence: readonly string[];
  severity: DefectSeverity;
  severity_rationale: string;
  priority: DefectPriority;
  classification: DefectClassification;
  suspected_cause?: string;
  confirmed_cause?: string;
  owner: string;
  related_execution_refs?: readonly string[];
  related_risk_refs?: readonly string[];
  related_test_refs?: readonly string[];
  fix_evidence?: readonly string[];
  regression_validation_ref?: string;
  release_ref?: string;
}>;

export type DefectFindingCategory = "completeness" | "traceability" | "cause_integrity" | "closure_governance";
export type DefectFindingSeverity = "critical" | "high" | "medium" | "low";

export type DefectFinding = Readonly<{
  id: string;
  category: DefectFindingCategory;
  severity: DefectFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type DefectAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type DefectQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type DefectAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type DefectAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/defect-assessment.schema.json. */
export type DefectAssessment = Readonly<{
  id: string;
  defect_ref: string;
  workspace_id: string;
  outcome: DefectAssessmentOutcome;
  verdict: DefectQualityVerdict;
  findings: readonly DefectFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: DefectAssessmentUncertainty;
  resolved_versions: DefectAssessmentResolvedVersions;
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
