import type {
  AutomationAsset,
  AutomationAssetAssessment,
  AutomationAssetAssessmentResolvedVersions,
  AutomationAssetFinding,
  AutomationAssetFindingCategory,
  AutomationAssetFindingSeverity,
  AutomationAssetQualityVerdict,
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

export type AutomationAssetReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  automation_asset: AutomationAsset;
}>;

export type AutomationAssetReviewConfiguration = Readonly<{
  resolved_versions: AutomationAssetAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type AutomationAssetReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type AutomationAssetReviewResult = StableResult<AutomationAssetAssessment, AutomationAssetReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: AutomationAssetReviewConfiguration;
}>;

const SECRET_LIKE_PATTERN = /\b(password|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]/i;

/**
 * Deep module for the advisory Assess Automation Asset Quality Skill
 * (SPEC-209 tracer bullet, same authorize → discover → rule → evidence
 * pipeline as the other Test capability Skills). Scoped to Automation
 * Asset Contract completeness (§3) and two safety-adjacent rules: an
 * implemented test case with no assertion mapping (§4 "assertions SHALL
 * map to semantic expected results") and a literal secret embedded in a
 * declared field instead of injected through approved secret management
 * (§8). This slice does NOT verify: whether the automation actually
 * implements the approved test intent correctly (§4/§9, needs the real
 * asset's execution, not its declaration), engine/plugin compatibility at
 * runtime (§5, needs a real engine to bind against), or flakiness
 * classification (§7, needs repeated real trial evidence this
 * document-review Skill doesn't have).
 */
