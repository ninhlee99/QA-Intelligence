import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicTool, type ScriptedToolScenario } from "../../src/adapters/replay/deterministic-tool.js";
import type { ToolCall, ToolDescriptor } from "../../src/tools/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { runToolContract } from "./tool-contract.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-tool-001",
    actor_id: "actor-tool-001",
    actor_type: "service",
    roles: ["tool-caller"],
    permissions: ["tool:invoke"],
    policy_version: "policy@1.0.0",
    request_id: "request-tool-001",
    correlation_id: "correlation-tool-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

const DESCRIPTOR: ToolDescriptor = {
  tool: { id: "example-tool", version: "1.0.0" },
  contract_versions: { input_schema: "example-tool-input@1.0.0", output_schema: "example-tool-output@1.0.0" },
  data_classes: ["internal"],
  effect_class: "write",
  idempotent: true,
  required_permissions: ["tool:invoke"],
  requires_approval: false,
  timeout_seconds: 30,
  rate_limit_per_minute: 60,
  cost_limit: 1,
  compensation_supported: true,
};

function baseCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    tool: { id: DESCRIPTOR.tool.id, version: DESCRIPTOR.tool.version },
    run_id: "run-tool-001",
    step_id: "step-1",
    workspace: workspaceContext(),
    policy_version: "policy@1.0.0",
    arguments: { target: "example" },
    purpose: "example call",
    deadline: "2026-08-06T10:00:00.000Z",
    idempotency_key: "idempotency-success-1",
    authorization_proof: "proof:signed",
    evidence_requirements: [],
    ...overrides,
  };
}

function makeTool(scenarios: ReadonlyMap<string, ScriptedToolScenario>): DeterministicTool {
  return new DeterministicTool({
    clock: { now: () => new Date("2026-08-06T09:30:00.000Z") },
    descriptor: DESCRIPTOR,
    scenarios,
  });
}

function contractScenarios(): ReadonlyMap<string, ScriptedToolScenario> {
  return new Map([
    ["idempotency-success-1", { code: "success", output: { applied: true }, redacted_evidence: ["evidence://tool-call-1"] }],
    ["idempotency-timeout-1", { code: "timeout" }],
    ["idempotency-partial-1", { code: "partial_effect", output: { applied: "half" }, effect_status: "partial" }],
  ]);
}

runToolContract("deterministic-tool", {
  makeTool: () => makeTool(contractScenarios()),
  workspaceContext,
  successCall: () => baseCall({ idempotency_key: "idempotency-success-1" }),
  timeoutCall: () => baseCall({ idempotency_key: "idempotency-timeout-1" }),
  partialEffectCall: () => baseCall({ idempotency_key: "idempotency-partial-1" }),
  callMissingPermission: () =>
    baseCall({ idempotency_key: "idempotency-success-1", workspace: workspaceContext({ permissions: [] }) }),
  callWithoutAuthorizationProof: () => baseCall({ idempotency_key: "idempotency-success-1", authorization_proof: "" }),
});

test("compensate reverses an applied effect and marks it compensated", async () => {
  const tool = makeTool(contractScenarios());
  const call = baseCall({ idempotency_key: "idempotency-success-1" });

  const invoked = await tool.invoke(call);
  assert.equal(invoked.ok, true);
  if (!invoked.ok) return;

  const compensation = await tool.compensate(invoked.value.call_reference, { actor_id: "actor-1", approval_ref: "approval-1" });
  assert.equal(compensation.ok, true, JSON.stringify(compensation));
  if (!compensation.ok) return;
  assert.equal(compensation.value.compensated, true);
});

test("compensate refuses to run twice for the same call_reference", async () => {
  const tool = makeTool(contractScenarios());
  const call = baseCall({ idempotency_key: "idempotency-success-1" });
  const invoked = await tool.invoke(call);
  assert.equal(invoked.ok, true);
  if (!invoked.ok) return;

  await tool.compensate(invoked.value.call_reference, { actor_id: "actor-1", approval_ref: "approval-1" });
  const second = await tool.compensate(invoked.value.call_reference, { actor_id: "actor-1", approval_ref: "approval-2" });

  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.failure.code, "already_compensated");
});

test("compensate fails closed when the descriptor does not support compensation", async () => {
  const nonCompensatingDescriptor: ToolDescriptor = { ...DESCRIPTOR, compensation_supported: false };
  const tool = new DeterministicTool({
    clock: { now: () => new Date("2026-08-06T09:30:00.000Z") },
    descriptor: nonCompensatingDescriptor,
    scenarios: contractScenarios(),
  });
  const call = baseCall({ idempotency_key: "idempotency-success-1" });
  const invoked = await tool.invoke(call);
  assert.equal(invoked.ok, true);
  if (!invoked.ok) return;

  const compensation = await tool.compensate(invoked.value.call_reference, { actor_id: "actor-1", approval_ref: "approval-1" });

  assert.equal(compensation.ok, false);
  if (compensation.ok) return;
  assert.equal(compensation.failure.code, "not_supported");
});

test("provider_failure is reported as a distinct, retryable code, not conflated with timeout", async () => {
  const tool = makeTool(new Map([["idempotency-provider-failure-1", { code: "provider_failure" }]]));
  const call = baseCall({ idempotency_key: "idempotency-provider-failure-1" });

  const result = await tool.invoke(call);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "provider_failure");
  assert.equal(result.failure.retryable, true);
});

test("invoking an unscripted idempotency_key fails closed with not_found instead of throwing", async () => {
  const tool = makeTool(new Map());
  const call = baseCall({ idempotency_key: "idempotency-unscripted-1" });

  const result = await tool.invoke(call);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_found");
});
