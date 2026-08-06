import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessTestCaseQuality,
  TestCaseQualityRuleEngine,
  type Clock,
  type IdFactory,
  type TestCaseReviewConfiguration,
  type TestCaseReviewRequest,
} from "../../src/test-design/assess-test-case-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { TestCase } from "../../src/test-design/public.js";

class FixedClock implements Clock {
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
        authorized_resource_refs: ["workspace:workspace-alpha", "TC-1@1.0.0"],
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

function completeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: "TC-1",
    version: "1.0.0",
    status: "draft",
    purpose: "Verify lockout behavior at the boundary.",
    traceability: ["REQ-1@1.0.0"],
    preconditions: ["An account exists and is not locked."],
    workspace_scope: "workspace-alpha",
    steps: [{ action: "Attempt authentication with invalid credentials until the threshold." }],
    expected_results: [{ assertion: "The account becomes locked exactly at the threshold.", authority: "RULE-1@1.0.0" }],
    owner: "Quality Owner",
    actor_scope: "authenticated-user",
    cleanup: ["Unlock the account and reset failed-attempt counter."],
    priority: "high",
    ...overrides,
  };
}

function reviewRequest(testCase: TestCase = completeTestCase()): TestCaseReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
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
    },
    test_case: testCase,
  };
}

function reviewer(): AssessTestCaseQuality {
  return new AssessTestCaseQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestCaseQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete test case passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("an expected result missing authority is rejected (critical, authority category)", async () => {
  const result = await reviewer().review(
    reviewRequest(completeTestCase({ expected_results: [{ assertion: "The account is locked.", authority: "" }] })),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a test case with no owner blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeTestCase({ owner: "" })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
});

test("a test case with no steps blocks (critical completeness, not authority)", async () => {
  const result = await reviewer().review(reviewRequest(completeTestCase({ steps: [] })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "blocked");
});

test("rejects an unauthorized review before discovery or rules run", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await new AssessTestCaseQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestCaseQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
