/** Provider-neutral public contracts for the Reporting tracer bullet (SPEC-212). */
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

/** SPEC-212 §3. */
export type ReportType =
  | "executive_quality_and_risk"
  | "requirement_and_risk_coverage"
  | "test_strategy_and_design_readiness"
  | "execution_and_evidence"
  | "defect_and_escape_analysis"
  | "release_readiness"
  | "operational_quality"
  | "governance_and_quality_gate_status"
  | "knowledge_and_learning"
  | "workspace_audit";

export type ReportingPeriod = Readonly<{
  start: string;
  end: string;
}>;

/** SPEC-212 §5. */
export type ReportMetric = Readonly<{
  id: string;
  owner: string;
  definition: string;
  numerator: string;
  denominator: string;
  dimensions?: readonly string[];
  source_ref: string;
  update_cadence: string;
  interpretation?: string;
  known_limitations?: string;
}>;

/** Mirrors schemas/report.schema.json (SPEC-212 §4 Report Contract). */
export type Report = Readonly<{
  id: string;
  version: string;
  report_type: ReportType;
  audience: string;
  purpose: string;
  workspace_scope: string;
  reporting_period: ReportingPeriod;
  generated_at: string;
  source_artifact_refs: readonly string[];
  metrics: readonly ReportMetric[];
  filters_and_exclusions?: readonly string[];
  freshness?: string;
  completeness?: string;
  findings: readonly string[];
  critical_exceptions?: readonly string[];
  uncertainty_and_limitations?: readonly string[];
  drill_down_refs: readonly string[];
}>;

export type ReportFindingCategory = "completeness" | "traceability" | "aggregation_integrity" | "metric_governance";
export type ReportFindingSeverity = "critical" | "high" | "medium" | "low";

export type ReportFinding = Readonly<{
  id: string;
  category: ReportFindingCategory;
  severity: ReportFindingSeverity;
  message: string;
  evidence: readonly string[];
  next_action: string;
}>;

export type ReportAssessmentOutcome = "completed" | "indeterminate" | "blocked";

export type ReportQualityVerdict =
  | "pass"
  | "pass_with_recommendations"
  | "changes_required"
  | "blocked"
  | "rejected";

export type ReportAssessmentUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type ReportAssessmentResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
  prompt?: string;
}>;

/** Mirrors schemas/report-assessment.schema.json. */
export type ReportAssessment = Readonly<{
  id: string;
  report_ref: string;
  workspace_id: string;
  outcome: ReportAssessmentOutcome;
  verdict: ReportQualityVerdict;
  findings: readonly ReportFinding[];
  questions: readonly string[];
  rule_results: readonly string[];
  evidence: readonly string[];
  uncertainty: ReportAssessmentUncertainty;
  resolved_versions: ReportAssessmentResolvedVersions;
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
