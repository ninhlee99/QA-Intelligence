import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  Risk,
  RiskAssessment,
  RiskAssessmentResolvedVersions,
  RiskAssessmentUncertainty,
  RiskFinding,
  RiskFindingCategory,
  RiskFindingSeverity,
  RiskQualityVerdict,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(scope: "assessment" | "finding"): string;
}

export type RiskReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  risk: Risk;
}>;

export type RiskReviewConfiguration = Readonly<{
  resolved_versions: RiskAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type RiskReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type RiskReviewResult = StableResult<RiskAssessment, RiskReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: RiskReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Risk Quality Skill (SPEC-205 tracer
 * bullet, mirroring the AssessRequirementQuality/SPEC-203 pattern). Scoped
 * to Risk Model completeness (§2) and the critical-category-not-hidden rule
 * (§5) — this slice does NOT do scoring/prioritization (§5's governed
 * scales don't exist yet), AI-assisted risk discovery (§8, needs a real
 * reasoning provider), or traceability verification (§7, needs a corpus of
 * requirements/tests/defects to trace against, which a single-Risk-per-call
 * Skill cannot see).
 */
export class AssessRiskQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: RiskReviewRequest): Promise<RiskReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Risk review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const riskRef = `${request.risk.id}@${request.risk.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess risk quality",
      consequence_class: "advisory",
      required_permissions: ["risk:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, riskRef],
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
      query: `${request.risk.statement.cause}\n${request.risk.statement.event}\n${request.risk.statement.consequence}`,
      scopes: ["risks", "controls", "policies"],
      authority_statuses: ["accepted"],
      applicability: { workspace_id: request.workspace_id, capability_id: request.risk.affected.capability_id ?? null },
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
      evaluation_id: `${request.operation_id}:risk-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.risk),
      fact_provenance: unique([
        riskRef,
        ...request.risk.evidence,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["risk_quality"],
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
          message: "Deterministic risk-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [riskRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      riskRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      riskRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        risk_ref: riskRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // SPEC-205 §5: a score/verdict SHALL NOT hide a critical finding —
        // same choke point as SPEC-203 §7, applied here to Risk. §5 also
        // lists 5 categories that require independent critical treatment
        // regardless of severity; this tracer-bullet slice enforces it only
        // through the rule engine's own critical findings (§9 gate), not a
        // separate always-on category check, since scoring/prioritization
        // (§5's governed scales) is explicitly out of scope for this slice.
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

/**
 * SPEC-205 §5 defines the categories that require independent critical
 * treatment (cross-Workspace exposure, unauthorized behavior, irreversible
 * data loss, evidence falsification, unbounded AI autonomy). Mapped here to
 * this Skill's own finding categories: only `security_and_privacy`-flavored
 * completeness gaps risk hiding one of those, so — mirroring SPEC-203's
 * fix — critical severity maps to "rejected" only when the finding itself
 * says the Risk record is unsafe to accept as-is (missing owner, missing
 * controls, missing residual-risk statement); anything else critical still
 * blocks, but as "blocked", not a false safety rejection.
 */
const REJECTION_FINDING_CATEGORIES: ReadonlySet<RiskFindingCategory> = new Set([
  "treatment_governance",
]);

function criticalVerdict(findings: readonly RiskFinding[]): RiskQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Risk Model completeness tracer bullet (SPEC-205 §2/§9). */
export class RiskQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const risk = readObject(request.facts, "risk");
    if (risk === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The risk fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const riskRef = readString(risk, "ref") ?? "risk:unknown";
    const findings: JsonObject[] = [];

    const statement = readObject(risk, "statement");
    const missingStatementParts = ["cause", "event", "consequence"].filter(
      (part) => statement === undefined || readString(statement, part) === undefined,
    );
    if (missingStatementParts.length > 0) {
      findings.push({
        category: "completeness" satisfies RiskFindingCategory,
        severity: "high",
        message: `The risk statement is missing: ${missingStatementParts.join(", ")}.`,
        evidence: [`${riskRef}#statement`, "rule:risk-has-complete-statement@1.0.0"],
        next_action: "State the risk as cause, event, and consequence, per SPEC-205 §2.",
      });
    }

    if (readString(risk, "owner") === undefined) {
      findings.push({
        category: "completeness" satisfies RiskFindingCategory,
        severity: "high",
        message: "The risk has no accountable owner.",
        evidence: [`${riskRef}#owner`, "rule:risk-has-owner@1.0.0"],
        next_action: "Assign an accountable owner before this risk can be accepted.",
      });
    }

    const controls = risk["controls"];
    if (!Array.isArray(controls) || controls.length === 0) {
      findings.push({
        category: "treatment_governance" satisfies RiskFindingCategory,
        severity: "critical",
        message: "The risk has no recorded controls.",
        evidence: [`${riskRef}#controls`, "rule:risk-has-controls@1.0.0"],
        next_action: "Record at least one control before accepting this risk's residual exposure.",
      });
    }

    if (readString(risk, "residual_risk") === undefined) {
      findings.push({
        category: "treatment_governance" satisfies RiskFindingCategory,
        severity: "critical",
        message: "The risk has no residual-risk statement.",
        evidence: [`${riskRef}#residual_risk`, "rule:risk-has-residual-statement@1.0.0"],
        next_action: "Record the residual risk remaining after controls, per SPEC-205 §2.",
      });
    }

    if (readString(risk, "likelihood_rationale") === undefined || readString(risk, "impact_rationale") === undefined) {
      findings.push({
        category: "completeness" satisfies RiskFindingCategory,
        severity: "medium",
        message: "The risk is missing a likelihood or impact rationale.",
        evidence: [`${riskRef}#likelihood_rationale`, "rule:risk-has-likelihood-and-impact-rationale@1.0.0"],
        next_action: "Record the rationale behind the likelihood and impact estimate, per SPEC-205 §2.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic risk-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic risk-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "risk-has-complete-statement", version: "1.0.0" },
        { id: "risk-has-owner", version: "1.0.0" },
        { id: "risk-has-controls", version: "1.0.0" },
        { id: "risk-has-residual-statement", version: "1.0.0" },
        { id: "risk-has-likelihood-and-impact-rationale", version: "1.0.0" },
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

function assessmentFacts(risk: Risk): JsonObject {
  return {
    risk: {
      ref: `${risk.id}@${risk.version}`,
      id: risk.id,
      version: risk.version,
      status: risk.status,
      statement: { ...risk.statement },
      category: risk.category,
      affected: { ...risk.affected },
      likelihood_rationale: risk.likelihood_rationale,
      impact_rationale: risk.impact_rationale,
      detectability: risk.detectability ?? null,
      evidence: [...risk.evidence],
      assumptions: [...(risk.assumptions ?? [])],
      owner: risk.owner,
      controls: [...risk.controls],
      residual_risk: risk.residual_risk,
      treatment: risk.treatment ?? null,
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): RiskFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = [
    "completeness",
    "traceability",
    "prioritization",
    "treatment_governance",
  ] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: RiskFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as RiskFindingCategory,
      severity: severity as RiskFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced risk-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

function hasExactResolvedVersions(versions: RiskAssessmentResolvedVersions): boolean {
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