export class AssessAutomationAssetQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: AutomationAssetReviewRequest): Promise<AutomationAssetReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Automation Asset review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const assetRef = `${request.automation_asset.id}@${request.automation_asset.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess automation asset quality",
      consequence_class: "advisory",
      required_permissions: ["automation_asset:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, assetRef],
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
      query: request.automation_asset.execution_interface,
      scopes: ["test_cases", "policies"],
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
      evaluation_id: `${request.operation_id}:automation-asset-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.automation_asset),
      fact_provenance: unique([
        assetRef,
        ...request.automation_asset.implemented_test_case_refs,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["automation_asset_quality"],
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
          message: "Deterministic automation-asset-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [assetRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      assetRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      assetRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        automation_asset_ref: assetRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // Mirrors the category-aware critical mapping used across the
        // other Test capability Skills: only "isolation" (a literal
        // secret embedded instead of injected via approved secret
        // management, SPEC-209 §8) maps to "rejected" — an asset that is
        // unsafe to run as declared. Any other critical finding still
        // blocks, but as "blocked".
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

const REJECTION_FINDING_CATEGORIES: ReadonlySet<AutomationAssetFindingCategory> = new Set(["isolation"]);

function criticalVerdict(findings: readonly AutomationAssetFinding[]): AutomationAssetQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Automation Asset completeness tracer bullet (SPEC-209 §3/§4/§8). */
export class AutomationAssetQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const asset = readObject(request.facts, "automation_asset");
    if (asset === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The automation_asset fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const assetRef = readString(asset, "ref") ?? "automation-asset:unknown";
    const findings: JsonObject[] = [];

    const implementedTestCases = asset["implemented_test_case_refs"];
    if (!Array.isArray(implementedTestCases) || implementedTestCases.length === 0) {
      findings.push({
        category: "traceability" satisfies AutomationAssetFindingCategory,
        severity: "high",
        message: "The automation asset implements no test case.",
        evidence: [`${assetRef}#implemented_test_case_refs`, "rule:automation-asset-has-implemented-tests@1.0.0"],
        next_action: "Trace this asset to at least one approved test case it implements.",
      });
    }

    for (const [field, label] of [
      ["execution_interface", "execution interface"],
      ["owner", "owner"],
    ] as const) {
      if (readString(asset, field) === undefined) {
        findings.push({
          category: "completeness" satisfies AutomationAssetFindingCategory,
          severity: "high",
          message: `The automation asset has no ${label}.`,
          evidence: [`${assetRef}#${field}`, `rule:automation-asset-has-${field.replace(/_/g, "-")}@1.0.0`],
          next_action: `Record the ${label} for this asset, per SPEC-209 §3.`,
        });
      }
    }

    const compatibleEngines = asset["compatible_engine_refs"];
    if (!Array.isArray(compatibleEngines) || compatibleEngines.length === 0) {
      findings.push({
        category: "completeness" satisfies AutomationAssetFindingCategory,
        severity: "high",
        message: "The automation asset declares no compatible execution engine.",
        evidence: [`${assetRef}#compatible_engine_refs`, "rule:automation-asset-has-compatible-engine@1.0.0"],
        next_action: "Declare at least one compatible execution engine, per SPEC-209 §3.",
      });
    }

    const environmentConstraints = asset["environment_constraints"];
    if (!Array.isArray(environmentConstraints) || environmentConstraints.length === 0) {
      findings.push({
        category: "completeness" satisfies AutomationAssetFindingCategory,
        severity: "medium",
        message: "The automation asset declares no environment constraints.",
        evidence: [`${assetRef}#environment_constraints`, "rule:automation-asset-has-environment-constraints@1.0.0"],
        next_action: "Declare the environment constraints this asset depends on, per SPEC-209 §3.",
      });
    }

    // SPEC-209 §4: "assertions SHALL map to semantic expected results." An
    // asset implementing test cases with no recorded assertion mapping
    // cannot be checked against that rule at all — flag it rather than
    // silently accept an unmapped asset.
    const assertionMap = asset["assertion_map"];
    if (
      Array.isArray(implementedTestCases) &&
      implementedTestCases.length > 0 &&
      (!Array.isArray(assertionMap) || assertionMap.length === 0)
    ) {
      findings.push({
        category: "assertion_integrity" satisfies AutomationAssetFindingCategory,
        severity: "high",
        message: "The automation asset implements test cases but records no assertion mapping to their expected results.",
        evidence: [`${assetRef}#assertion_map`, "rule:automation-asset-has-assertion-map@1.0.0"],
        next_action: "Map each implemented assertion to the semantic expected result it verifies, per SPEC-209 §4.",
      });
    }

    // SPEC-209 §8: secrets SHALL be injected through approved secret
    // management, never embedded in a declared field.
    const haystacks = [
      readString(asset, "execution_interface"),
      ...readStrings(asset, "data_requirements"),
      ...readStrings(asset, "environment_constraints"),
    ].filter((value): value is string => value !== undefined);
    if (haystacks.some((value) => SECRET_LIKE_PATTERN.test(value))) {
      findings.push({
        category: "isolation" satisfies AutomationAssetFindingCategory,
        severity: "critical",
        message: "The automation asset appears to embed a literal secret instead of using approved secret injection.",
        evidence: [`${assetRef}#environment_constraints`, "rule:automation-asset-no-embedded-secrets@1.0.0"],
        next_action: "Remove the embedded credential and inject it through approved secret management, per SPEC-209 §8.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic automation-asset-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic automation-asset-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "automation-asset-has-implemented-tests", version: "1.0.0" },
        { id: "automation-asset-completeness", version: "1.0.0" },
        { id: "automation-asset-has-assertion-map", version: "1.0.0" },
        { id: "automation-asset-no-embedded-secrets", version: "1.0.0" },
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

function assessmentFacts(asset: AutomationAsset): JsonObject {
  return {
    automation_asset: {
      ref: `${asset.id}@${asset.version}`,
      id: asset.id,
      version: asset.version,
      status: asset.status,
      implemented_test_case_refs: [...asset.implemented_test_case_refs],
      execution_interface: asset.execution_interface,
      compatible_engine_refs: [...asset.compatible_engine_refs],
      compatible_plugin_refs: [...(asset.compatible_plugin_refs ?? [])],
      data_requirements: [...(asset.data_requirements ?? [])],
      environment_constraints: [...asset.environment_constraints],
      owner: asset.owner,
      evidence_mapping: [...(asset.evidence_mapping ?? [])],
      assertion_map: (asset.assertion_map ?? []).map((mapping) => ({ ...mapping })),
      retry_policy: asset.retry_policy ?? null,
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): AutomationAssetFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "assertion_integrity", "isolation"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: AutomationAssetFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as AutomationAssetFindingCategory,
      severity: severity as AutomationAssetFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced automation-asset-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

function hasExactResolvedVersions(versions: AutomationAssetAssessmentResolvedVersions): boolean {
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
