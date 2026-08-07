import type {
  DeterministicRuleEngine,
  JsonObject,
  JsonValue,
  KnowledgeSearch,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  StableResult,
  TestCase,
  TestCaseAssessment,
  TestCaseAssessmentResolvedVersions,
  TestCaseFinding,
  TestCaseFindingCategory,
  TestCaseFindingSeverity,
  TestCaseQualityVerdict,
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

export type TestCaseReviewRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  test_case: TestCase;
}>;

export type TestCaseReviewConfiguration = Readonly<{
  resolved_versions: TestCaseAssessmentResolvedVersions;
  limits: Readonly<{ knowledge_hits: number }>;
}>;

export type TestCaseReviewFailure = Readonly<{
  class: "configuration" | "authorization" | "knowledge" | "rule";
  code: string;
  outcome: "blocked" | "indeterminate";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type TestCaseReviewResult = StableResult<TestCaseAssessment, TestCaseReviewFailure>;

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  rules: DeterministicRuleEngine;
  clock: Clock;
  ids: IdFactory;
  configuration: TestCaseReviewConfiguration;
}>;

/**
 * Deep module for the advisory Assess Test Case Quality Skill (SPEC-207
 * tracer bullet, same authorize → discover → rule → evidence pipeline as
 * AssessRequirementQuality/AssessRiskQuality). Scoped to Test Case Contract
 * completeness (§2) and the authority-backed-expected-result rule (§3's
 * "expected results SHALL derive from authority"). This slice does NOT
 * verify: technique selection (§4, needs judgment this Skill can't make
 * from one test case alone), coverage across normal/alternate/boundary/
 * failure behavior (§3, a property of a suite, not one case), or whether an
 * assertion is genuinely "observable" (needs semantic understanding a
 * deterministic rule can't provide).
 */
