/** Provider-neutral public contracts for the Test Automation tracer bullet (SPEC-209). */
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

export type AutomationAssetStatus = "draft" | "in_review" | "accepted" | "deprecated" | "retired";

export type AutomationAssetAssertionMapping = Readonly<{
  expected_result_ref: string;
  assertion_implementation: string;
}>;

/** Mirrors schemas/automation-asset.schema.json (SPEC-209 §3 Automation Asset). */
export type AutomationAsset = Readonly<{
  id: string;
  version: string;
  status: AutomationAssetStatus;
  implemented_test_case_refs: readonly string[];
  execution_interface: string;
  compatible_engine_refs: readonly string[];
  compatible_plugin_refs?: readonly string[];
  data_requirements?: readonly string[];
  environment_constraints: readonly string[];
  owner: string;
  evidence_mapping?: readonly string[];
  assertion_map?: readonly AutomationAssetAssertionMapping[];
  retry_policy?: string;
}>;

export type AutomationAssetFindingCategory = "completeness" | "traceability" | "assertion_integrity" | "isolation";
export type AutomationAssetFindingSeverity = "critical" | "high" | "medium" | "low";

export type AutomationAssetFinding = Readonly<{
  id: string;
  category: AutomationAssetFindingCategory;
  severity: AutomationAssetFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type AutomationAssetAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type AutomationAssetQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type AutomationAssetAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type AutomationAssetAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/automation-asset-assessment.schema.json. */
export type AutomationAssetAssessment = Readonly<{
  id: string;
  automation_asset_ref: string;
  workspace_id: string;
  outcome: AutomationAssetAssessmentOutcome;
  verdict: AutomationAssetQualityVerdict;
  findings: readonly AutomationAssetFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: AutomationAssetAssessmentUncertainty;
  resolved_versions: AutomationAssetAssessmentResolvedVersions;
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
