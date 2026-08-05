import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessDefectQuality,
  DefectQualityRuleEngine,
  type Clock,
  type IdFactory,
  type DefectReviewConfiguration,
  type DefectReviewRequest,
} from "../../src/bug-analysis/assess-defect-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { Defect } from "../../src/bug-analysis/public.js";

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
        effective_permissions: ["defect:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "BUG-1@1.0.0"],
        decision_evidence: ["policy:allow-defect-assessment"],
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

const configuration: DefectReviewConfiguration = {
  resolved_versions: {
    agent: "bug-analysis-agent@1.0.0",
    skill: "assess-defect-quality@1.0.0",
    rule_set: "defect-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "defect.schema.json@1.0.0",
    output_schema: "defect-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "BUG-1",
    version: "1.0.0",
    status: "triaged",
    summary: "Lockout does not trigger at the governed threshold.",
    observed_behavior: "Account remains active after 10 failed attempts.",
    expected_behavior: "Account locks at exactly 5 failed attempts.",
    expected_behavior_authority: "RULE-LOCKOUT@1.0.0",
    workspace_scope: "workspace-alpha",
    environment_ref: "staging",
    reproduction_conditions: ["Attempt login 10 times with invalid credentials on staging."],
    evidence: ["run://exec-1/step-3/observation"],
    severity: "high",
    severity_rationale: "Weakens the account-lockout control but is not itself exploitable directly.",
    priority: "p1",
    classification: "product_defect",
    owner: "Product Engineering",
    ...overrides,
  };
}

function reviewRequest(defect: Defect = completeDefect()): DefectReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["triage-owner"],
      permissions: ["defect:read", "knowledge:read", "assessment:create"],
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
    defect,
  };
}

function reviewer(): AssessDefectQuality {
  return new AssessDefectQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new DefectQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete defect passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("closing a defect without fix/regression/release evidence is rejected", async () => {
  const result = await reviewer().review(reviewRequest(completeDefect({ status: "closed" })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a defect with no owner blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeDefect({ owner: "" })));

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
  const result = await new AssessDefectQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new DefectQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