export class AssessTestCaseQuality {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async review(request: TestCaseReviewRequest): Promise<TestCaseReviewResult> {
    if (!hasExactResolvedVersions(this.#dependencies.configuration.resolved_versions)) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "invalid_resolved_versions",
          outcome: "indeterminate",
          message: "Test Case review configuration requires exact immutable version pins.",
          retryable: false,
          evidence: ["configuration:invalid-resolved-versions"],
        },
      };
    }
    const testCaseRef = `${request.test_case.id}@${request.test_case.version}`;
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "assess test case quality",
      consequence_class: "advisory",
      required_permissions: ["test_case:read", "knowledge:read", "assessment:create"],
      resource_refs: [`workspace:${request.workspace_id}`, testCaseRef],
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
      query: request.test_case.purpose,
      scopes: ["requirements", "risks", "business_rules"],
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
      evaluation_id: `${request.operation_id}:test-case-quality`,
      context: request.context,
      rule_set: ruleSet,
      effective_at: effectiveAt,
      facts: assessmentFacts(request.test_case),
      fact_provenance: unique([
        testCaseRef,
        ...request.test_case.traceability,
        ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.provenance]),
      ]),
      requested_decisions: ["test_case_quality"],
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
          message: "Deterministic test-case-quality rules did not produce an applicable decision.",
          retryable: false,
          evidence: [testCaseRef],
        },
      };
    }

    const ruleResultRef = `rule-set:${ruleEvaluation.value.rule_set.id}@${ruleEvaluation.value.rule_set.version}:${ruleEvaluation.value.outcome}`;
    const findings = normalizeFindings(ruleEvaluation.value.outputs["findings"], this.#dependencies.ids, [
      testCaseRef,
      ruleResultRef,
    ]);
    const ruleResults = unique([
      ruleResultRef,
      ...ruleEvaluation.value.rule_versions.map((rule) => `rule:${rule.id}@${rule.version}`),
      ...ruleEvaluation.value.explanation_trace,
    ]);
    const evidence = unique([
      testCaseRef,
      ...authorization.value.decision_evidence,
      ...discovery.value.hits.flatMap((hit) => [hit.knowledge_ref, ...hit.evidence]),
      ...ruleResults,
    ]);

    return {
      ok: true,
      value: {
        id: this.#dependencies.ids.next("assessment"),
        test_case_ref: testCaseRef,
        workspace_id: request.workspace_id,
        outcome: "completed",
        // SPEC-207 §3 "expected results SHALL derive from authority" is a
        // safety-adjacent rule, not merely style — an expected result with
        // no authority is a fabricated pass/fail criterion. Mirrors the
        // category-aware critical mapping from SPEC-203/205: only the
        // "authority" category maps to "rejected" (the test's own expected
        // result is unauthoritative, i.e. untrustworthy by construction);
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

const REJECTION_FINDING_CATEGORIES: ReadonlySet<TestCaseFindingCategory> = new Set(["authority"]);

function criticalVerdict(findings: readonly TestCaseFinding[]): TestCaseQualityVerdict | undefined {
  const critical = findings.filter((finding) => finding.severity === "critical");
  if (critical.length === 0) return undefined;
  return critical.some((finding) => REJECTION_FINDING_CATEGORIES.has(finding.category))
    ? "rejected"
    : "blocked";
}

/** Pure, in-process deterministic rules for the Test Case completeness tracer bullet (SPEC-207 §2/§3/§8). */
export class TestCaseQualityRuleEngine implements DeterministicRuleEngine {
  evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const testCase = readObject(request.facts, "test_case");
    if (testCase === undefined) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "invalid_facts",
          message: "The test_case fact is required.",
          retryable: false,
          evidence: [request.evaluation_id],
        },
      });
    }

    const testCaseRef = readString(testCase, "ref") ?? "test-case:unknown";
    const findings: JsonObject[] = [];

    const traceability = testCase["traceability"];
    if (!Array.isArray(traceability) || traceability.length === 0) {
      findings.push({
        category: "traceability" satisfies TestCaseFindingCategory,
        severity: "high",
        message: "The test case does not trace to any requirement, risk, or rule.",
        evidence: [`${testCaseRef}#traceability`, "rule:test-case-has-traceability@1.0.0"],
        next_action: "Trace this test case to at least one requirement, risk, or rule.",
      });
    }

    const preconditions = testCase["preconditions"];
    if (!Array.isArray(preconditions)) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "medium",
        message: "The test case has no recorded preconditions.",
        evidence: [`${testCaseRef}#preconditions`, "rule:test-case-has-preconditions@1.0.0"],
        next_action: "Record the preconditions this test case depends on.",
      });
    }

    if (readString(testCase, "workspace_scope") === undefined) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "high",
        message: "The test case has no Workspace scope.",
        evidence: [`${testCaseRef}#workspace_scope`, "rule:test-case-has-workspace-scope@1.0.0"],
        next_action: "Record the Workspace scope this test case runs against.",
      });
    }

    const steps = testCase["steps"];
    if (!Array.isArray(steps) || steps.length === 0) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "critical",
        message: "The test case has no steps.",
        evidence: [`${testCaseRef}#steps`, "rule:test-case-has-steps@1.0.0"],
        next_action: "Define at least one semantic action for this test case.",
      });
    }

    const expectedResults = testCase["expected_results"];
    if (!Array.isArray(expectedResults) || expectedResults.length === 0) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "critical",
        message: "The test case has no expected results.",
        evidence: [`${testCaseRef}#expected_results`, "rule:test-case-has-expected-results@1.0.0"],
        next_action: "Define at least one expected result with an authoritative source.",
      });
    } else {
      const unauthoritative = expectedResults.filter(
        (result) => !isJsonObject(result) || readString(result, "authority") === undefined,
      );
      if (unauthoritative.length > 0) {
        findings.push({
          category: "authority" satisfies TestCaseFindingCategory,
          severity: "critical",
          message: "An expected result has no authoritative source — SPEC-207 §3 requires expected results to derive from authority.",
          evidence: [`${testCaseRef}#expected_results`, "rule:test-case-expected-result-has-authority@1.0.0"],
          next_action: "Cite the accepted requirement, risk, or rule each expected result derives from.",
        });
      }
    }

    if (readString(testCase, "owner") === undefined) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "high",
        message: "The test case has no owner.",
        evidence: [`${testCaseRef}#owner`, "rule:test-case-has-owner@1.0.0"],
        next_action: "Assign an accountable owner before this test case can be accepted.",
      });
    }

    // SPEC-207 §2 requires "actor and Workspace scope" as one contract
    // element; workspace_scope is checked above, actor_scope was declared
    // in facts but never checked — completing the pair.
    if (readString(testCase, "actor_scope") === undefined) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "medium",
        message: "The test case has no actor scope.",
        evidence: [`${testCaseRef}#actor_scope`, "rule:test-case-has-actor-scope@1.0.0"],
        next_action: "Record the actor this test case runs as, per SPEC-207 §2.",
      });
    }

    // SPEC-207 §2 lists "cleanup or state restoration" as a required
    // contract element, and §3's design principles separately require
    // "test independence and state effects SHALL be explicit" — a test
    // case with no cleanup declaration leaves that explicitness
    // unenforceable, not merely undocumented.
    const cleanup = testCase["cleanup"];
    if (!Array.isArray(cleanup) || cleanup.length === 0) {
      findings.push({
        category: "independence" satisfies TestCaseFindingCategory,
        severity: "high",
        message: "The test case has no cleanup or state-restoration steps.",
        evidence: [`${testCaseRef}#cleanup`, "rule:test-case-has-cleanup@1.0.0"],
        next_action: "Record cleanup or state-restoration steps so this test case's state effects are explicit, per SPEC-207 §2/§3.",
      });
    }

    // SPEC-207 §2 lists "priority and tags" as a Contract element. Lower
    // severity than cleanup/actor-scope: §3's design principles don't call
    // out priority/tags specifically, so their absence is a completeness
    // gap, not a safety or independence concern.
    if (readString(testCase, "priority") === undefined) {
      findings.push({
        category: "completeness" satisfies TestCaseFindingCategory,
        severity: "low",
        message: "The test case has no priority.",
        evidence: [`${testCaseRef}#priority`, "rule:test-case-has-priority@1.0.0"],
        next_action: "Record this test case's priority, per SPEC-207 §2.",
      });
    }

    if (findings.length > 0) {
      return Promise.resolve(successfulRuleEvaluation(request, "not_satisfied", findings));
    }
    return Promise.resolve(
      successfulRuleEvaluation(request, "satisfied", [], ["all deterministic test-case-quality rules satisfied"]),
    );
  }
}

