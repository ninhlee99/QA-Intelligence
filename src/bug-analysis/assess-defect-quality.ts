import type {
  Defect,
  DefectAssessment,
  DefectAssessmentResolvedVersions,
  DefectFinding,
  DefectFindingCategory,
  DefectFindingSeverity,
  DefectQualityVerdict,
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
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

export type DefectReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  defect: Defect;
}>;

export type DefectReviewConfiguration = Readonly<{
  resolved_versions: DefectAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type DefectReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type DefectReviewResult = StableResult<DefectAssessment, DefectReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: DefectReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Defect Quality Skill (SPEC-211
 * tracer bullet, same authorize → discover → rule → evidence pipeline as
 * the other Test capability Skills). Scoped to Defect Contract
 * completeness (§2) and the closure-governance rule (§8 "a defect closes
 * only when fix evidence, regression validation, impacted artifacts, and
 * release identity are recorded"). This slice does NOT verify: whether a
 * confirmed root cause is actually correct (§6, needs domain judgment this
 * Skill can't make from a document alone), reproduction reliability (§3,
 * needs a real reproduction attempt), or systemic learning candidate
 * generation (§7, owned by SPEC-105's Learning Engine, not this Skill).
 */
export class AssessDefectQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: DefectReviewRequest): Promise<DefectReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Defect review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const defectRef = `${request.defect.id}@${request.defect.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess defect quality",
      consequence_class: "advisory",
      required_permissions: ["defect:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, defectRef],
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
      query: `${request.defect.summary}\n${request.defect.expected_behavior}`,
      scopes: ["requirements", "risks", "executions"],
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
      evaluation_id: `${request.operation_id}:defect-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.defect),
      fact_provenance: unique([
        defectRef,
        ...request.defect.evidence,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["defect_quality"],
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
          message: "Deterministic defect-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [defectRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      defectRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      defectRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        defect_ref: defectRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping used across the
        // other Test capability Skills: only "closure_governance" (a
        // defect claiming "closed" without the fix evidence, regression
        // validation, and release identity §8 requires) maps to
        // "rejected" — an improperly closed defect that could hide unfixed
        // impact. Any other critical finding still blocks, but as
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

const REJECTION_FINDING_CATEGORIES: ReadonlySet<DefectFindingCategory> = new Set(["closure_governance"]);

function criticalVerdict(findings: readonly DefectFinding[]): DefectQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

const CLOSED_STATUSES = new Set(["fixed", "verified", "closed"]);

/** Pure, in-process deterministic rules for the Defect Contract completeness tracer bullet (SPEC-211 §2/§6/§8). */
export class DefectQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const defect = readObject(request.facts, "defect");
    if (defect === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The defect fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const defectRef = readString(defect, "ref") ?? "defect:unknown";
    const findings: JsonObject[] = [];

    for (const [field, label] of [
      ["summary", "summary"],
      ["observed_behavior", "observed behavior"],
      ["expected_behavior", "expected behavior"],
      ["expected_behavior_authority", "authoritative source for the expected behavior"],
      ["workspace_scope", "Workspace scope"],
      ["environment_ref", "environment reference"],
      ["severity_rationale", "severity rationale"],
      ["owner", "owner"],
    ] as const) {
      if (readString(defect, field) === undefined) {
        findings.push({
          category: "completeness" satisfies DefectFindingCategory,
          severity: "high",
          message: `The defect has no ${label}.`,
          evidence: [`${defectRef}#${field}`, `rule:defect-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this defect, per SPEC-211 §2.`,
        });
      }
    }

    const reproductionConditions = defect["reproduction_conditions"];
    if (!Array.isArray(reproductionConditions) || reproductionConditions.length === 0) {
      findings.push({
        category: "completeness" satisfies DefectFindingCategory,
        severity: "high",
        message: "The defect records no reproduction conditions.",
        evidence: [`${defectRef}#reproduction_conditions`, "rule:defect-has-reproduction-conditions@1.0.0"],
        next_action: "Record the conditions under which this defect reproduces, or bound its reproducibility, per SPEC-211 §2/§3.",
      });
    }

    const evidenceList = defect["evidence"];
    if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
      findings.push({
        category: "completeness" satisfies DefectFindingCategory,
        severity: "high",
        message: "The defect has no evidence.",
        evidence: [`${defectRef}#evidence`, "rule:defect-has-evidence@1.0.0"],
        next_action: "Record evidence supporting this defect's observed behavior, per SPEC-211 §2.",
      });
    }

    // SPEC-211 §2/§6: suspected and confirmed cause SHALL be kept distinct.
    // A defect that already claims a confirmed cause SHALL have evidence to
    // back it — an unevidenced "confirmed" cause is exactly the "presented
    // as confirmed" risk §6 warns against.
    const confirmedCause = readString(defect, "confirmed_cause");
    if (confirmedCause !== undefined && (!Array.isArray(evidenceList) || evidenceList.length === 0)) {
      findings.push({
        category: "cause_integrity" satisfies DefectFindingCategory,
        severity: "high",
        message: "The defect claims a confirmed cause with no evidence to support it.",
        evidence: [`${defectRef}#confirmed_cause`, "rule:defect-confirmed-cause-has-evidence@1.0.0"],
        next_action: "Cite the evidence that confirms this cause, or record it as suspected instead, per SPEC-211 §6.",
      });
    }

    // SPEC-211 §8: "A defect closes only when fix evidence, regression
    // validation, impacted artifacts, and release identity are recorded."
    const status = readString(defect, "status");
    if (status !== undefined && CLOSED_STATUSES.has(status)) {
      const fixEvidence = defect["fix_evidence"];
      const missingClosureFields: string[] = [];
      if (!Array.isArray(fixEvidence) || fixEvidence.length === 0) missingClosureFields.push("fix_evidence");
      if (readString(defect, "regression_validation_ref") === undefined) missingClosureFields.push("regression_validation_ref");
      if (readString(defect, "release_ref") === undefined) missingClosureFields.push("release_ref");
      if (missingClosureFields.length > 0) {
        findings.push({
          category: "closure_governance" satisfies DefectFindingCategory,
          severity: "critical",
          message: `The defect claims status "${status}" but is missing: ${missingClosureFields.join(", ")}.`,
          evidence: [`${defectRef}#status`, "rule:defect-closure-requires-fix-and-release-evidence@1.0.0"],
          next_action: "Record fix evidence, regression validation, and release identity before closing this defect, per SPEC-211 §8.",
        });
      }
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic defect-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic defect-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "defect-completeness", version: "1.0.0" },
        { id: "defect-has-reproduction-conditions", version: "1.0.0" },
        { id: "defect-has-evidence", version: "1.0.0" },
        { id: "defect-confirmed-cause-has-evidence", version: "1.0.0" },
        { id: "defect-closure-requires-fix-and-release-evidence", version: "1.0.0" },
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

function assessmentFacts(defect: Defect): JsonObject {
  return {
    defect: {
      ref: `${defect.id}@${defect.version}`,
      id: defect.id,
      version: defect.version,
      status: defect.status,
      summary: defect.summary,
      observed_behavior: defect.observed_behavior,
      expected_behavior: defect.expected_behavior,
      expected_behavior_authority: defect.expected_behavior_authority,
      affected_capability_id: defect.affected_capability_id ?? null,
      affected_requirement_refs: [...(defect.affected_requirement_refs ?? [])],
      workspace_scope: defect.workspace_scope,
      environment_ref: defect.environment_ref,
      artifact_version_refs: [...(defect.artifact_version_refs ?? [])],
      reproduction_conditions: [...defect.reproduction_conditions],
      evidence: [...defect.evidence],
      severity: defect.severity,
      severity_rationale: defect.severity_rationale,
      priority: defect.priority,
      classification: defect.classification,
      suspected_cause: defect.suspected_cause ?? null,
      confirmed_cause: defect.confirmed_cause ?? null,
      owner: defect.owner,
      fix_evidence: [...(defect.fix_evidence ?? [])],
      regression_validation_ref: defect.regression_validation_ref ?? null,
      release_ref: defect.release_ref ?? null,
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): DefectFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "cause_integrity", "closure_governance"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: DefectFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as DefectFindingCategory,
      severity: severity as DefectFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced defect-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

function hasExactResolvedVersions(versions: DefectAssessmentResolvedVersions): boolean {
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
