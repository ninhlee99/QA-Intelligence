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
import type {
  DeterministicRuleEngine,
  KnowledgeSearch,
  KnowledgeSearchResult,
  ReasoningProvider,
  ReasoningProviderResult,
  RuleEvaluationResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";

const callOrder: string[] = [];

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-03T08:00:00.000Z");
  }
}

class SequenceIds implements IdFactory {
  #next = 0;

  next(scope: "assessment" | "finding"): string {
    this.#next += 1;
    return `${scope}-${this.#next}`;
  }
}

class AuthorizerStub implements WorkspaceAuthorizer {
  constructor(private readonly result: WorkspaceAuthorizationResult) {}

  authorize(): Promise<WorkspaceAuthorizationResult> {
    callOrder.push("authorize");
    return Promise.resolve(this.result);
  }
}

class KnowledgeStub implements KnowledgeSearch {
  calls = 0;

  constructor(
    private readonly result: KnowledgeSearchResult = {
      ok: true,
      value: {
        hits: [],
        knowledge_snapshot: "7.0.0",
        projection_freshness: "current",
        warnings: [],
      },
    },
  ) {}

  search(): Promise<KnowledgeSearchResult> {
    this.calls += 1;
    callOrder.push("knowledge");
    return Promise.resolve(this.result);
  }
}

class RuleStub implements DeterministicRuleEngine {
  calls = 0;

  constructor(private readonly result: RuleEvaluationResult) {}

  evaluate(): Promise<RuleEvaluationResult> {
    this.calls += 1;
    callOrder.push("rules");
    return Promise.resolve(this.result);
  }
}

class ReasoningStub implements ReasoningProvider {
  calls = 0;

  constructor(private readonly result: ReasoningProviderResult) {}

  generate(): Promise<ReasoningProviderResult> {
    this.calls += 1;
    callOrder.push("reasoning");
    return Promise.resolve(this.result);
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

function reviewRequest(workspaceId = "workspace-alpha"): RequirementReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: workspaceId,
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
      issued_at: "2026-08-03T07:00:00.000Z",
      expires_at: "2026-08-03T09:00:00.000Z",
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
      acceptance_criteria: [],
      traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    },
  };
}

function authorized(): WorkspaceAuthorizationResult {
  return {
    ok: true,
    value: {
      policy_version: "policy-3",
      effective_permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      authorized_resource_refs: ["workspace:workspace-alpha", "REQ-1@1.0.0"],
      decision_evidence: ["policy:allow-requirement-assessment"],
    },
  };
}

function satisfiedRuleResult(): RuleEvaluationResult {
  return {
    ok: true,
    value: {
      outcome: "satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-has-acceptance-criteria", version: "1.0.0" }],
      matched_conditions: [],
      relevant_facts: ["REQ-1@1.0.0"],
      outputs: { findings: [] },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["all deterministic rules satisfied"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  };
}

function materialFindingRuleResult(): RuleEvaluationResult {
  return {
    ok: true,
    value: {
      outcome: "not_satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-has-acceptance-criteria", version: "1.0.0" }],
      matched_conditions: ["acceptance_criteria is empty"],
      relevant_facts: ["REQ-1@1.0.0#acceptance_criteria"],
      outputs: {
        findings: [
          {
            category: "missing_acceptance_criterion",
            severity: "high",
            message: "The requirement has no observable acceptance criterion.",
            evidence: ["REQ-1@1.0.0#acceptance_criteria"],
            next_action: "Define an observable and verifiable acceptance criterion.",
          },
        ],
      },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["deterministic acceptance-criteria rule failed"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  };
}

