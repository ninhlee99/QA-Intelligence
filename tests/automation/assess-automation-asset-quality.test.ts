import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessAutomationAssetQuality,
  AutomationAssetQualityRuleEngine,
  type Clock,
  type IdFactory,
  type AutomationAssetReviewConfiguration,
  type AutomationAssetReviewRequest,
} from "../../src/automation/assess-automation-asset-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { AutomationAsset } from "../../src/automation/public.js";

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
        effective_permissions: ["automation_asset:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "AA-1@1.0.0"],
        decision_evidence: ["policy:allow-automation-asset-assessment"],
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

const configuration: AutomationAssetReviewConfiguration = {
  resolved_versions: {
    agent: "automation-agent@1.0.0",
    skill: "assess-automation-asset-quality@1.0.0",
    rule_set: "automation-asset-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "automation-asset.schema.json@1.0.0",
    output_schema: "automation-asset-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeAsset(overrides: Partial<AutomationAsset> = {}): AutomationAsset {
  return {
    id: "AA-1",
    version: "1.0.0",
    status: "draft",
    implemented_test_case_refs: ["TC-1@1.0.0"],
    execution_interface: "playwright-adapter@1.0.0",
    compatible_engine_refs: ["playwright@1.40.0"],
    environment_constraints: ["staging"],
    owner: "Automation Engineering",
    assertion_map: [{ expected_result_ref: "TC-1#expected_results[0]", assertion_implementation: "expect(page).toHaveText(...)" }],
    ...overrides,
  };
}

function reviewRequest(asset: AutomationAsset = completeAsset()): AutomationAssetReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["automation-engineer"],
      permissions: ["automation_asset:read", "knowledge:read", "assessment:create"],
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
    automation_asset: asset,
  };
}

function reviewer(): AssessAutomationAssetQuality {
  return new AssessAutomationAssetQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new AutomationAssetQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete automation asset passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("an asset with an embedded secret is rejected", async () => {
  const result = await reviewer().review(
    reviewRequest(completeAsset({ environment_constraints: ["staging", "password: hunter2"] })),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("an asset with no owner blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeAsset({ owner: "" })));

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
  const result = await new AssessAutomationAssetQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new AutomationAssetQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
