import type {
  DeterministicRuleEngine,
  ExecutionRecord,
  ExecutionRecordAssessment,
  ExecutionRecordAssessmentResolvedVersions,
  ExecutionRecordFinding,
  ExecutionRecordFindingCategory,
  ExecutionRecordFindingSeverity,
  ExecutionRecordQualityVerdict,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
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

export type ExecutionRecordReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  execution_record: ExecutionRecord;
}>;

export type ExecutionRecordReviewConfiguration = Readonly<{
  resolved_versions: ExecutionRecordAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type ExecutionRecordReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ExecutionRecordReviewResult = StableResult<ExecutionRecordAssessment, ExecutionRecordReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: ExecutionRecordReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Execution Record Quality Skill
 * (SPEC-210 tracer bullet, same authorize → discover → rule → evidence
 * pipeline as the other Test capability Skills). Scoped to Execution
 * Contract completeness (§2) and outcome-vocabulary integrity (§4/§10 "an
 * honest outcome" — state/outcome consistency and evidence presence for a
 * terminal record). This slice does NOT verify: whether a recorded
 * `passed` outcome is actually correct (needs the real evidence content,
 * not just its presence), scheduling/concurrency behavior (§5, needs a
 * real scheduler), or recovery/retry correctness (§7, needs multiple real
 * attempts to compare). SPEC-210 §1 itself states this Product
 * specification owns user-visible execution intent, not the engine
 * protocol (SPEC-504) or authoritative runtime transitions (SPEC-602) —
 * this Skill reviews a declared ExecutionRecord document; it is not itself
 * the runtime that produces one.
 */
export class AssessExecutionRecordQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: ExecutionRecordReviewRequest): Promise<ExecutionRecordReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Execution Record review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const executionRef = request.execution_record.id;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess execution record quality",
      consequence_class: "advisory",
      required_permissions: ["execution_record:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, executionRef],
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
    if (request.execution_record.workspace_id !== request.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: "workspace_scope_mismatch",
          outcome: "blocked",
          message: "The execution record's own Workspace does not match the requested Workspace.",
          retryable: false,
          evidence: [`record-workspace:${request.execution_record.workspace_id}`, `requested-workspace:${request.workspace_id}`],
        },
      };
    }

    const discovery = await this.#dependencies.knowledge.search({
      operation_id: request.operation_id,
      context: request.context,
      query: `${request.execution_record.test_case_ref}\n${request.execution_record.automation_asset_ref}`,
      scopes: ["test_cases", "automation_assets"],
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
      evaluation_id: `${request.operation_id}:execution-record-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.execution_record),
      fact_provenance: unique([
        executionRef,
        request.execution_record.test_case_ref,
        request.execution_record.automation_asset_ref,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["execution_record_quality"],
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
          message: "Deterministic execution-record-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [executionRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      executionRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      executionRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        execution_record_ref: executionRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping used across the
        // other Test capability Skills: only "outcome_integrity" (a
        // terminal record reporting `passed` with no evidence, or an
        // outcome inconsistent with its own lifecycle state — SPEC-210 §4
        // "Infrastructure errors and flaky retries SHALL NOT be reported
        // as product passes") maps to "rejected" — a dishonestly labeled
        // result. Any other critical finding still blocks, but as
        // "blocked".
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

const REJECTION_FINDING_CATEGORIES: ReadonlySet<ExecutionRecordFindingCategory> = new Set(["outcome_integrity"]);

function criticalVerdict(findings: readonly ExecutionRecordFinding[]): ExecutionRecordQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

const TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
]);

/** Pure, in-process deterministic rules for the Execution Contract completeness tracer bullet (SPEC-210 §2/§4). */
export class ExecutionRecordQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const execution = readObject(request.facts, "execution_record");
    if (execution === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The execution_record fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const executionRef = readString(execution, "ref") ?? "execution-record:unknown";
    const findings: JsonObject[] = [];

    for (const [field, label] of [
      ["test_case_ref", "test case reference"],
      ["automation_asset_ref", "automation asset reference"],
      ["engine_ref", "engine reference"],
      ["environment_ref", "environment reference"],
    ] as const) {
      if (readString(execution, field) === undefined) {
        findings.push({
          category: "traceability" satisfies ExecutionRecordFindingCategory,
          severity: "high",
          message: `The execution record has no ${label}.`,
          evidence: [`${executionRef}#${field}`, `rule:execution-record-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this execution, per SPEC-210 §2.`,
        });
      }
    }

    const state = readString(execution, "state");
    const outcome = execution["outcome"];
    const isTerminal = state !== undefined && TERMINAL_STATES.has(state);

    // SPEC-210 §4: a terminal execution SHALL have an outcome; a
    // non-terminal execution SHALL NOT already claim one — the two are the
    // same honesty requirement seen from each direction.
    if (isTerminal && (outcome === null || outcome === undefined)) {
      findings.push({
        category: "outcome_integrity" satisfies ExecutionRecordFindingCategory,
        severity: "high",
        message: `The execution record is in terminal state "${state}" but has no outcome.`,
        evidence: [`${executionRef}#outcome`, "rule:execution-record-terminal-state-has-outcome@1.0.0"],
        next_action: "Record the canonical outcome for this terminal execution, per SPEC-210 §4.",
      });
    }
    if (!isTerminal && typeof outcome === "string") {
      findings.push({
        category: "outcome_integrity" satisfies ExecutionRecordFindingCategory,
        severity: "high",
        message: `The execution record claims outcome "${outcome}" while still in non-terminal state "${state}".`,
        evidence: [`${executionRef}#outcome`, "rule:execution-record-non-terminal-has-no-outcome@1.0.0"],
        next_action: "Do not record an outcome before the execution reaches a terminal state, per SPEC-210 §3/§4.",
      });
    }

    // SPEC-210 §4/§10: "Infrastructure errors and flaky retries SHALL NOT
    // be reported as product passes." A record cannot claim `passed` with
    // no evidence to interpret that result by — an unevidenced pass is
    // exactly the dishonest-outcome shape this rule exists to catch.
    const evidenceList = execution["evidence"];
    const hasEvidence = Array.isArray(evidenceList) && evidenceList.length > 0;
    if (outcome === "passed" && !hasEvidence) {
      findings.push({
        category: "outcome_integrity" satisfies ExecutionRecordFindingCategory,
        severity: "critical",
        message: "The execution record claims a passed outcome with no evidence to interpret it by.",
        evidence: [`${executionRef}#evidence`, "rule:execution-record-passed-outcome-has-evidence@1.0.0"],
        next_action: "Record evidence linking to the exact step, assertion, and capture time, per SPEC-210 §6, before claiming a passed outcome.",
      });
    }

    if (outcome === "skipped" && readString(execution, "skip_reason") === undefined) {
      findings.push({
        category: "completeness" satisfies ExecutionRecordFindingCategory,
        severity: "medium",
        message: "The execution record claims a skipped outcome with no governed reason.",
        evidence: [`${executionRef}#skip_reason`, "rule:execution-record-skipped-has-reason@1.0.0"],
        next_action: "Record the governed reason this execution was skipped, per SPEC-210 §4.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic execution-record-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic execution-record-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "execution-record-has-test-case-ref", version: "1.0.0" },
        { id: "execution-record-terminal-state-has-outcome", version: "1.0.0" },
        { id: "execution-record-non-terminal-has-no-outcome", version: "1.0.0" },
        { id: "execution-record-passed-outcome-has-evidence", version: "1.0.0" },
        { id: "execution-record-skipped-has-reason", version: "1.0.0" },
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

function assessmentFacts(execution: ExecutionRecord): JsonObject {
  return {
    execution_record: {
      ref: execution.id,
      id: execution.id,
      workspace_id: execution.workspace_id,
      actor_id: execution.actor_id,
      test_case_ref: execution.test_case_ref,
      automation_asset_ref: execution.automation_asset_ref,
      engine_ref: execution.engine_ref,
      plugin_refs: [...(execution.plugin_refs ?? [])],
      environment_ref: execution.environment_ref,
      dataset_refs: [...(execution.dataset_refs ?? [])],
      state: execution.state,
      outcome: execution.outcome,
      skip_reason: execution.skip_reason ?? null,
      evidence: [...(execution.evidence ?? [])],
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): ExecutionRecordFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "outcome_integrity", "isolation"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: ExecutionRecordFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as ExecutionRecordFindingCategory,
      severity: severity as ExecutionRecordFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced execution-record-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

