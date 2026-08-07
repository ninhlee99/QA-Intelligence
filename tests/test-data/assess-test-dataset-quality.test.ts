import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessTestDatasetQuality,
  TestDatasetQualityRuleEngine,
  type Clock,
  type IdFactory,
  type TestDatasetReviewConfiguration,
  type TestDatasetReviewRequest,
} from "../../src/test-data/assess-test-dataset-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { TestDataset } from "../../src/test-data/public.js";

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
        effective_permissions: ["test_dataset:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "DS-1@1.0.0"],
        decision_evidence: ["policy:allow-test-dataset-assessment"],
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

const configuration: TestDatasetReviewConfiguration = {
  resolved_versions: {
    agent: "test-data-agent@1.0.0",
    skill: "assess-test-dataset-quality@1.0.0",
    rule_set: "test-dataset-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "test-dataset.schema.json@1.0.0",
    output_schema: "test-dataset-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeDataset(overrides: Partial<TestDataset> = {}): TestDataset {
  return {
    id: "DS-1",
    version: "1.0.0",
    status: "draft",
    owner: "Data Governance",
    purpose: "Boundary values for the account-lockout threshold.",
    traced_test_refs: ["TC-1@1.0.0"],
    schema_ref: "account.schema.json@1.0.0",
    source: "Synthetic generator",
    generation_method: "Deterministic factory seeded by test run ID.",
    classification: "synthetic",
    workspace_scope: "workspace-alpha",
    environment_scope: "staging",
    setup: "Insert accounts at threshold-1, threshold, threshold+1.",
    teardown: "Delete all accounts created by this dataset's setup.",
    retention: "Deleted at end of test run.",
    disposal: "Automatic teardown, no manual step.",
    ...overrides,
  };
}

function reviewRequest(dataset: TestDataset = completeDataset()): TestDatasetReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["data-governance"],
      permissions: ["test_dataset:read", "knowledge:read", "assessment:create"],
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
    test_dataset: dataset,
  };
}

function reviewer(): AssessTestDatasetQuality {
  return new AssessTestDatasetQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestDatasetQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete dataset passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("a dataset with sensitive fields and no controls is rejected", async () => {
  const result = await reviewer().review(reviewRequest(completeDataset({ contains_sensitive_fields: true })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a dataset with no owner blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeDataset({ owner: "" })));

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
  const result = await new AssessTestDatasetQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new TestDatasetQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
