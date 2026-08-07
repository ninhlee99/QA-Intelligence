import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessExecutionRecordQuality,
  ExecutionRecordQualityRuleEngine,
  type Clock,
  type IdFactory,
  type ExecutionRecordReviewConfiguration,
  type ExecutionRecordReviewRequest,
} from "../../src/execution/assess-execution-record-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { ExecutionRecord } from "../../src/execution/public.js";

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
        effective_permissions: ["execution_record:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "EXEC-1"],
        decision_evidence: ["policy:allow-execution-record-assessment"],
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

const configuration: ExecutionRecordReviewConfiguration = {
  resolved_versions: {
    agent: "execution-agent@1.0.0",
    skill: "assess-execution-record-quality@1.0.0",
    rule_set: "execution-record-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "execution-record.schema.json@1.0.0",
    output_schema: "execution-record-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeExecution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: "EXEC-1",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    test_case_ref: "TC-1@1.0.0",
    automation_asset_ref: "AA-1@1.0.0",
    engine_ref: "playwright@1.40.0",
    environment_ref: "staging",
    state: "completed",
    outcome: "passed",
    evidence: ["run://exec-1/step-1/assertion-1"],
    ...overrides,
  };
}

function reviewRequest(execution: ExecutionRecord = completeExecution()): ExecutionRecordReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["execution-observer"],
      permissions: ["execution_record:read", "knowledge:read", "assessment:create"],
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
    execution_record: execution,
  };
}

function reviewer(): AssessExecutionRecordQuality {
  return new AssessExecutionRecordQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new ExecutionRecordQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete terminal execution passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("a passed outcome with no evidence is rejected (dishonest outcome)", async () => {
  const result = await reviewer().review(reviewRequest(completeExecution({ evidence: [] })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a terminal execution with no engine reference blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeExecution({ engine_ref: "" })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
});

test("rejects a review whose execution record Workspace does not match the requested Workspace", async () => {
  const result = await reviewer().review(
    reviewRequest(completeExecution({ workspace_id: "workspace-other" })),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_scope_mismatch");
});

test("rejects an unauthorized review before discovery or rules run", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await new AssessExecutionRecordQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new ExecutionRecordQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
