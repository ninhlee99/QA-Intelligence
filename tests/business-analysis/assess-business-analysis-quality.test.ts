import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessBusinessAnalysisQuality,
  BusinessAnalysisQualityRuleEngine,
  type BusinessAnalysisReviewConfiguration,
  type BusinessAnalysisReviewRequest,
  type Clock,
  type IdFactory,
} from "../../src/business-analysis/assess-business-analysis-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { Workflow } from "../../src/business-analysis/public.js";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-07T08:00:00.000Z");
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
        effective_permissions: ["workflow:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "WORKFLOW-1@1.0.0"],
        decision_evidence: ["policy:allow-business-analysis-assessment"],
      },
    });
  }
}

class EmptyKnowledgeSearch implements KnowledgeSearch {
  search(): Promise<KnowledgeSearchResult> {
    return Promise.resolve({
      ok: true,
      value: {
        hits: [],
        knowledge_snapshot: "1.0.0",
        projection_freshness: "current",
        warnings: [],
      },
    });
  }
}

const configuration: BusinessAnalysisReviewConfiguration = {
  resolved_versions: {
    agent: "business-analysis-agent@1.0.0",
    skill: "assess-business-analysis-quality@1.0.0",
    rule_set: "business-analysis-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "workflow.schema.json@1.0.0",
    output_schema: "business-analysis-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "WORKFLOW-1",
    version: "1.0.0",
    name: "Submit expense report",
    state: "current",
    trigger: "An employee submits an expense report for reimbursement.",
    preconditions: ["The employee has an active account."],
    actors: [{ actor: "Employee", permissions: ["submit_expense"] }, { actor: "Manager", permissions: ["approve_expense"] }],
    activities: [
      { step: "1", description: "Employee fills out the expense report." },
      { step: "2", description: "Manager reviews the report." },
    ],
    decisions: [{ description: "Is the report within policy limits?", rule_ref: "rule:expense-policy-limit@1.0.0" }],
    data_consumed: ["expense-policy"],
    data_produced: ["expense-report-record"],
    transitions: [{ from_state: "submitted", to_state: "approved", trigger: "manager approval" }],
    alternate_paths: ["Manager requests additional receipts before approving."],
    failure_paths: ["Report is rejected for exceeding policy limits."],
    outcome: "The expense report is approved or rejected with a recorded reason.",
    evidence: ["interview:finance-team-2026-08-01"],
    traces_to: ["REQ-42@1.0.0"],
    ...overrides,
  };
}

function reviewRequest(workflow: Workflow = completeWorkflow()): BusinessAnalysisReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["business-analyst"],
      permissions: ["workflow:read", "knowledge:read", "assessment:create"],
      policy_version: "policy-3",
      request_id: "request-1",
      correlation_id: "correlation-1",
      audience: ["qa-intelligence"],
      environment: "test",
      issued_at: "2026-08-07T07:00:00.000Z",
      expires_at: "2026-08-07T09:00:00.000Z",
      issuer: "identity-test",
      integrity_proof: "signed-test-context",
    },
    workflow,
  };
}

function reviewer(): AssessBusinessAnalysisQuality {
  return new AssessBusinessAnalysisQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new BusinessAnalysisQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete workflow passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
  assert.equal(result.value.outcome, "completed");
});

test("a target-state workflow with no gap statement is rejected (critical, state_distinction category)", async () => {
  const result = await reviewer().review(
    reviewRequest(completeWorkflow({ state: "target" })),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a target-state workflow with a complete gap statement passes", async () => {
  const result = await reviewer().review(
    reviewRequest(
      completeWorkflow({
        state: "target",
        evidence: [],
        gap: {
          required_change: "Add automated policy-limit checks before manager review.",
          affected_owner: "Finance Engineering",
          assumptions: ["The policy service will be available."],
          validation: "A/B test with a pilot team before full rollout.",
        },
      }),
    ),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
});

test("a workflow with no actors (high, scope_and_actors) blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeWorkflow({ actors: [] })));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
  assert.equal(
    result.value.findings.some((finding) => finding.message === "The workflow has no actors or permissions recorded."),
    true,
  );
});

test("rejects an unauthorized review before discovery or rules run", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await new AssessBusinessAnalysisQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new BusinessAnalysisQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});

test("retains authorization, knowledge, and rule evidence in the assessment", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.ok(result.value.evidence.includes("policy:allow-business-analysis-assessment"));
  assert.ok(result.value.evidence.includes("WORKFLOW-1@1.0.0"));
});
