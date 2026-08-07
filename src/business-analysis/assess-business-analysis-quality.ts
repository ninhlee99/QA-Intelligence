import type {
  BusinessAnalysisAssessment,
  BusinessAnalysisAssessmentResolvedVersions,
  BusinessAnalysisAssessmentUncertainty,
  BusinessAnalysisFinding,
  BusinessAnalysisFindingCategory,
  BusinessAnalysisFindingSeverity,
  BusinessAnalysisQualityVerdict,
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
  Workflow,
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

export type BusinessAnalysisReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  workflow: Workflow;
}>;

export type BusinessAnalysisReviewConfiguration = Readonly<{
  resolved_versions: BusinessAnalysisAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type BusinessAnalysisReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type BusinessAnalysisReviewResult = StableResult<BusinessAnalysisAssessment, BusinessAnalysisReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: BusinessAnalysisReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Business Analysis Quality Skill
 * (SPEC-204 tracer bullet, mirroring the AssessRiskQuality/SPEC-205
 * pattern). Scoped to a single Workflow's completeness (§6) and the
 * current-vs-target-state distinction (§7) — this slice does NOT model
 * Actor/Capability/Decision-Catalog/Exception-Catalog as independent
 * entities (§3's other 10 concepts), does not build the Business Context
 * Model / Capability Map / Traceability Map outputs (§5, which need a
 * corpus of workflows, not a single one per call), and does not perform
 * AI-assisted business-rule discovery (§8, needs a real reasoning
 * provider).
 */
export class AssessBusinessAnalysisQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: BusinessAnalysisReviewRequest): Promise<BusinessAnalysisReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Business Analysis review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const workflowRef = `${request.workflow.id}@${request.workflow.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess business analysis quality",
      consequence_class: "advisory",
      required_permissions: ["workflow:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, workflowRef],
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

    const discovery = await this.#dependencies.knowledge.search({
      operation_id: request.operation_id,
      context: request.context,
      query: `${request.workflow.name}\n${request.workflow.trigger}\n${request.workflow.outcome}`,
      scopes: ["workflows", "requirements", "policies"],
      authority_statuses: ["accepted"],
      applicability: { workspace_id: request.workspace_id, capability_id: null },
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
      evaluation_id: `${request.operation_id}:business-analysis-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.workflow),
      fact_provenance: unique([
        workflowRef,
        ...request.workflow.evidence,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["business_analysis_quality"],
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
          message: "Deterministic business-analysis-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [workflowRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      workflowRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      workflowRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        workflow_ref: workflowRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // SPEC-204 §7: a desired behavior SHALL NOT be documented as
        // current fact — same choke point as SPEC-203/SPEC-205's "a verdict
        // SHALL NOT hide a critical finding", applied here to the
        // current/target state distinction.
        verdict: criticalVerdict(findings) ?? (findings.length === 0 ? "pass" : "changes_required"),
        findings,
        questions: [],
        rule_results: ruleResults,
        evidence,
        uncertainty: emptyUncertainty(),
        resolved_versions: {
          ...this.#dependencies.configuration.resolved_versions,
          knowledge_snapshot: discovery.value.knowledge_snapshot,
        },
      },
    };
  }
}

function emptyUncertainty(): BusinessAnalysisAssessmentUncertainty {
  return { level: "none", reasons: [] };
}

/**
 * SPEC-204 §7 makes documenting a desired behavior as current fact a hard
 * governance violation, not a mere completeness gap — mirroring SPEC-205
 * §5's rejection-category pattern, critical findings in `state_distinction`
 * map to "rejected"; any other critical finding still blocks, but as
 * "blocked", not a false safety rejection.
 */
const REJECTION_FINDING_CATEGORIES: ReadonlySet<BusinessAnalysisFindingCategory> = new Set([
  "state_distinction",
]);

