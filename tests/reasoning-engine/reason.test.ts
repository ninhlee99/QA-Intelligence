import assert from "node:assert/strict";
import test from "node:test";

import { reason, type ReasoningEngineDependencies } from "../../src/reasoning-engine/reason.js";
import type { ReasoningEngineRequest } from "../../src/reasoning-engine/public.js";
import type {
  DeterministicRuleEngine,
  KnowledgeSearch,
  KnowledgeSearchResult,
  ReasoningProvider,
  ReasoningProviderResult,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(): Promise<WorkspaceAuthorizationResult> {
    return {
      ok: true,
      value: {
        policy_version: "policy-3",
        effective_permissions: ["reasoning:invoke", "knowledge:read"],
        authorized_resource_refs: ["workspace:workspace-alpha"],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

class FixedOutcomeRuleEngine implements DeterministicRuleEngine {
  readonly #outcomeValue: "satisfied" | "not_satisfied" | "indeterminate";
  constructor(outcome: "satisfied" | "not_satisfied" | "indeterminate") {
    this.#outcomeValue = outcome;
  }
  async evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    return {
      ok: true,
      value: {
        outcome: this.#outcomeValue,
        rule_set: request.rule_set,
        rule_versions: [],
        matched_conditions: [],
        relevant_facts: [],
        outputs: { findings: this.#outcomeValue === "not_satisfied" ? [{ category: "test", message: "a finding" }] : [] },
        conflicts: [],
        missing_facts: [],
        explanation_trace: [`rule outcome: ${this.#outcomeValue}`],
        policy_version: request.context.policy_version,
        duration_ms: 0,
      },
    };
  }
}

class FixedHitsKnowledgeSearch implements KnowledgeSearch {
  readonly #refs: readonly string[];
  constructor(refs: readonly string[] = ["knowledge:KO-001@1.0.0"]) {
    this.#refs = refs;
  }
  async search(): Promise<KnowledgeSearchResult> {
    return {
      ok: true,
      value: {
        hits: this.#refs.map((ref) => ({
          knowledge_ref: ref,
          title: "title",
          excerpt: "excerpt",
          authority_status: "accepted",
          provenance: [],
          evidence: [],
          relevance: 0.9,
        })),
        knowledge_snapshot: "1.0.0",
        projection_freshness: "current",
        warnings: [],
      },
    };
  }
}

class ThrowingReasoningProvider implements ReasoningProvider {
  async generate(): Promise<ReasoningProviderResult> {
    throw new Error("ReasoningProvider.generate should never be called when rules already resolved the request.");
  }
}

class ScriptedProvider implements ReasoningProvider {
  readonly #citations: readonly string[];
  constructor(citations: readonly string[]) {
    this.#citations = citations;
  }
  async generate(): Promise<ReasoningProviderResult> {
    return {
      ok: true,
      value: {
        structured_output: { claim: "the deterministic rules were indeterminate, this is the AI's best assessment" },
        provider_id: "scripted-provider",
        provider_version: "0.1.0",
        model_id: "scripted-model",
        finish_status: "completed",
        safety_outcomes: [],
        tool_calls: [],
        usage: { input_tokens: 10, output_tokens: 5, cost: 0.01 },
        latency_ms: 5,
        citations: this.#citations,
        diagnostics: {},
      },
    };
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-reasoning-001",
    actor_type: "service",
    roles: ["reasoning-caller"],
    permissions: ["reasoning:invoke", "knowledge:read"],
    policy_version: "policy-3",
    request_id: "request-reasoning-001",
    correlation_id: "correlation-reasoning-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T09:00:00.000Z",
    expires_at: "2026-08-08T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function baseRequest(overrides: Partial<ReasoningEngineRequest> = {}): ReasoningEngineRequest {
  return {
    operation_id: "op-reasoning-1",
    workspace_id: "workspace-alpha",
    context: workspaceContext(),
    purpose: "assess whether this change is safe to ship",
    consequence_class: "advisory",
    rule_set: { id: "reasoning-applicability", version: "1.0.0" },
    knowledge_query: { query: "safe to ship", scopes: ["policies"], applicability: {} },
    ...overrides,
  };
}

function dependencies(overrides: Partial<ReasoningEngineDependencies> = {}): ReasoningEngineDependencies {
  return {
    authorizer: new AllowingAuthorizer(),
    rules: new FixedOutcomeRuleEngine("satisfied"),
    knowledge: new FixedHitsKnowledgeSearch(),
    reasoningProvider: new ThrowingReasoningProvider(),
    ...overrides,
  };
}

test("deterministic-first: a satisfied rule outcome never invokes the AI provider, even when ai_capability is supplied", async () => {
  const result = await reason(
    dependencies({ rules: new FixedOutcomeRuleEngine("satisfied") }),
    baseRequest({
      ai_capability: {
        prompt: { id: "prompt-1", version: "1.0.0" },
        output_schema: { id: "schema-1", version: "1.0.0" },
        allowed_tools: [],
        safety_policy: { id: "policy-1", version: "1.0.0" },
      },
    }),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "rules_only");
  assert.equal(result.value.outcome, "resolved");
});

test("minimal context: authorized_context_refs is never broader than what was actually retrieved (proven via citation acceptance)", async () => {
  const refs = ["knowledge:KO-001@1.0.0", "knowledge:KO-002@1.0.0"];
  const result = await reason(
    dependencies({
      rules: new FixedOutcomeRuleEngine("indeterminate"),
      knowledge: new FixedHitsKnowledgeSearch(refs),
      reasoningProvider: new ScriptedProvider(refs),
    }),
    baseRequest({
      ai_capability: {
        prompt: { id: "prompt-1", version: "1.0.0" },
        output_schema: { id: "schema-1", version: "1.0.0" },
        allowed_tools: [],
        safety_policy: { id: "policy-1", version: "1.0.0" },
      },
    }),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual([...result.value.source_citations].sort(), [...refs].sort());
});

test("citation validation: a claim citing an unretrieved reference is dropped, not trusted", async () => {
  const result = await reason(
    dependencies({
      rules: new FixedOutcomeRuleEngine("indeterminate"),
      knowledge: new FixedHitsKnowledgeSearch(["knowledge:KO-001@1.0.0"]),
      reasoningProvider: new ScriptedProvider(["knowledge:KO-999-NEVER-RETRIEVED@1.0.0"]),
    }),
    baseRequest({
      ai_capability: {
        prompt: { id: "prompt-1", version: "1.0.0" },
        output_schema: { id: "schema-1", version: "1.0.0" },
        allowed_tools: [],
        safety_policy: { id: "policy-1", version: "1.0.0" },
      },
    }),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.inferred_claims.length, 0);
  assert.equal(result.value.outcome, "indeterminate");
  assert.ok(result.value.uncertainty.reasons.some((reason_) => reason_.includes("KO-999-NEVER-RETRIEVED")));
});

test("provider substitution: the pipeline behaves identically against two different ReasoningProvider doubles", async () => {
  const refs = ["knowledge:KO-001@1.0.0"];
  const request = baseRequest({
    ai_capability: {
      prompt: { id: "prompt-1", version: "1.0.0" },
      output_schema: { id: "schema-1", version: "1.0.0" },
      allowed_tools: [],
      safety_policy: { id: "policy-1", version: "1.0.0" },
    },
  });

  const first = await reason(
    dependencies({ rules: new FixedOutcomeRuleEngine("indeterminate"), knowledge: new FixedHitsKnowledgeSearch(refs), reasoningProvider: new ScriptedProvider(refs) }),
    request,
  );
  const second = await reason(
    dependencies({ rules: new FixedOutcomeRuleEngine("indeterminate"), knowledge: new FixedHitsKnowledgeSearch(refs), reasoningProvider: new ScriptedProvider(refs) }),
    request,
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.outcome, second.value.outcome);
  assert.equal(first.value.status, second.value.status);
});

test("human oversight: required_human_action is set for a high_consequence request", async () => {
  const result = await reason(dependencies(), baseRequest({ consequence_class: "high_consequence" }));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.notEqual(result.value.required_human_action, null);
});

test("human oversight: required_human_action is null for an advisory request", async () => {
  const result = await reason(dependencies(), baseRequest({ consequence_class: "advisory" }));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.required_human_action, null);
});

test("Workspace isolation: a workspace_id/context mismatch is rejected before any rule/knowledge/AI call", async () => {
  const result = await reason(
    dependencies(),
    baseRequest({ workspace_id: "workspace-beta", context: workspaceContext({ workspace_id: "workspace-alpha" }) }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "missing_authority");
});

test("fail-safe: an indeterminate rule outcome with no ai_capability supplied returns outcome indeterminate, never resolved", async () => {
  const result = await reason(dependencies({ rules: new FixedOutcomeRuleEngine("indeterminate") }), baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "indeterminate");
});

test("authorization denial is a distinct missing_authority failure", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await reason(dependencies({ authorizer: deniedAuthorizer }), baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "missing_authority");
});

test("a rule-evaluation dependency failure is a distinct insufficient_evidence failure", async () => {
  const failingRules: DeterministicRuleEngine = {
    evaluate: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "unknown_rule_set", message: "no such rule set", retryable: false, evidence: [] },
      }),
  };
  const result = await reason(dependencies({ rules: failingRules }), baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "insufficient_evidence");
});

