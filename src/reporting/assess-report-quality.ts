import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  Report,
  ReportAssessment,
  ReportAssessmentResolvedVersions,
  ReportFinding,
  ReportFindingCategory,
  ReportFindingSeverity,
  ReportQualityVerdict,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "./public.js";
import {
  hasExactResolvedVersions,
  isJsonObject,
  parseVersionReference,
  readEnum,
  readObject,
  readString,
  readStrings,
  unique,
} from "../shared/rule-engine-support.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(scope: "assessment" | "finding"): string;
}

export type ReportReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  report: Report;
}>;

export type ReportReviewConfiguration = Readonly<{
  resolved_versions: ReportAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type ReportReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ReportReviewResult = StableResult<ReportAssessment, ReportReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: ReportReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Report Quality Skill (SPEC-212
 * tracer bullet, same authorize → discover → rule → evidence pipeline as
 * the other Test capability Skills). Scoped to Report Contract
 * completeness (§4) and the aggregation-cannot-hide-critical rule (§6
 * "critical failures... SHALL remain visible regardless of overall
 * score"). This slice does NOT verify: whether a metric's numerator/
 * denominator are computed correctly (§5, needs the real underlying data,
 * not just the metric's declaration), historical reproducibility (§10,
 * needs to actually regenerate a past report), or narrative-summary
 * fabrication (§7, needs a real reasoning provider's output to check
 * against, out of scope here since this Skill has none).
 */
export class AssessReportQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: ReportReviewRequest): Promise<ReportReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Report review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const reportRef = `${request.report.id}@${request.report.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess report quality",
      consequence_class: "advisory",
      required_permissions: ["report:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, reportRef],
    });
    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          outcome: "blocked",
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }
    if (request.workspace_id !== request.context.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: "workspace_scope_mismatch",
          outcome: "blocked",
          message: "The requested Workspace does not match the trusted Workspace context.",
          retryable: false,
          evidence: unique([
            ...authorization.value.decision_evidence,
            `context-workspace:${request.context.workspace_id}`,
            `requested-workspace:${request.workspace_id}`,
          ]),
        },
      };
    }
    if (request.report.workspace_scope !== request.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: "workspace_scope_mismatch",
          outcome: "blocked",
          message: "The report's own Workspace scope does not match the requested Workspace.",
          retryable: false,
          evidence: [`report-workspace:${request.report.workspace_scope}`, `requested-workspace:${request.workspace_id}`],
        },
      };
    }

    const discovery = await this.#dependencies.knowledge.search({
      operation_id: request.operation_id,
      context: request.context,
      query: request.report.purpose,
      scopes: ["policies"],
      authority_statuses: ["accepted"],
      applicability: { workspace_id: request.workspace_id },
      limit: this.#dependencies.configuration.limits.knowledge_hits,
      knowledge_snapshot: this.#dependencies.configuration.resolved_versions.knowledge_snapshot,
    });
    if (!discovery.ok) {
      const blocked = discovery.failure.code === "unauthorized" || discovery.failure.code === "forbidden";
      return {
        ok: false,
        failure: {
          class: "knowledge",
          code: discovery.failure.code,
          outcome: blocked ? "blocked" : "indeterminate",
          message: discovery.failure.message,
          retryable: discovery.failure.retryable,
          evidence: [...discovery.failure.evidence],
        },
      };
    }

    const effectiveAt = this.#dependencies.clock.now().toISOString();
    const ruleSet = parseVersionReference(this.#dependencies.configuration.resolved_versions.rule_set);
    const ruleEvaluation = await this.#dependencies.rules.evaluate({
      evaluation_id: `${request.operation_id}:report-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.report),
      fact_provenance: unique([
        reportRef,
        ...request.report.source_artifact_refs,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["report_quality"],
      trace_level: "full",
    });
    if (!ruleEvaluation.ok) {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: ruleEvaluation.failure.code,
          outcome: ruleEvaluation.failure.code === "authorization_denied" ? "blocked" : "indeterminate",
          message: ruleEvaluation.failure.message,
          retryable: ruleEvaluation.failure.retryable,
          evidence: [...ruleEvaluation.failure.evidence],
        },
      };
    }
    if (
      ruleEvaluation.value.rule_set.id !== ruleSet.id ||
      ruleEvaluation.value.rule_set.version !== ruleSet.version ||
      ruleEvaluation.value.policy_version !== request.context.policy_version
    ) {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: "incompatible_version",
          outcome: "indeterminate",
          message: "Rule evaluation returned an unrequested Rule Set or policy version.",
          retryable: false,
          evidence: [
            `requested-rule-set:${ruleSet.id}@${ruleSet.version}`,
            `returned-rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}`,
          ],
        },
      };
    }
    if (ruleEvaluation.value.outcome === "error" || ruleEvaluation.value.outcome === "not_applicable") {
      return {
        ok: false,
        failure: {
          class: "rule",
          code: `rule_outcome_${ruleEvaluation.value.outcome}`,
          outcome: "indeterminate",
          message: "Deterministic report-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [reportRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      reportRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      reportRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        report_ref: reportRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping used across the
        // other Test capability Skills: only "aggregation_integrity" (a
        // declared critical exception not reflected in the report's own
        // findings — SPEC-212 §6 "critical failures... SHALL remain
        // visible regardless of overall score") maps to "rejected" — a
        // report that could mislead its audience by omission. Any other
        // critical finding still blocks, but as "blocked".
        verdict: criticalVerdict(findings) ?? (findings.length === 0 ? "pass" : "changes_required"),
        findings,
        questions: [],
        rule_results: ruleResults,
        evidence,
        uncertainty: { level: "none", reasons: [] },
        resolved_versions: {
          ...this.#dependencies.configuration.resolved_versions,
          knowledge_snapshot: discovery.value.knowledge_snapshot,
        },
      },
    };
  }
}

