import assert from "node:assert/strict";
import test from "node:test";

import {
  ScriptedReasoningProvider,
  type ScriptedReasoningScript,
} from "../../src/adapters/replay/scripted-reasoning-provider.js";
import type {
  ReasoningRequest,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

const WORKSPACE_ID = "workspace-evaluation-001";
const LIMITS = {
  max_tokens: 100,
  max_cost: 0,
  timeout_ms: 5_000,
  max_retries: 0,
} as const;

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "reviewer-001",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["knowledge:read"],
    policy_version: "test-policy-0.1.0",
    request_id: "request-001",
    correlation_id: "correlation-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-03T07:00:00.000Z",
    expires_at: "2026-08-03T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "valid-test-signature",
  };
}

function request(
  purpose: string,
  overrides: Partial<ReasoningRequest> = {},
): ReasoningRequest {
  return {
    operation_id: `operation:${purpose}`,
    context: context(),
    purpose,
    consequence_class: "advisory",
    capability_constraints: ["Do not invent business intent."],
    prompt: { id: "PROMPT-requirement-review", version: "1.0.0" },
    authorized_context_refs: ["REQ-001@1.0.0"],
    output_schema: { id: "requirement-assessment", version: "1.0.0" },
    allowed_tools: [],
    limits: LIMITS,
    safety_policy: { id: "POLICY-reasoning", version: "1.0.0" },
    ...overrides,
  };
}

function script(
  caseId: string,
  purpose: string,
  outcome: ScriptedReasoningScript["outcome"],
  overrides: Partial<ScriptedReasoningScript["match"]> = {},
): ScriptedReasoningScript {
  const expectedRequest = request(purpose);
  return {
    case_id: caseId,
    match: {
      operation_id: expectedRequest.operation_id,
      context: expectedRequest.context,
      purpose,
      workspace_id: WORKSPACE_ID,
      actor_id: expectedRequest.context.actor_id,
      policy_version: expectedRequest.context.policy_version,
      consequence_class: expectedRequest.consequence_class,
      capability_constraints: expectedRequest.capability_constraints,
      prompt: expectedRequest.prompt,
      authorized_context_refs: expectedRequest.authorized_context_refs,
      output_schema: expectedRequest.output_schema,
      allowed_tools: [],
      limits: LIMITS,
      safety_policy: expectedRequest.safety_policy,
      ...overrides,
    },
    provider: {
      provider_id: "scripted-replay",
      provider_version: "1.0.0",
      model_id: "scripted-model-001",
    },
    outcome,
  };
}

test("normalizes the completed structured-output fixture and retains provenance", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-completed-structured-output", "completed", {
      kind: "completed",
      structured_output: {
        claims: [],
        uncertainty: "insufficient evidence for business intent",
        required_human_action: "clarify the observable outcome",
      },
      usage: { input_tokens: 60, output_tokens: 40, cost: 0 },
      latency_ms: 12,
      citations: ["REQ-001@1.0.0"],
      safety_outcomes: ["allowed"],
      tool_calls: [],
      diagnostics: { fixture: "reasoning-script.json" },
    }),
  ]);

  const result = await provider.generate(request("completed"));

  assert.deepEqual(result, {
    ok: true,
    value: {
      structured_output: {
        claims: [],
        uncertainty: "insufficient evidence for business intent",
        required_human_action: "clarify the observable outcome",
      },
      provider_id: "scripted-replay",
      provider_version: "1.0.0",
      model_id: "scripted-model-001",
      finish_status: "completed",
      safety_outcomes: ["allowed"],
      tool_calls: [],
      usage: { input_tokens: 60, output_tokens: 40, cost: 0 },
      latency_ms: 12,
      citations: ["REQ-001@1.0.0"],
      diagnostics: {
        fixture: "reasoning-script.json",
        replay_case_id: "reasoning-completed-structured-output",
        authority_widening: false,
      },
    },
  });
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(provider.unusedScripts, []);
});

test("normalizes the safety-refusal fixture as a non-retryable refusal", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-safety-refusal", "refusal", {
      kind: "safety_refusal",
      message: "The provider refused the request under its safety policy.",
      evidence: ["provider-safety:refused"],
    }),
  ]);

  const result = await provider.generate(request("refusal"));

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "safety_refusal",
      message: "The provider refused the request under its safety policy.",
      retryable: false,
      provider_id: "scripted-replay",
      evidence: [
        "provider-safety:refused",
        "scripted-reasoning:case:reasoning-safety-refusal",
        "provider:scripted-replay@1.0.0",
        "model:scripted-model-001",
        "authority-widening:false",
      ],
    },
  });
});

test("normalizes the provider-timeout fixture as retryable timeout evidence", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-provider-timeout", "timeout", {
      kind: "timeout",
      message: "The provider exceeded the bounded request deadline.",
      elapsed_ms: 5_000,
      evidence: ["deadline-ms:5000"],
    }),
  ]);

  const result = await provider.generate(request("timeout"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "timeout");
    assert.equal(result.failure.retryable, true);
    assert.deepEqual(result.failure.evidence, [
      "deadline-ms:5000",
      "elapsed-ms:5000",
      "scripted-reasoning:case:reasoning-provider-timeout",
      "provider:scripted-replay@1.0.0",
      "model:scripted-model-001",
      "authority-widening:false",
    ]);
  }
});