function indeterminateRuleResult(): RuleEvaluationResult {
  return {
    ok: true,
    value: {
      outcome: "indeterminate",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-observable-outcome", version: "1.0.0" }],
      matched_conditions: ["semantic intent is unresolved"],
      relevant_facts: ["REQ-1@1.0.0#statement"],
      outputs: { findings: [] },
      conflicts: [],
      missing_facts: ["authoritative observable success state"],
      explanation_trace: ["deterministic evidence cannot resolve business intent"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  };
}

function completedReasoning(): ReasoningProviderResult {
  return {
    ok: true,
    value: {
      structured_output: { question: "Which observable result proves success?", uncertainty: "Business intent is not evidenced." },
      provider_id: "scripted",
      provider_version: "1.0.0",
      model_id: "script-1",
      finish_status: "completed",
      safety_outcomes: [],
      tool_calls: [],
      usage: { input_tokens: 10, output_tokens: 10, cost: 0 },
      latency_ms: 1,
      citations: ["REQ-1@1.0.0"],
      diagnostics: {},
    },
  };
}

function createReviewer(
  authorization: WorkspaceAuthorizationResult,
  rules: DeterministicRuleEngine = new RequirementQualityRuleEngine(),
  reasoning: ReasoningProvider = new ReasoningStub(completedReasoning()),
  selectedConfiguration: RequirementReviewConfiguration = configuration,
): { reviewer: AssessRequirementQuality; knowledge: KnowledgeStub; reasoning: ReasoningProvider } {
  const knowledge = new KnowledgeStub();
  return {
    reviewer: new AssessRequirementQuality({
      authorizer: new AuthorizerStub(authorization),
      knowledge,
      rules,
      reasoning,
      clock: new FixedClock(),
      ids: new SequenceIds(),
      configuration: selectedConfiguration,
    }),
    knowledge,
    reasoning,
  };
}

test("rejects unresolved configuration before authorization or execution", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(satisfiedRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const { reviewer, knowledge } = createReviewer(
    authorized(),
    rules,
    reasoning,
    {
      ...configuration,
      resolved_versions: {
        ...configuration.resolved_versions,
        policy: "latest",
      },
    },
  );

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, false);
  assert.deepEqual(callOrder, []);
  assert.equal(knowledge.calls, 0);
  assert.equal(rules.calls, 0);
  assert.equal(reasoning.calls, 0);
  if (!result.ok) {
    assert.equal(result.failure.class, "configuration");
    assert.equal(result.failure.code, "invalid_resolved_versions");
  }
});

test("blocks an unauthorized review before discovery or assessment", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(satisfiedRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const { reviewer, knowledge } = createReviewer(
    {
      ok: false,
      failure: {
        code: "insufficient_permission",
        message: "assessment:create is required",
        retryable: false,
        evidence: ["policy:deny-missing-permission"],
      },
    },
    rules,
    reasoning,
  );

  const result = await reviewer.review(reviewRequest());

  assert.deepEqual(callOrder, ["authorize"]);
  assert.equal(knowledge.calls, 0);
  assert.equal(rules.calls, 0);
  assert.equal(reasoning.calls, 0);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.failure, {
      class: "authorization",
      code: "insufficient_permission",
      outcome: "blocked",
      message: "assessment:create is required",
      retryable: false,
      evidence: ["policy:deny-missing-permission"],
    });
  }
});

test("blocks a cross-Workspace review after authorization and makes zero downstream calls", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(satisfiedRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const { reviewer, knowledge } = createReviewer(authorized(), rules, reasoning);

  const result = await reviewer.review(reviewRequest("workspace-beta"));

  assert.deepEqual(callOrder, ["authorize"]);
  assert.equal(knowledge.calls, 0);
  assert.equal(rules.calls, 0);
  assert.equal(reasoning.calls, 0);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.class, "authorization");
    assert.equal(result.failure.code, "workspace_scope_mismatch");
    assert.equal(result.failure.outcome, "blocked");
    assert.ok(result.failure.evidence.includes("context-workspace:workspace-alpha"));
    assert.ok(result.failure.evidence.includes("requested-workspace:workspace-beta"));
  }
});

test("returns an evidenced changes-required assessment from deterministic rules without reasoning", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(materialFindingRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const { reviewer } = createReviewer(authorized(), rules, reasoning);

  const result = await reviewer.review(reviewRequest());

  assert.deepEqual(callOrder, ["authorize", "knowledge", "rules"]);
  assert.equal(reasoning.calls, 0);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.outcome, "completed");
    assert.equal(result.value.verdict, "changes_required");
    assert.equal(result.value.findings.length, 1);
    const finding = result.value.findings[0];
    assert.ok(finding);
    assert.equal(finding.category, "missing_acceptance_criterion");
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.evidence.includes("REQ-1@1.0.0#acceptance_criteria"));
    assert.ok(finding.next_action.length > 0);
    assert.deepEqual(Object.keys(result.value.resolved_versions).sort(), [
      "agent",
      "input_schema",
      "knowledge_snapshot",
      "output_schema",
      "policy",
      "prompt",
      "rule_set",
      "skill",
    ]);
    assert.deepEqual(result.value.resolved_versions, configuration.resolved_versions);
  }
});

