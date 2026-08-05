import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessRequirementQuality,
  type Clock,
  type IdFactory,
  type RequirementReviewConfiguration,
  type RequirementReviewRequest,
} from "../../src/requirement-review/assess-requirement-quality.js";
import { RequirementIntelligenceRuleEngine } from "../../src/requirement-intelligence/requirement-intelligence-rule-engine.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";

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
        effective_permissions: ["requirement:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "REQ-1@1.0.0"],
        decision_evidence: ["policy:allow-requirement-assessment"],
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

const configuration: RequirementReviewConfiguration = {
  resolved_versions: {
    agent: "requirement-review-agent@1.0.0",
    skill: "assess-requirement-quality@1.0.0",
    prompt: "requirement-assessment-prompt@1.0.0",
    rule_set: "requirement-intelligence@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "requirement.schema.json@1.0.0",
    output_schema: "requirement-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5, reasoning_tokens: 500, reasoning_cost: 1, reasoning_timeout_ms: 2_000 },
};

function reviewRequest(
  options: Readonly<{ includeRationale?: boolean }> = {},
): RequirementReviewRequest {
  const includeRationale = options.includeRationale ?? true;
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["requirement-reviewer"],
      permissions: ["requirement:read", "knowledge:read", "assessment:create"],
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
    requirement: {
      id: "REQ-1",
      version: "1.0.0",
      status: "in_review",
      title: "Export audit report",
      statement: "A reviewer can export an audit report.",
      source: ["product-brief@1.0.0"],
      owner: "Product",
      capability_id: "audit-reporting",
      scope: { workspace_id: "workspace-alpha" },
      ...(includeRationale ? { rationale: "Auditors need offline evidence of report access." } : {}),
      acceptance_criteria: [{ criterion: "Reviewer downloads a signed PDF within 5 seconds." }],
      traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    },
  };
}

test("Assess Requirement Quality plugs in the SPEC-202 rule engine and passes a complete requirement", async () => {
  const reviewer = new AssessRequirementQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new RequirementIntelligenceRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("a requirement missing rationale surfaces a completeness finding through the full Skill", async () => {
  const reviewer = new AssessRequirementQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new RequirementIntelligenceRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const result = await reviewer.review(reviewRequest({ includeRationale: false }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.notEqual(result.value.verdict, "pass");
  assert.equal(
    result.value.findings.some((finding) => finding.category === "completeness"),
    true,
  );
});
