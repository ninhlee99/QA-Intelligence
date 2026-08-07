/** Provider-neutral public contracts for the Test Execution tracer bullet (SPEC-210). */
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

/** SPEC-210 §3. */
export type ExecutionLifecycleState =
  | "planned"
  | "queued"
  | "preparing"
  | "running"
  | "collecting_evidence"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

/** SPEC-210 §4, the single source of truth for this vocabulary (SPEC-209 §7 and SPEC-107 reference it). */
export type ExecutionOutcome =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled"
  | "flaky"
  | "infrastructure_error"
  | "indeterminate";

export type ExecutionTiming = Readonly<{
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
  duration_seconds?: number;
}>;

/** Mirrors schemas/execution-record.schema.json (SPEC-210 §2 Execution Contract). */
export type ExecutionRecord = Readonly<{
  id: string;
  workspace_id: string;
  actor_id: string;
  test_case_ref: string;
  automation_asset_ref: string;
  engine_ref: string;
  plugin_refs?: readonly string[];
  environment_ref: string;
  dataset_refs?: readonly string[];
  schedule_or_trigger?: string;
  state: ExecutionLifecycleState;
  outcome: ExecutionOutcome | null;
  skip_reason?: string;
  evidence?: readonly string[];
  timing?: ExecutionTiming;
  resource_usage?: JsonObject;
  cancellation_ref?: string;
  retry_of_ref?: string;
  parent_execution_ref?: string;
}>;

export type ExecutionRecordFindingCategory = "completeness" | "traceability" | "outcome_integrity" | "isolation";
export type ExecutionRecordFindingSeverity = "critical" | "high" | "medium" | "low";

export type ExecutionRecordFinding = Readonly<{
  id: string;
  category: ExecutionRecordFindingCategory;
  severity: ExecutionRecordFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type ExecutionRecordAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type ExecutionRecordQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type ExecutionRecordAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type ExecutionRecordAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/execution-record-assessment.schema.json. */
export type ExecutionRecordAssessment = Readonly<{
  id: string;
  execution_record_ref: string;
  workspace_id: string;
  outcome: ExecutionRecordAssessmentOutcome;
  verdict: ExecutionRecordQualityVerdict;
  findings: readonly ExecutionRecordFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: ExecutionRecordAssessmentUncertainty;
  resolved_versions: ExecutionRecordAssessmentResolvedVersions;
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