test("never converts a deterministic rule error or non-applicable outcome into a pass", async () => {
  for (const outcome of ["error", "not_applicable"] as const) {
    callOrder.length = 0;
    const baseline = satisfiedRuleResult();
    assert.ok(baseline.ok);
    const rules = new RuleStub({
      ok: true,
      value: { ...baseline.value, outcome },
    });
    const reasoning = new ReasoningStub(completedReasoning());
    const { reviewer } = createReviewer(authorized(), rules, reasoning);

    const result = await reviewer.review(reviewRequest());

    assert.equal(result.ok, false);
    assert.equal(reasoning.calls, 0);
    if (!result.ok) {
      assert.equal(result.failure.class, "rule");
      assert.equal(result.failure.code, `rule_outcome_${outcome}`);
      assert.equal(result.failure.outcome, "indeterminate");
    }
  }
});

test("rejects a Rule Engine response with a mismatched Rule Set or policy version", async () => {
  const baseline = satisfiedRuleResult();
  assert.ok(baseline.ok);
  for (const value of [
    { ...baseline.value, rule_set: { id: "other-rules", version: "1.0.0" } },
    { ...baseline.value, policy_version: "other-policy" },
    {
      ...baseline.value,
      rule_versions: [{ id: "requirement-quality-rule", version: "latest" }],
    },
  ]) {
    callOrder.length = 0;
    const reasoning = new ReasoningStub(completedReasoning());
    const { reviewer } = createReviewer(
      authorized(),
      new RuleStub({ ok: true, value }),
      reasoning,
    );

    const result = await reviewer.review(reviewRequest());

    assert.equal(result.ok, false);
    assert.equal(reasoning.calls, 0);
    if (!result.ok) {
      assert.equal(result.failure.class, "rule");
      assert.equal(result.failure.code, "incompatible_version");
      assert.equal(result.failure.outcome, "indeterminate");
    }
  }
});

test("uses bounded reasoning only after Discovery and an indeterminate rule result", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(indeterminateRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const { reviewer } = createReviewer(authorized(), rules, reasoning);

  const result = await reviewer.review(reviewRequest());

  assert.deepEqual(callOrder, ["authorize", "knowledge", "rules", "reasoning"]);
  assert.equal(reasoning.calls, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.outcome, "indeterminate");
    assert.equal(result.value.verdict, "changes_required");
    assert.equal(result.value.uncertainty.level, "high");
    assert.ok(result.value.uncertainty.reasons.includes("Business intent is not evidenced."));
    assert.ok(result.value.questions.includes("Which observable result proves success?"));
    assert.ok(
      result.value.questions.includes(
        "Which authoritative evidence resolves authoritative observable success state?",
      ),
    );
    assert.deepEqual(result.value.findings, []);
  }
});

test("attributes a reasoning-provider failure separately from requirement quality", async () => {
  callOrder.length = 0;
  const rules = new RuleStub(indeterminateRuleResult());
  const reasoning = new ReasoningStub({
    ok: false,
    failure: {
      code: "provider_unavailable",
      message: "scripted provider is unavailable",
      retryable: true,
      provider_id: "scripted",
      evidence: ["provider:scripted:unavailable"],
    },
  });
  const { reviewer } = createReviewer(authorized(), rules, reasoning);

  const result = await reviewer.review(reviewRequest());

  assert.deepEqual(callOrder, ["authorize", "knowledge", "rules", "reasoning"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.class, "provider");
    assert.equal(result.failure.code, "provider_unavailable");
    assert.equal(result.failure.outcome, "indeterminate");
    assert.ok(result.failure.evidence.includes("provider:scripted:unavailable"));
    assert.equal("findings" in result.failure, false);
  }
});

test("retains authorization, governed knowledge, rule and provider evidence", async () => {
  callOrder.length = 0;
  const knowledge = new KnowledgeStub({
    ok: true,
    value: {
      hits: [
        {
          knowledge_ref: "KO-observable-outcome@2.0.0",
          title: "Observable outcomes",
          excerpt: "A testable requirement defines an observable outcome.",
          authority_status: "accepted",
          provenance: ["SPEC-203"],
          evidence: ["knowledge-evidence:KO-observable-outcome@2.0.0"],
          relevance: 1,
        },
      ],
      knowledge_snapshot: "7.0.0",
      projection_freshness: "current",
      warnings: [],
    },
  });
  const rules = new RuleStub(indeterminateRuleResult());
  const reasoning = new ReasoningStub(completedReasoning());
  const reviewer = new AssessRequirementQuality({
    authorizer: new AuthorizerStub(authorized()),
    knowledge,
    rules,
    reasoning,
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.value.evidence.includes("policy:allow-requirement-assessment"));
    assert.ok(result.value.evidence.includes("KO-observable-outcome@2.0.0"));
    assert.ok(result.value.evidence.includes("knowledge-evidence:KO-observable-outcome@2.0.0"));
    assert.ok(result.value.evidence.includes("rule:requirement-observable-outcome@1.0.0"));
    assert.ok(result.value.evidence.includes("provider:scripted@1.0.0"));
    assert.ok(result.value.evidence.includes("REQ-1@1.0.0"));
  }
});

