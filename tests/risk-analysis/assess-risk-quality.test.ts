import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessRiskQuality,
  RiskQualityRuleEngine,
  type Clock,
  type IdFactory,
  type RiskReviewConfiguration,
  type RiskReviewRequest,
} from "../../src/risk-analysis/assess-risk-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { Risk } from "../../src/risk-analysis/public.js";

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
        effective_permissions: ["risk:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "RISK-1@1.0.0"],
        decision_evidence: ["policy:allow-risk-assessment"],
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

const configuration: RiskReviewConfiguration = {
  resolved_versions: {
    agent: "risk-analysis-agent@1.0.0",
    skill: "assess-risk-quality@1.0.0",
    rule_set: "risk-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "risk.schema.json@1.0.0",
    output_schema: "risk-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "RISK-1",
    version: "1.0.0",
    status: "draft",
    statement: {
      cause: "Rate limiting is not enforced on the login endpoint.",
      event: "An attacker submits high-volume credential-stuffing requests.",
      consequence: "Legitimate user accounts are locked out or compromised.",
    },
    category: "security_and_privacy",
    affected: { workspace_id: "workspace-alpha", capability_id: "authentication" },
    likelihood_rationale: "Public endpoint with no prior rate-limiting control.",
    impact_rationale: "Account lockout affects all active users of this Workspace.",
    evidence: ["incident-report:INC-042"],
    owner: "Security Engineering",
    controls: ["control:rate-limit-login@1.0.0"],
    residual_risk: "Low, once rate limiting is deployed and monitored.",
    ...overrides,
  };
}

function reviewRequest(risk: Risk = completeRisk()): RiskReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["risk-reviewer"],
      permissions: ["risk:read", "knowledge:read", "assessment:create"],
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
    risk,
  };
}

function reviewer(): AssessRiskQuality {
  return new AssessRiskQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new RiskQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete risk passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
  assert.equal(result.value.outcome, "completed");
});

test("a risk with no controls is blocked as rejected (critical, treatment_governance category)", async () => {
  const result = await reviewer().review(reviewRequest(completeRisk({ controls: [] })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a risk missing owner (high, completeness) blocks without a false rejected label", async () => {
  // An empty owner string is treated as missing by the rule engine's
  // non-empty check, same as an absent field.
  const result = await reviewer().review(reviewRequest(completeRisk({ owner: "" })));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
  assert.equal(
    result.value.findings.some((finding) => finding.message === "The risk has no accountable owner."),
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
  const result = await new AssessRiskQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new RiskQualityRuleEngine(),
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
  assert.ok(result.value.evidence.includes("policy:allow-risk-assessment"));
  assert.ok(result.value.evidence.includes("RISK-1@1.0.0"));
});
