import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessTestStrategyQuality,
  TestStrategyQualityRuleEngine,
  type Clock,
  type IdFactory,
  type TestStrategyReviewConfiguration,
  type TestStrategyReviewRequest,
} from "../../src/test-strategy/assess-test-strategy-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { TestStrategy } from "../../src/test-strategy/public.js";

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
        effective_permissions: ["test_strategy:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "STRAT-1@1.0.0"],
        decision_evidence: ["policy:allow-test-strategy-assessment"],
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

const configuration: TestStrategyReviewConfiguration = {
  resolved_versions: {
    agent: "test-strategy-agent@1.0.0",
    skill: "assess-test-strategy-quality@1.0.0",
    rule_set: "test-strategy-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "test-strategy.schema.json@1.0.0",
    output_schema: "test-strategy-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeStrategy(
  options: Readonly<{ includeResidualRisk?: boolean }> & Partial<Omit<TestStrategy, "residual_risk">> = {},
): TestStrategy {
  const { includeResidualRisk = true, ...overrides } = options;
  return {
    id: "STRAT-1",
    version: "1.0.0",
    status: "draft",
    scope: "Authentication capability, all Workspaces.",
    objectives: ["Prevent credential-stuffing account lockout."],
    governing_requirement_refs: ["REQ-1@1.0.0"],
    governing_risk_refs: ["RISK-1@1.0.0"],
    quality_characteristics: ["security", "resilience"],
    test_levels: ["unit", "integration"],
    techniques: ["boundary_analysis"],
    environments: [{ name: "staging", representativeness: "Mirrors production traffic shape." }],
    test_data_approach: "Synthetic accounts generated per test run.",
    automation_approach: "Automated regression at integration level.",
    entry_criteria: ["Staging environment is healthy."],
    exit_criteria: ["No critical or high defects open."],
    evidence_and_reporting: "Evidence retained in the Evaluation Campaign record store.",
    roles_and_escalation: "Quality Engineering owns triage; escalates to Security for critical findings.",
    exclusions: ["Third-party identity provider outages are out of scope."],
    assumptions: ["Staging traffic shape matches production within 10%."],
    owner: "Quality Engineering",
    ...(includeResidualRisk ? { residual_risk: "Low, once rate limiting is verified in staging." } : {}),
    ...overrides,
  };
}

function reviewRequest(strategy: TestStrategy = completeStrategy()): TestStrategyReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["quality-engineer"],
      permissions: ["test_strategy:read", "knowledge:read", "assessment:create"],
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
    test_strategy: strategy,
  };
}

function reviewer(): AssessTestStrategyQuality {
  return new AssessTestStrategyQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestStrategyQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete test strategy passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("a strategy governing a risk with no residual risk statement is rejected", async () => {
  const result = await reviewer().review(reviewRequest(completeStrategy({ includeResidualRisk: false })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a strategy with no owner blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeStrategy({ owner: "" })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
});

test("rejects an unauthorized review before discovery or rules run", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await new AssessTestStrategyQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestStrategyQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