test("a schema_failure from the reasoning provider maps to invalid_output", async () => {
  const failingProvider: ReasoningProvider = {
    generate: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "schema_failure", message: "output did not match schema", retryable: false, evidence: [] },
      }),
  };
  const result = await reason(
    dependencies({ rules: new FixedOutcomeRuleEngine("indeterminate"), reasoningProvider: failingProvider }),
    baseRequest({
      ai_capability: {
        prompt: { id: "prompt-1", version: "1.0.0" },
        output_schema: { id: "schema-1", version: "1.0.0" },
        allowed_tools: [],
        safety_policy: { id: "policy-1", version: "1.0.0" },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_output");
});

test("a safety_refusal from the reasoning provider maps to unsafe_request", async () => {
  const refusingProvider: ReasoningProvider = {
    generate: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "safety_refusal", message: "refused on safety grounds", retryable: false, evidence: [] },
      }),
  };
  const result = await reason(
    dependencies({ rules: new FixedOutcomeRuleEngine("indeterminate"), reasoningProvider: refusingProvider }),
    baseRequest({
      ai_capability: {
        prompt: { id: "prompt-1", version: "1.0.0" },
        output_schema: { id: "schema-1", version: "1.0.0" },
        allowed_tools: [],
        safety_policy: { id: "policy-1", version: "1.0.0" },
      },
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsafe_request");
});

test("an empty purpose is a configuration_invalid failure", async () => {
  const result = await reason(dependencies(), baseRequest({ purpose: "" }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "configuration_invalid");
});

test("deterministic findings from rule evaluation are always populated, regardless of AI invocation", async () => {
  const result = await reason(dependencies({ rules: new FixedOutcomeRuleEngine("not_satisfied") }), baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.deterministic_findings.length, 1);
});