const REJECTION_FINDING_CATEGORIES: ReadonlySet<ReportFindingCategory> = new Set(["aggregation_integrity"]);

function criticalVerdict(findings: readonly ReportFinding[]): ReportQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Report Contract completeness tracer bullet (SPEC-212 §4/§5/§6). */
export class ReportQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const report = readObject(request.facts, "report");
    if (report === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The report fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const reportRef = readString(report, "ref") ?? "report:unknown";
    const findings: JsonObject[] = [];

    for (const [field, label] of [
      ["audience", "audience"],
      ["purpose", "purpose"],
      ["generated_at", "generated time"],
    ] as const) {
      if (readString(report, field) === undefined) {
        findings.push({
          category: "completeness" satisfies ReportFindingCategory,
          severity: "high",
          message: `The report has no ${label}.`,
          evidence: [`${reportRef}#${field}`, `rule:report-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this report, per SPEC-212 §4.`,
        });
      }
    }

    const sourceArtifacts = report["source_artifact_refs"];
    if (!Array.isArray(sourceArtifacts) || sourceArtifacts.length === 0) {
      findings.push({
        category: "traceability" satisfies ReportFindingCategory,
        severity: "high",
        message: "The report cites no source artifact.",
        evidence: [`${reportRef}#source_artifact_refs`, "rule:report-has-source-artifacts@1.0.0"],
        next_action: "Cite at least one exact-version source artifact this report draws from, per SPEC-212 §4.",
      });
    }

    const drillDownRefs = report["drill_down_refs"];
    if (!Array.isArray(drillDownRefs) || drillDownRefs.length === 0) {
      findings.push({
        category: "traceability" satisfies ReportFindingCategory,
        severity: "high",
        message: "The report has no drill-down evidence links.",
        evidence: [`${reportRef}#drill_down_refs`, "rule:report-has-drill-down-refs@1.0.0"],
        next_action: "Link each material claim to its authoritative drill-down evidence, per SPEC-212 §4.",
      });
    }

    const metrics = report["metrics"];
    if (Array.isArray(metrics)) {
      const incompleteMetrics = metrics.filter((metric) => {
        if (!isJsonObject(metric)) return true;
        return (
          readString(metric, "owner") === undefined ||
          readString(metric, "definition") === undefined ||
          readString(metric, "numerator") === undefined ||
          readString(metric, "denominator") === undefined ||
          readString(metric, "source_ref") === undefined ||
          readString(metric, "update_cadence") === undefined
        );
      });
      if (incompleteMetrics.length > 0) {
        findings.push({
          category: "metric_governance" satisfies ReportFindingCategory,
          severity: "high",
          message: `${incompleteMetrics.length} metric(s) are missing an owner, definition, numerator, denominator, source, or update cadence.`,
          evidence: [`${reportRef}#metrics`, "rule:report-metrics-are-complete@1.0.0"],
          next_action: "Complete each metric's definition per SPEC-212 §5 before publishing this report.",
        });
      }
    }

    // SPEC-212 §6: "Critical failures, expired exceptions, cross-Workspace
    // incidents, and blocked mandatory gates SHALL remain visible
    // regardless of overall score." A declared critical exception that
    // isn't reflected anywhere in the report's own findings is exactly the
    // hidden-by-aggregation shape this rule exists to catch.
    const criticalExceptions = readStrings(report, "critical_exceptions");
    const findingsList = readStrings(report, "findings");
    if (criticalExceptions.length > 0) {
      const unreflected = criticalExceptions.filter(
        (exception) => !findingsList.some((finding) => finding.includes(exception)),
      );
      if (unreflected.length > 0) {
        findings.push({
          category: "aggregation_integrity" satisfies ReportFindingCategory,
          severity: "critical",
          message: `The report declares ${unreflected.length} critical exception(s) not reflected in its own findings.`,
          evidence: [`${reportRef}#critical_exceptions`, "rule:report-critical-exceptions-are-visible@1.0.0"],
          next_action: "Surface every declared critical exception in the report's findings so it cannot be hidden by an aggregate score, per SPEC-212 §6.",
        });
      }
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic report-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic report-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "report-completeness", version: "1.0.0" },
        { id: "report-has-source-artifacts", version: "1.0.0" },
        { id: "report-has-drill-down-refs", version: "1.0.0" },
        { id: "report-metrics-are-complete", version: "1.0.0" },
        { id: "report-critical-exceptions-are-visible", version: "1.0.0" },
      ],
      matched_conditions: findings.map((finding) => readString(finding, "category") ?? "quality-gap"),
      relevant_facts: request.fact_provenance,
      outputs: { findings },
      conflicts: [],
      missing_facts: [],
      explanation_trace: [...explanation],
      policy_version: request.context.policy_version,
      duration_ms: 0,
    },
  };
}

function assessmentFacts(report: Report): JsonObject {
  return {
    report: {
      ref: `${report.id}@${report.version}`,
      id: report.id,
      version: report.version,
      report_type: report.report_type,
      audience: report.audience,
      purpose: report.purpose,
      workspace_scope: report.workspace_scope,
      reporting_period: { ...report.reporting_period },
      generated_at: report.generated_at,
      source_artifact_refs: [...report.source_artifact_refs],
      metrics: report.metrics.map((metric) => ({ ...metric })),
      filters_and_exclusions: [...(report.filters_and_exclusions ?? [])],
      freshness: report.freshness ?? null,
      completeness: report.completeness ?? null,
      findings: [...report.findings],
      critical_exceptions: [...(report.critical_exceptions ?? [])],
      uncertainty_and_limitations: [...(report.uncertainty_and_limitations ?? [])],
      drill_down_refs: [...report.drill_down_refs],
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): ReportFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "aggregation_integrity", "metric_governance"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: ReportFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as ReportFindingCategory,
      severity: severity as ReportFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced report-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