function criticalVerdict(findings: readonly BusinessAnalysisFinding[]): BusinessAnalysisQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Workflow completeness tracer bullet (SPEC-204 §6/§7/§10). */
export class BusinessAnalysisQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const workflow = readObject(request.facts, "workflow");
    if (workflow === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The workflow fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const workflowRef = readString(workflow, "ref") ?? "workflow:unknown";
    const findings: JsonObject[] = [];

    if (readString(workflow, "trigger") === undefined) {
      findings.push({
        category: "scope_and_actors" satisfies BusinessAnalysisFindingCategory,
        severity: "high",
        message: "The workflow has no trigger.",
        evidence: [`${workflowRef}#trigger`, "rule:workflow-has-trigger@1.0.0"],
        next_action: "State what event or condition starts this workflow, per SPEC-204 §6.",
      });
    }

    const actors = workflow["actors"];
    if (!Array.isArray(actors) || actors.length === 0) {
      findings.push({
        category: "scope_and_actors" satisfies BusinessAnalysisFindingCategory,
        severity: "high",
        message: "The workflow has no actors or permissions recorded.",
        evidence: [`${workflowRef}#actors`, "rule:workflow-has-actors@1.0.0"],
        next_action: "Record the actors and their permissions for this workflow, per SPEC-204 §6.",
      });
    }

    const activities = workflow["activities"];
    if (!Array.isArray(activities) || activities.length === 0) {
      findings.push({
        category: "scope_and_actors" satisfies BusinessAnalysisFindingCategory,
        severity: "high",
        message: "The workflow has no ordered activities.",
        evidence: [`${workflowRef}#activities`, "rule:workflow-has-activities@1.0.0"],
        next_action: "Record the ordered activities that make up this workflow, per SPEC-204 §6.",
      });
    }

    const alternatePaths = workflow["alternate_paths"];
    const failurePaths = workflow["failure_paths"];
    const missingPaths = [
      !Array.isArray(alternatePaths) || alternatePaths.length === 0 ? "alternate" : undefined,
      !Array.isArray(failurePaths) || failurePaths.length === 0 ? "failure" : undefined,
    ].filter((part): part is string => part !== undefined);
    if (missingPaths.length > 0) {
      findings.push({
        category: "path_coverage" satisfies BusinessAnalysisFindingCategory,
        severity: "high",
        message: `The workflow is missing ${missingPaths.join(" and ")} path coverage.`,
        evidence: [`${workflowRef}#failure_paths`, "rule:workflow-has-alternate-and-failure-paths@1.0.0"],
        next_action: "Document the alternate and failure paths for this workflow, per SPEC-204 §6.",
      });
    }

    const decisions = workflow["decisions"];
    if (Array.isArray(decisions)) {
      const untraceable = decisions.filter(
        (decision) =>
          !isJsonObject(decision) ||
          (readString(decision, "rule_ref") === undefined && readString(decision, "open_question") === undefined),
      );
      if (untraceable.length > 0) {
        findings.push({
          category: "decision_traceability" satisfies BusinessAnalysisFindingCategory,
          severity: "high",
          message: "A decision in this workflow traces to neither a rule nor an unresolved question.",
          evidence: [`${workflowRef}#decisions`, "rule:workflow-decisions-trace-to-rule-or-question@1.0.0"],
          next_action: "Link each decision to a governed rule or record it as an unresolved question, per SPEC-204 §8/§9.",
        });
      }
    }

    // SPEC-204 §7: a desired behavior SHALL NOT be documented as current
    // fact — a target-state workflow with no gap statement hides exactly
    // that distinction, so this is the one critical/rejection-tier check.
    const state = readString(workflow, "state");
    if (state === "target" && readObject(workflow, "gap") === undefined) {
      findings.push({
        category: "state_distinction" satisfies BusinessAnalysisFindingCategory,
        severity: "critical",
        message: "A target-state workflow has no gap statement distinguishing it from current-state fact.",
        evidence: [`${workflowRef}#gap`, "rule:workflow-target-state-has-gap@1.0.0"],
        next_action: "Record the required change, affected owner, assumptions, and validation for this target-state workflow, per SPEC-204 §7.",
      });
    }

    const evidence = workflow["evidence"];
    const assumptions = state === "target" ? readObject(workflow, "gap")?.["assumptions"] : undefined;
    if ((!Array.isArray(evidence) || evidence.length === 0) && state !== "target") {
      findings.push({
        category: "assumption_visibility" satisfies BusinessAnalysisFindingCategory,
        severity: "medium",
        message: "The workflow records no evidence for its current-state observations.",
        evidence: [`${workflowRef}#evidence`, "rule:workflow-has-evidence@1.0.0"],
        next_action: "Record the evidence backing this current-state workflow, per SPEC-204 §7/§9.",
      });
    } else if (state === "target" && (!Array.isArray(assumptions) || assumptions.length === 0)) {
      findings.push({
        category: "assumption_visibility" satisfies BusinessAnalysisFindingCategory,
        severity: "medium",
        message: "The workflow's gap statement records no assumptions.",
        evidence: [`${workflowRef}#gap`, "rule:workflow-gap-has-assumptions@1.0.0"],
        next_action: "Record the assumptions behind this target-state gap, per SPEC-204 §7.",
      });
    }

    const tracesTo = workflow["traces_to"];
    if (!Array.isArray(tracesTo) || tracesTo.length === 0) {
      findings.push({
        category: "traceability" satisfies BusinessAnalysisFindingCategory,
        severity: "medium",
        message: "The workflow does not trace to a requirement or goal.",
        evidence: [`${workflowRef}#traces_to`, "rule:workflow-traces-to-requirement-or-goal@1.0.0"],
        next_action: "Link this workflow to at least one requirement or goal, per SPEC-204 §2/§10.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic business-analysis-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic business-analysis-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "workflow-has-trigger", version: "1.0.0" },
        { id: "workflow-has-actors", version: "1.0.0" },
        { id: "workflow-has-activities", version: "1.0.0" },
        { id: "workflow-has-alternate-and-failure-paths", version: "1.0.0" },
        { id: "workflow-decisions-trace-to-rule-or-question", version: "1.0.0" },
        { id: "workflow-target-state-has-gap", version: "1.0.0" },
        { id: "workflow-has-evidence", version: "1.0.0" },
        { id: "workflow-gap-has-assumptions", version: "1.0.0" },
        { id: "workflow-traces-to-requirement-or-goal", version: "1.0.0" },
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

function assessmentFacts(workflow: Workflow): JsonObject {
  return {
    workflow: {
      ref: `${workflow.id}@${workflow.version}`,
      id: workflow.id,
      version: workflow.version,
      name: workflow.name,
      state: workflow.state,
      trigger: workflow.trigger,
      preconditions: [...workflow.preconditions],
      actors: workflow.actors.map((actor) => ({ ...actor, permissions: [...actor.permissions] })),
      activities: workflow.activities.map((activity) => ({ ...activity })),
      decisions: workflow.decisions.map((decision) => ({ ...decision })),
      data_consumed: [...workflow.data_consumed],
      data_produced: [...workflow.data_produced],
      transitions: workflow.transitions.map((transition) => ({ ...transition })),
      alternate_paths: [...workflow.alternate_paths],
      failure_paths: [...workflow.failure_paths],
      outcome: workflow.outcome,
      evidence: [...workflow.evidence],
      gap: workflow.gap === undefined ? null : { ...workflow.gap, assumptions: [...workflow.gap.assumptions] },
      traces_to: [...workflow.traces_to],
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): BusinessAnalysisFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = [
    "scope_and_actors",
    "path_coverage",
    "decision_traceability",
    "state_distinction",
    "assumption_visibility",
    "traceability",
  ] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: BusinessAnalysisFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as BusinessAnalysisFindingCategory,
      severity: severity as BusinessAnalysisFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced business-analysis-quality gap and re-run the assessment.",
    });
  }
  return findings;
}