function successfulRuleEvaluation(
  request: RuleEvaluationRequest,
  outcome: "satisfied" | "not_satisfied",
  findings: readonly JsonObject[],
  explanation: readonly string[] = ["deterministic test-case-quality gaps found"],
): Extract<RuleEvaluationResult, { ok: true }> {
  return {
    ok: true,
    value: {
      outcome,
      rule_set: { ...request.rule_set },
      rule_versions: [
        { id: "test-case-has-traceability", version: "1.0.0" },
        { id: "test-case-has-preconditions", version: "1.0.0" },
        { id: "test-case-has-workspace-scope", version: "1.0.0" },
        { id: "test-case-has-steps", version: "1.0.0" },
        { id: "test-case-has-expected-results", version: "1.0.0" },
        { id: "test-case-expected-result-has-authority", version: "1.0.0" },
        { id: "test-case-has-owner", version: "1.0.0" },
        { id: "test-case-has-actor-scope", version: "1.0.0" },
        { id: "test-case-has-cleanup", version: "1.0.0" },
        { id: "test-case-has-priority", version: "1.0.0" },
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

function assessmentFacts(testCase: TestCase): JsonObject {
  return {
    test_case: {
      ref: `${testCase.id}@${testCase.version}`,
      id: testCase.id,
      version: testCase.version,
      status: testCase.status,
      purpose: testCase.purpose,
      traceability: [...testCase.traceability],
      preconditions: [...testCase.preconditions],
      workspace_scope: testCase.workspace_scope,
      data_requirements: [...(testCase.data_requirements ?? [])],
      steps: testCase.steps.map((step) => ({ action: step.action, input: step.input ?? {} })),
      expected_results: testCase.expected_results.map((result) => ({ ...result })),
      owner: testCase.owner,
      actor_scope: testCase.actor_scope ?? null,
      priority: testCase.priority ?? null,
      tags: [...(testCase.tags ?? [])],
      cleanup: [...(testCase.cleanup ?? [])],
    },
  };
}

function normalizeFindings(
  value: JsonValue | undefined,
  ids: IdFactory,
  fallbackEvidence: readonly string[],
): TestCaseFinding[] {
  if (!Array.isArray(value)) return [];
  const categories = ["completeness", "traceability", "authority", "independence"] as const;
  const severities = ["critical", "high", "medium", "low"] as const;

  const findings: TestCaseFinding[] = [];
  for (const candidate of value) {
    if (!isJsonObject(candidate)) continue;
    const category = readEnum(candidate, "category", categories);
    const severity = readEnum(candidate, "severity", severities);
    const message = readString(candidate, "message");
    if (category === undefined || severity === undefined || message === undefined) continue;
    const evidence = readStrings(candidate, "evidence");
    findings.push({
      id: ids.next("finding"),
      category: category as TestCaseFindingCategory,
      severity: severity as TestCaseFindingSeverity,
      message,
      evidence: evidence.length === 0 ? [...fallbackEvidence] : unique([...evidence, ...fallbackEvidence]),
      next_action:
        readString(candidate, "next_action") ??
        "Resolve this evidenced test-case-quality gap and re-run the assessment.",
    });
  }
  return findings;
}