test("normalizes the invalid-output fixture to schema_failure without returning the payload", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-invalid-structured-output", "invalid-output", {
      kind: "invalid_output",
      message: "Provider output did not satisfy requirement-assessment@1.0.0.",
      schema: { id: "requirement-assessment", version: "1.0.0" },
      evidence: ["schema-validation:failed"],
    }),
  ]);

  const result = await provider.generate(request("invalid-output"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "schema_failure");
    assert.equal(result.failure.retryable, false);
    assert.ok(result.failure.evidence.includes("schema:requirement-assessment@1.0.0"));
    assert.equal(JSON.stringify(result).includes("unexpected_field"), false);
  }
});

test("blocks the prompt-injection fixture without widening Workspace or Tool authority", async () => {
  const allowedTools = [{ id: "knowledge.search", version: "1.0.0" }] as const;
  const provider = new ScriptedReasoningProvider([
    script(
      "reasoning-prompt-injection-attempt",
      "injection",
      {
        kind: "prompt_injection",
        message: "Provider output requested Tool authority outside the authorized set.",
        requested_tools: [{ id: "workspace.cross_read", version: "1.0.0" }],
        evidence: ["prompt-injection:blocked"],
      },
      { allowed_tools: allowedTools },
    ),
  ]);

  const result = await provider.generate(
    request("injection", { allowed_tools: allowedTools }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "tool_denied");
    assert.equal(result.failure.retryable, false);
    assert.ok(result.failure.evidence.includes("workspace:workspace-evaluation-001"));
    assert.ok(result.failure.evidence.includes("allowed-tools:knowledge.search@1.0.0"));
    assert.ok(result.failure.evidence.includes("requested-tools:workspace.cross_read@1.0.0"));
    assert.ok(result.failure.evidence.includes("authority-widening:false"));
  }
});

test("normalizes the usage-limit fixture and retains the measured usage", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-usage-limit", "usage-limit", {
      kind: "usage_limit",
      message: "The configured token budget was exhausted.",
      usage: { input_tokens: 80, output_tokens: 20, cost: 0 },
      evidence: ["budget:max-tokens:100"],
    }),
  ]);

  const result = await provider.generate(request("usage-limit"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "usage_limit");
    assert.equal(result.failure.retryable, false);
    assert.ok(result.failure.evidence.includes("usage:input-tokens:80"));
    assert.ok(result.failure.evidence.includes("usage:output-tokens:20"));
    assert.ok(result.failure.evidence.includes("usage:cost:0"));
  }
});

test("normalizes the cancellation fixture as a non-retryable cancelled request", async () => {
  const provider = new ScriptedReasoningProvider([
    script("reasoning-cancellation", "cancellation", {
      kind: "cancelled",
      message: "The reasoning request was cancelled.",
      evidence: ["cancellation:requested"],
    }),
  ]);

  const result = await provider.generate(request("cancellation"));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "cancelled");
    assert.equal(result.failure.retryable, false);
    assert.ok(result.failure.evidence.includes("cancellation:requested"));
    assert.ok(result.failure.evidence.includes("authority-widening:false"));
  }
});

test("enforces exact ordered matching and never falls back past a mismatched script", async () => {
  const allowedTool = [{ id: "knowledge.search", version: "1.0.0" }] as const;
  const provider = new ScriptedReasoningProvider([
    script(
      "sequence-first",
      "first",
      {
        kind: "safety_refusal",
        message: "first response",
        evidence: [],
      },
      { allowed_tools: allowedTool },
    ),
    script("sequence-second", "second", {
      kind: "cancelled",
      message: "second response",
      evidence: [],
    }),
  ]);

  const outOfOrder = await provider.generate(request("second"));
  assert.deepEqual(outOfOrder, {
    ok: false,
    failure: {
      code: "provider_error",
      message: "The request did not match the next scripted reasoning response.",
      retryable: false,
      provider_id: "scripted-replay",
      evidence: [
        "scripted-reasoning:request-mismatch",
        "expected-case:sequence-first",
        "call-index:0",
      ],
    },
  });
  assert.equal(provider.unusedScripts.length, 2);

  const wrongWorkspace = await provider.generate(
    request("first", {
      context: { ...context(), workspace_id: "workspace-other" },
      allowed_tools: allowedTool,
    }),
  );
  const wrongToolVersion = await provider.generate(
    request("first", {
      allowed_tools: [{ id: "knowledge.search", version: "2.0.0" }],
    }),
  );
  const wrongBudget = await provider.generate(
    request("first", {
      allowed_tools: allowedTool,
      limits: { ...LIMITS, max_tokens: 101 },
    }),
  );

  for (const mismatch of [wrongWorkspace, wrongToolVersion, wrongBudget]) {
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.equal(mismatch.failure.code, "provider_error");
    }
  }
  assert.equal(provider.unusedScripts.length, 2);

  const first = await provider.generate(
    request("first", { allowed_tools: allowedTool }),
  );
  const second = await provider.generate(request("second"));
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (!first.ok && !second.ok) {
    assert.equal(first.failure.code, "safety_refusal");
    assert.equal(second.failure.code, "cancelled");
  }
  assert.deepEqual(provider.unusedScripts, []);

  const unexpected = await provider.generate(request("third"));
  assert.deepEqual(unexpected, {
    ok: false,
    failure: {
      code: "provider_error",
      message: "No scripted reasoning response remains for this request.",
      retryable: false,
      provider_id: "scripted-replay",
      evidence: ["scripted-reasoning:unexpected-request", "call-index:6"],
    },
  });
  assert.deepEqual(
    provider.calls.map((call) => call.purpose),
    ["second", "first", "first", "first", "first", "second", "third"],
  );
});
