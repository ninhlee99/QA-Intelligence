import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTestCaseQualitySkill } from "../../src/agent-skill-quality/evaluate-test-case-quality-skill.js";
import {
  AssessTestCaseQuality,
  TestCaseQualityRuleEngine,
  type Clock as SkillClock,
  type IdFactory,
  type TestCaseReviewConfiguration,
  type TestCaseReviewRequest,
} from "../../src/test-design/assess-test-case-quality.js";
import type { TestCase } from "../../src/test-design/public.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { EvaluationEvidenceVerifier } from "../../src/evaluation/evaluation-manager.js";

class FixedClock implements SkillClock {
  now(): Date {
    return new Date("2026-08-05T08:00:00.000Z");
  }
}

class SequenceIds implements IdFactory {
  #next = 0;
  next(scope: "assessment" | "finding"): string {
    this.#next += 1;
    return `${scope}-${this.#next}`;
  }
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: "policy-3",
        effective_permissions: ["test_case:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: [],
        decision_evidence: ["policy:allow-test-case-assessment"],
      },
    });
  }
}

class EmptyKnowledgeSearch implements KnowledgeSearch {
  search(): Promise<KnowledgeSearchResult> {
    return Promise.resolve({
      ok: true,
      value: { hits: [], knowledge_snapshot: "1.0.0", projection_freshness: "current", warnings: [] },
    });
  }
}

const configuration: TestCaseReviewConfiguration = {
  resolved_versions: {
    agent: "test-design-agent@1.0.0",
    skill: "assess-test-case-quality@1.0.0",
    rule_set: "test-case-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "test-case.schema.json@1.0.0",
    output_schema: "test-case-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function baseWorkspaceContext() {
  return {
    schema_version: "1.0.0" as const,
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human" as const,
    roles: ["test-designer"],
    permissions: ["test_case:read", "knowledge:read", "assessment:create"],
    policy_version: "policy-3",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-05T07:00:00.000Z",
    expires_at: "2026-08-05T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-test-context",
  };
}

function goodTestCase(): TestCase {
  return {
    id: "TC-GOOD",
    version: "1.0.0",
    status: "draft",
    purpose: "Verify lockout behavior at the boundary.",
    traceability: ["REQ-1@1.0.0"],
    preconditions: ["An account exists and is not locked."],
    workspace_scope: "workspace-alpha",
    steps: [{ action: "Attempt authentication with invalid credentials until the threshold." }],
    expected_results: [{ assertion: "The account becomes locked exactly at the threshold.", authority: "RULE-1@1.0.0" }],
    owner: "Quality Owner",
  };
}

function badTestCase(): TestCase {
  return {
    id: "TC-BAD",
    version: "1.0.0",
    status: "draft",
    purpose: "Verify lockout behavior at the boundary.",
    traceability: ["REQ-1@1.0.0"],
    preconditions: ["An account exists and is not locked."],
    workspace_scope: "workspace-alpha",
    steps: [{ action: "Attempt authentication with invalid credentials until the threshold." }],
    // No authority on the expected result — a critical, rejected-mapped gap.
    expected_results: [{ assertion: "The account becomes locked.", authority: "" }],
    owner: "Quality Owner",
  };
}

function reviewRequestFor(testCase: TestCase): TestCaseReviewRequest {
  return {
    operation_id: `operation-${testCase.id}`,
    workspace_id: "workspace-alpha",
    context: baseWorkspaceContext(),
    test_case: testCase,
  };
}

const alwaysTrustingVerifier: EvaluationEvidenceVerifier = { verify: () => true };

function buildSkill(): AssessTestCaseQuality {
  return new AssessTestCaseQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestCaseQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("evaluating the real Assess Test Case Quality Skill on a good and a bad case recommends release (both trials match expectation)", async () => {
  const skill = buildSkill();

  const result = await evaluateTestCaseQualitySkill(new FixedClock(), alwaysTrustingVerifier, skill, {
    run_id: "run-1",
    workspace_id: "workspace-alpha",
    subject: { type: "skill", id: "assess-test-case-quality", version: "1.0.0" },
    suite: { id: "assess-test-case-quality-suite", version: "1.0.0" },
    resolved_versions: { skill: "assess-test-case-quality@1.0.0" },
    critical_invariant_ids: ["no-negative-case-wrongly-accepted"],
    cases: [
      { case_id: "good-case-passes", request: reviewRequestFor(goodTestCase()), expect_pass: true },
      { case_id: "bad-case-rejected", request: reviewRequestFor(badTestCase()), expect_pass: false },
    ],
  });

  assert.equal(result.verdict, "passed", JSON.stringify(result));
  assert.equal(result.recommendation, "recommend_release");
  assert.equal(result.metrics.total_trials, 2);
  assert.equal(result.metrics.passed_trials, 2);
  assert.equal(result.metrics.critical_invariants_passed, 1);
});

test("evaluating a Skill that wrongly accepts a bad case fails the trial and rejects release", async () => {
  // A "broken" rule engine that always reports satisfied — simulating a
  // regression where the real Skill would wrongly accept the bad case.
  const alwaysSatisfiedSkill = new AssessTestCaseQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: {
      evaluate: (request) =>
        Promise.resolve({
          ok: true,
          value: {
            outcome: "satisfied",
            rule_set: { ...request.rule_set },
            rule_versions: [],
            matched_conditions: [],
            relevant_facts: request.fact_provenance,
            outputs: { findings: [] },
            conflicts: [],
            missing_facts: [],
            explanation_trace: ["stubbed always-satisfied rule engine"],
            policy_version: request.context.policy_version,
            duration_ms: 0,
          },
        }),
    },
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const result = await evaluateTestCaseQualitySkill(new FixedClock(), alwaysTrustingVerifier, alwaysSatisfiedSkill, {
    run_id: "run-2",
    workspace_id: "workspace-alpha",
    subject: { type: "skill", id: "assess-test-case-quality", version: "1.0.0" },
    suite: { id: "assess-test-case-quality-suite", version: "1.0.0" },
    resolved_versions: { skill: "assess-test-case-quality@1.0.0" },
    critical_invariant_ids: ["no-negative-case-wrongly-accepted"],
    cases: [
      { case_id: "good-case-passes", request: reviewRequestFor(goodTestCase()), expect_pass: true },
      { case_id: "bad-case-rejected", request: reviewRequestFor(badTestCase()), expect_pass: false },
    ],
  });

  assert.equal(result.verdict, "failed", JSON.stringify(result));
  assert.equal(result.recommendation, "reject_release");
  assert.equal(result.metrics.critical_invariants_passed, 0);
});

test("a Skill that refuses authorization produces a blocked/indeterminate trial, not a fabricated pass", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const deniedSkill = new AssessTestCaseQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestCaseQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const result = await evaluateTestCaseQualitySkill(new FixedClock(), alwaysTrustingVerifier, deniedSkill, {
    run_id: "run-3",
    workspace_id: "workspace-alpha",
    subject: { type: "skill", id: "assess-test-case-quality", version: "1.0.0" },
    suite: { id: "assess-test-case-quality-suite", version: "1.0.0" },
    resolved_versions: { skill: "assess-test-case-quality@1.0.0" },
    critical_invariant_ids: ["no-negative-case-wrongly-accepted"],
    cases: [{ case_id: "good-case-passes", request: reviewRequestFor(goodTestCase()), expect_pass: true }],
  });

  assert.notEqual(result.verdict, "passed");
  assert.notEqual(result.recommendation, "recommend_release");
  const trial = result.trial_results[0];
  assert.equal(trial?.failure_class, "policy_denial");
});
