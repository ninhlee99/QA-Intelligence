import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
  type Clock,
  type IdFactory,
  type RequirementReviewConfiguration,
} from "../../src/requirement-review/assess-requirement-quality.js";
import {
  RequirementQualitySkill,
  requirementSkillInvocation,
} from "../../src/adapters/replay/skill-invocation-adapter.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  Requirement,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import type { SkillInvocation, SkillTaskContext } from "../../src/skills/public.js";
import { runSkillContract } from "./skill-contract.js";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-06T09:00:00.000Z");
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
  authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["policy:allow-requirement-assessment"],
      },
    });
  }
}

class StubKnowledgeSearch implements KnowledgeSearch {
  search(): Promise<KnowledgeSearchResult> {
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

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-skill-001",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["requirement:read", "knowledge:read", "assessment:create"],
    policy_version: "policy-3",
    request_id: "request-skill-1",
    correlation_id: "correlation-skill-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-test-context",
    ...overrides,
  };
}

function completeRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: "REQ-SKILL-1",
    version: "1.0.0",
    status: "draft",
    title: "Export audit report",
    statement: "A reviewer can export an audit report.",
    source: ["product-brief@1.0.0"],
    owner: "Product",
    capability_id: "audit-reporting",
    scope: {},
    acceptance_criteria: [{ criterion: "Reviewer downloads a signed PDF within 5 seconds." }],
    traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    ...overrides,
  };
}

function makeSkill(): RequirementQualitySkill {
  const reviewer = new AssessRequirementQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new StubKnowledgeSearch(),
    rules: new RequirementQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
  return new RequirementQualitySkill(reviewer);
}

function taskContext(requirement: Requirement | undefined): SkillTaskContext {
  return {
    workspace: workspaceContext(),
    purpose: "assess requirement quality",
    facts: requirement === undefined ? {} : { requirement },
  };
}

function validInvocation(): SkillInvocation {
  return requirementSkillInvocation({
    workspace: workspaceContext(),
    input: { requirement: completeRequirement() },
  });
}

runSkillContract("assess-requirement-quality", {
  makeSkill,
  positiveTaskContext: () => taskContext(completeRequirement()),
  negativeTaskContext: () => taskContext(undefined),
  validInvocation,
  invocationMissingPermission: () =>
    requirementSkillInvocation({
      workspace: workspaceContext({ permissions: [] }),
      input: { requirement: completeRequirement() },
    }),
  invocationWithInvalidInput: () =>
    requirementSkillInvocation({
      workspace: workspaceContext(),
      input: { not_a_requirement: true },
    }),
  // assessment_id is a freshly minted identity per call (SequenceIds), not
  // part of the decision — the decision is verdict + findings.
  decisionFingerprint: (output) => ({ verdict: output["verdict"], findings: output["findings"] }),
});

test("invoking a real Skill through the Skill Contract reaches AssessRequirementQuality's actual verdict", async () => {
  const skill = makeSkill();
  const result = await skill.invoke(validInvocation());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.output["verdict"], "pass");
});

test("a requirement with a material quality gap surfaces as a real, non-fabricated verdict", async () => {
  const skill = makeSkill();
  const invocation = requirementSkillInvocation({
    workspace: workspaceContext(),
    input: { requirement: completeRequirement({ acceptance_criteria: [] }) },
  });

  const result = await skill.invoke(invocation);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.output["verdict"], "changes_required");
});

test("descriptor reports the exact permissions AssessRequirementQuality actually requires", async () => {
  const skill = makeSkill();
  const descriptor = await skill.describe(RequirementQualitySkill.SKILL_ID, RequirementQualitySkill.SKILL_VERSION);

  assert.notEqual(descriptor, undefined);
  assert.deepEqual(
    [...(descriptor?.required_permissions ?? [])].sort(),
    ["assessment:create", "knowledge:read", "requirement:read"],
  );
});
