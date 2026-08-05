import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  TestStrategy,
  TestStrategyAssessment,
  TestStrategyAssessmentResolvedVersions,
  TestStrategyFinding,
  TestStrategyFindingCategory,
  TestStrategyFindingSeverity,
  TestStrategyQualityVerdict,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(scope: "assessment" | "finding"): string;
}

export type TestStrategyReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  test_strategy: TestStrategy;
}>;

export type TestStrategyReviewConfiguration = Readonly<{
  resolved_versions: TestStrategyAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type TestStrategyReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type TestStrategyReviewResult = StableResult<TestStrategyAssessment, TestStrategyReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: TestStrategyReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Test Strategy Quality Skill (SPEC-206
 * tracer bullet, same authorize → discover → rule → evidence pipeline as
 * the other Test capability Skills). Scoped to Strategy Contract
 * completeness (§3's 12 required elements) and a risk-coverage-articulation
 * rule (§6's "critical risks SHALL have explicit prevention and detection
 * evidence" — narrowed here to "if any risk is governed by this strategy,
 * residual risk after this strategy's coverage SHALL be stated", since a
 * deterministic rule reading only `governing_risk_refs` strings cannot
 * itself judge which referenced risk is "critical"). This slice does NOT
 * verify: technique/test-level appropriateness for the actual risk profile
 * (§6, needs judgment this Skill can't make from a strategy document
 * alone), coverage completeness across requirements/risks/rules/workflows
 * (§7, needs a corpus this single-Strategy-per-call Skill doesn't have), or
 * AI validation dimension coverage (§9, defers to SPEC-107 §5's canonical
 * list, out of scope here).
 */
export class AssessTestStrategyQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: TestStrategyReviewRequest): Promise<TestStrategyReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Test Strategy review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const strategyRef = `${request.test_strategy.id}@${request.test_strategy.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess test strategy quality",
      consequence_class: "advisory",
      required_permissions: ["test_strategy:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, strategyRef],
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
      query: request.test_strategy.scope,
      scopes: ["requirements", "risks", "policies"],
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
      evaluation_id: `${request.operation_id}:test-strategy-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.test_strategy),
      fact_provenance: unique([
        strategyRef,
        ...(request.test_strategy.governing_requirement_refs ?? []),
        ...(request.test_strategy.governing_risk_refs ?? []),
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["test_strategy_quality"],
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
          message: "Deterministic test-strategy-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [strategyRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      strategyRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      strategyRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        test_strategy_ref: strategyRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping from SPEC-203/205/207:
        // only "risk_coverage" (a governed risk with no stated residual
        // exposure after this strategy — SPEC-206 §6) maps to "rejected";
        // any other critical finding still blocks, but as "blocked".
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

const REJECTION_FINDING_CATEGORIES: ReadonlySet<TestStrategyFindingCategory> = new Set(["risk_coverage"]);

function criticalVerdict(findings: readonly TestStrategyFinding[]): TestStrategyQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Strategy Contract completeness tracer bullet (SPEC-206 §3/§6/§11). */
export class TestStrategyQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const strategy = readObject(request.facts, "test_strategy");
    if (strategy === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The test_strategy fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const strategyRef = readString(strategy, "ref") ?? "test-strategy:unknown";
    const findings: JsonObject[] = [];

    const governingRequirements = strategy["governing_requirement_refs"];
    const governingRisks = strategy["governing_risk_refs"];
    if (
      (!Array.isArray(governingRequirements) || governingRequirements.length === 0) &&
      (!Array.isArray(governingRisks) || governingRisks.length === 0)
    ) {
      findings.push({
        category: "traceability" satisfies TestStrategyFindingCategory,
        severity: "high",
        message: "The test strategy traces to no governing requirement or risk.",
        evidence: [`${strategyRef}#governing_requirement_refs`, "rule:test-strategy-has-governing-refs@1.0.0"],
        next_action: "Trace this strategy to at least one governing requirement or risk.",
      });
    }

    for (const [field, label] of [
      ["quality_characteristics", "quality characteristics"],
      ["test_levels", "test levels"],
      ["techniques", "techniques"],
      ["environments", "environments"],
      ["entry_criteria", "entry criteria"],
      ["exit_criteria", "exit criteria"],
      ["objectives", "objectives"],
    ] as const) {
      const value = strategy[field];
      if (!Array.isArray(value) || value.length === 0) {
        findings.push({
          category: "completeness" satisfies TestStrategyFindingCategory,
          severity: "high",
          message: `The test strategy has no ${label}.`,
          evidence: [`${strategyRef}#${field}`, `rule:test-strategy-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record ${label} for this strategy, per SPEC-206 §3.`,
        });
      }
    }

    for (const [field, label] of [
      ["test_data_approach", "test data approach"],
      ["automation_approach", "automation approach"],
      ["evidence_and_reporting", "evidence and reporting approach"],
      ["scope", "scope"],
    ] as const) {
      if (readString(strategy, field) === undefined) {
        findings.push({
          category: "completeness" satisfies TestStrategyFindingCategory,
          severity: "high",
          message: `The test strategy has no ${label}.`,
          evidence: [`${strategyRef}#${field}`, `rule:test-strategy-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this strategy, per SPEC-206 §3.`,
        });
      }
    }

    if (readString(strategy, "owner") === undefined) {
      findings.push({
        category: "governance" satisfies TestStrategyFindingCategory,
        severity: "high",
        message: "The test strategy has no accountable owner.",
        evidence: [`${strategyRef}#owner`, "rule:test-strategy-has-owner@1.0.0"],
        next_action: "Assign an accountable owner before this strategy can be accepted.",
      });
    }

    // SPEC-206 §6: "Critical risks SHALL have explicit prevention and
    // detection evidence." This deterministic rule cannot judge which
    // referenced risk is critical, but it can require that a strategy
    // governing at least one risk states the residual risk left after its
    // own coverage — silence on residual risk when a risk is in scope is
    // itself the gap this Skill can safely detect.
    if (
      Array.isArray(governingRisks) &&
      governingRisks.length > 0 &&
      readString(strategy, "residual_risk") === undefined
    ) {
      findings.push({
        category: "risk_coverage" satisfies TestStrategyFindingCategory,
        severity: "critical",
        message: "The test strategy governs at least one risk but states no residual risk after its own coverage.",
        evidence: [`${strategyRef}#residual_risk`, "rule:test-strategy-states-residual-risk-when-risk-governed@1.0.0"],
        next_action: "State the residual risk remaining after this strategy's coverage, per SPEC-206 §6.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic test-strategy-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic test-strategy-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "test-strategy-has-governing-refs", version: "1.0.0" },
        { id: "test-strategy-completeness", version: "1.0.0" },
        { id: "test-strategy-has-owner", version: "1.0.0" },
        { id: "test-strategy-states-residual-risk-when-risk-governed", version: "1.0.0" },
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

function assessmentFacts(strategy: TestStrategy): JsonObject {
  return {
    test_strategy: {
      ref: `${strategy.id}@${strategy.version}`,
      id: strategy.id,
      version: strategy.version,
      status: strategy.status,
      scope: strategy.scope,
      objectives: [...strategy.objectives],
      governing_requirement_refs: [...(strategy.governing_requirement_refs ?? [])],
      governing_risk_refs: [...(strategy.governing_risk_refs ?? [])],
      quality_characteristics: [...strategy.quality_characteristics],
      test_levels: [...strategy.test_levels],
      techniques: [...strategy.techniques],
      coverage_model: strategy.coverage_model ?? null,
      environments: strategy.environments.map((environment) => ({ ...environment })),
      test_data_approach: strategy.test_data_approach,
      automation_approach: strategy.automation_approach,
      entry_criteria: [...strategy.entry_criteria],
      exit_criteria: [...strategy.exit_criteria],
      evidence_and_reporting: strategy.evidence_and_reporting,
      roles_and_escalation: strategy.roles_and_escalation ?? null,
      exclusions: [...(strategy.exclusions ?? [])],
      assumptions: [...(strategy.assumptions ?? [])],
      residual_risk: strategy.residual_risk ?? null,
      owner: strategy.owner,
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): TestStrategyFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "risk_coverage", "governance"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: TestStrategyFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as TestStrategyFindingCategory,
      severity: severity as TestStrategyFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced test-strategy-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

function hasExactResolvedVersions(versions: TestStrategyAssessmentResolvedVersions): boolean {
  const reference = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
  const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
  return (
    reference.test(versions.agent) &&
    reference.test(versions.skill) &&
    reference.test(versions.rule_set) &&
    semver.test(versions.knowledge_snapshot) &&
    reference.test(versions.policy) &&
    reference.test(versions.input_schema) &&
    reference.test(versions.output_schema)
  );
}

function parseVersionReference(value: string): Readonly<{ id: string; version: string }> {
  const [id, version] = value.split("@");
  return { id: id ?? value, version: version ?? "0.0.0" };
}

function readObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isJsonObject(value) ? value : undefined;
}

function readString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStrings(object: JsonObject, key: string): string[] {
  const value = object[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function readEnum<const Value extends string>(
  object: JsonObject,
  key: string,
  values: readonly Value[],
): Value | undefined {
  const value = object[key];
  return typeof value === "string" && values.some((candidate) => candidate === value)
    ? (value as Value)
    : undefined;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
