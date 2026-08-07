import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
  type Clock,
  type IdFactory,
  type RequirementReviewConfiguration,
  type RequirementReviewRequest,
} from "../../src/requirement-review/assess-requirement-quality.js";
import { WorkingMemoryKnowledgeSearch } from "../../src/memory/working-memory.js";
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

class CountingKnowledgeSearch implements KnowledgeSearch {
  calls = 0;
  search(): Promise<KnowledgeSearchResult> {
    this.calls += 1;
    return Promise.resolve({
      ok: true,
      value: {
        hits: [
          {
            knowledge_ref: "KO-observable@1.0.0",
            title: "Observable outcomes",
            excerpt: "A testable requirement has observable acceptance criteria.",
            authority_status: "accepted",
            provenance: ["SPEC-203"],
            evidence: ["knowledge-evidence:KO-observable@1.0.0"],
            relevance: 0.9,
          },
        ],
        knowledge_snapshot: "7.0.0",
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
    rule_set: "requirement-quality@1.0.0",
    knowledge_snapshot: "7.0.0",
    policy: "policy@3.0.0",
    input_schema: "requirement.schema.json@1.0.0",
    output_schema: "requirement-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5, reasoning_tokens: 500, reasoning_cost: 1, reasoning_timeout_ms: 2_000 },
};

function reviewRequest(operationId: string): RequirementReviewRequest {
  return {
    operation_id: operationId,
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["requirement-reviewer"],
      permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      policy_version: "policy-3",
      request_id: `request-${operationId}`,
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
      acceptance_criteria: [{ criterion: "Reviewer downloads a signed PDF within 5 seconds." }],
      traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    },
  };
}

test("AssessRequirementQuality reuses Working Memory across repeated calls in the same run (AP-064)", async () => {
  const counting = new CountingKnowledgeSearch();
  const workingMemory = new WorkingMemoryKnowledgeSearch(counting);
  const reviewer = new AssessRequirementQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: workingMemory,
    rules: new RequirementQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const first = await reviewer.review(reviewRequest("operation-1"));
  const second = await reviewer.review(reviewRequest("operation-2"));

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(
    counting.calls,
    1,
    "a second review of the same requirement, scope, and knowledge snapshot should reuse Working Memory instead of re-querying",
  );
  assert.deepEqual(workingMemory.reuseStats(), { hits: 1, misses: 1 });
});

test("a different requirement re-queries because its durable reference (query text) changed", async () => {
  const counting = new CountingKnowledgeSearch();
  const workingMemory = new WorkingMemoryKnowledgeSearch(counting);
  const reviewer = new AssessRequirementQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: workingMemory,
    rules: new RequirementQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const first = await reviewer.review(reviewRequest("operation-1"));
  const otherRequirement = reviewRequest("operation-2");
  const second = await reviewer.review({
    ...otherRequirement,
    requirement: {
      ...otherRequirement.requirement,
      id: "REQ-2",
      title: "Import audit report",
      statement: "A reviewer can import an audit report.",
    },
  });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(counting.calls, 2, "a different requirement changes the query and must re-resolve");
});
