/** Provider-neutral public contracts for the Test Data tracer bullet (SPEC-208). */
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

export type TestDatasetStatus = "draft" | "in_review" | "accepted" | "deprecated" | "retired";

/** SPEC-208 §3. */
export type TestDataClassification =
  | "synthetic"
  | "generated_from_template"
  | "masked_production_derived"
  | "reference"
  | "seeded_environment"
  | "ephemeral_execution"
  | "adversarial_and_boundary"
  | "ai_evaluation_dataset";

export type TestDatasetAiEvaluationMetadata = Readonly<{
  labels?: readonly string[];
  representativeness?: string;
  known_bias?: string;
  contamination_risk?: string;
  protected_data_authorization_ref?: string;
}>;

/** Mirrors schemas/test-dataset.schema.json (SPEC-208 §4 Data Contract). */
export type TestDataset = Readonly<{
  id: string;
  version: string;
  status: TestDatasetStatus;
  owner: string;
  purpose: string;
  traced_test_refs: readonly string[];
  schema_ref: string;
  source: string;
  generation_method: string;
  classification: TestDataClassification;
  workspace_scope: string;
  environment_scope: string;
  validity_constraints?: readonly string[];
  setup: string;
  teardown: string;
  retention: string;
  disposal: string;
  contains_sensitive_fields?: boolean;
  sensitive_field_controls?: readonly string[];
  ai_evaluation_metadata?: TestDatasetAiEvaluationMetadata;
  /**
   * Synthetic fill map (accessible_name → value) for execute/regression.
   * Registry MAY store only when classification is synthetic and values
   * pass credential-shape checks — never passwords/tokens.
   */
  field_samples?: Readonly<Record<string, string>>;
}>;

export type TestDatasetFindingCategory = "completeness" | "traceability" | "privacy_and_isolation" | "lifecycle";
export type TestDatasetFindingSeverity = "critical" | "high" | "medium" | "low";

export type TestDatasetFinding = Readonly<{
  id: string;
  category: TestDatasetFindingCategory;
  severity: TestDatasetFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type TestDatasetAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type TestDatasetQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type TestDatasetAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type TestDatasetAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/test-dataset-assessment.schema.json. */
export type TestDatasetAssessment = Readonly<{
  id: string;
  test_dataset_ref: string;
  workspace_id: string;
  outcome: TestDatasetAssessmentOutcome;
  verdict: TestDatasetQualityVerdict;
  findings: readonly TestDatasetFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: TestDatasetAssessmentUncertainty;
  resolved_versions: TestDatasetAssessmentResolvedVersions;
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