test("a critical finding always rejects, even when the rule outcome itself reports satisfied (SPEC-203 §7/§9)", async () => {
  const rules = new RuleStub({
    ok: true,
    value: {
      outcome: "satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-cross-workspace-safety", version: "1.0.0" }],
      matched_conditions: ["requirement references another Workspace's data"],
      relevant_facts: ["REQ-1@1.0.0#scope"],
      outputs: {
        findings: [
          {
            category: "workspace_safety",
            severity: "critical",
            message: "The requirement references data outside its own Workspace.",
            evidence: ["REQ-1@1.0.0#scope"],
            next_action: "Remove the cross-Workspace reference before this requirement can be accepted.",
          },
        ],
      },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["deterministic Workspace-safety rule matched"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  });
  const { reviewer } = createReviewer(authorized(), rules);

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.verdict, "rejected");
    assert.equal(
      result.value.findings.some((finding) => finding.severity === "critical"),
      true,
    );
  }
});

test("a critical finding rejects even alongside other lower-severity findings, not just when it stands alone", async () => {
  const rules = new RuleStub({
    ok: true,
    value: {
      outcome: "not_satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-has-acceptance-criteria", version: "1.0.0" }],
      matched_conditions: ["acceptance_criteria is empty", "requirement references another Workspace's data"],
      relevant_facts: ["REQ-1@1.0.0#acceptance_criteria"],
      outputs: {
        findings: [
          {
            category: "missing_acceptance_criterion",
            severity: "high",
            message: "The requirement has no observable acceptance criterion.",
            evidence: ["REQ-1@1.0.0#acceptance_criteria"],
            next_action: "Define an observable and verifiable acceptance criterion.",
          },
          {
            category: "workspace_safety",
            severity: "critical",
            message: "The requirement references data outside its own Workspace.",
            evidence: ["REQ-1@1.0.0#scope"],
            next_action: "Remove the cross-Workspace reference before this requirement can be accepted.",
          },
        ],
      },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["deterministic rules failed"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  });
  const { reviewer } = createReviewer(authorized(), rules);

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.verdict, "rejected");
  }
});

test("a critical finding whose category is not conflict/unsafe blocks rather than being mislabeled rejected (SPEC-203 §7)", async () => {
  const rules = new RuleStub({
    ok: true,
    value: {
      outcome: "satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-testability", version: "1.0.0" }],
      matched_conditions: ["acceptance criteria cannot be objectively verified"],
      relevant_facts: ["REQ-1@1.0.0#acceptance_criteria"],
      outputs: {
        findings: [
          {
            category: "testability",
            severity: "critical",
            message: "No acceptance criterion in this requirement is objectively verifiable.",
            evidence: ["REQ-1@1.0.0#acceptance_criteria"],
            next_action: "Rewrite acceptance criteria as observable, verifiable statements.",
          },
        ],
      },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["deterministic testability rule matched"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  });
  const { reviewer } = createReviewer(authorized(), rules);

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.value.verdict, "blocked");
  }
});

test("a mix of a safety-category critical finding and a non-safety critical finding still rejects (safety wins)", async () => {
  const rules = new RuleStub({
    ok: true,
    value: {
      outcome: "satisfied",
      rule_set: { id: "requirement-quality", version: "1.0.0" },
      rule_versions: [{ id: "requirement-mixed-critical", version: "1.0.0" }],
      matched_conditions: ["mixed critical findings"],
      relevant_facts: ["REQ-1@1.0.0"],
      outputs: {
        findings: [
          {
            category: "testability",
            severity: "critical",
            message: "No acceptance criterion in this requirement is objectively verifiable.",
            evidence: ["REQ-1@1.0.0#acceptance_criteria"],
            next_action: "Rewrite acceptance criteria as observable, verifiable statements.",
          },
          {
            category: "security_and_privacy",
            severity: "critical",
            message: "The requirement exposes credentials in plain text.",
            evidence: ["REQ-1@1.0.0#statement"],
            next_action: "Remove the credential exposure before this requirement can be accepted.",
          },
        ],
      },
      conflicts: [],
      missing_facts: [],
      explanation_trace: ["deterministic rules matched"],
      policy_version: "policy-3",
      duration_ms: 0,
    },
  });
  const { reviewer } = createReviewer(authorized(), rules);

  const result = await reviewer.review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.value.verdict, "rejected");
  }
});
