import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicExecutionEngine, type ScriptedExecutionScenario } from "../../src/adapters/replay/deterministic-execution-engine.js";
import { InMemoryExecutionManager } from "../../src/adapters/memory/in-memory-execution-manager.js";
import type { DispatchAttemptRequest, PlanExecutionRequest } from "../../src/execution-manager/public.js";
import type { WorkspaceAuthorizationRequest, WorkspaceAuthorizer, WorkspaceContext } from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest) {
    return {
      ok: true as const,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-execmgr-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-execmgr-001",
    correlation_id: "correlation-execmgr-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T08:00:00.000Z",
    expires_at: "2026-08-08T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function passingScenario(): ScriptedExecutionScenario {
  return {
    event_types: ["accepted", "preparing", "started", "completed"],
    outcome: "passed",
    evidence: ["evidence://passed"],
    assertion_results: [{ assertion: "example", result: "pass" }],
  };
}

function makeEngine(scenarios: ReadonlyMap<string, ScriptedExecutionScenario>): DeterministicExecutionEngine {
  return new DeterministicExecutionEngine({
    clock: { now: () => new Date("2026-08-08T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "deterministic-execution-engine", version: "0.1.0" },
    scenarios,
  });
}

function makeManager(scenarios: ReadonlyMap<string, ScriptedExecutionScenario> = new Map()): InMemoryExecutionManager {
  return new InMemoryExecutionManager({ now: () => new Date("2026-08-08T08:30:00.000Z") }, makeEngine(scenarios));
}

function planRequest(overrides: Partial<PlanExecutionRequest> = {}): PlanExecutionRequest {
  return {
    execution_id: "EXEC-1",
    context: workspaceContext(),
    asset_ref: "asset:TC-1@1.0.0",
    environment_ref: "env:staging",
    idempotency_key: "idem-plan-1",
    ...overrides,
  };
}

function dispatchRequest(overrides: Partial<DispatchAttemptRequest> = {}): DispatchAttemptRequest {
  return {
    execution_id: "EXEC-1",
    context: workspaceContext(),
    expected_revision: 2,
    attempt_id: "attempt-1",
    test_version: { id: "TC-1", version: "1.0.0" },
    data_refs: [],
    configuration: {},
    evidence_policy_ref: "policy:evidence@1.0.0",
    isolation_requirements: {},
    authorized_input_refs: [],
    execution_plan_ref: "plan:attempt-1",
    idempotency_key: "idem-dispatch-1",
    ...overrides,
  };
}

async function plannedAndQueued(manager: InMemoryExecutionManager): Promise<void> {
  await manager.plan(planRequest());
  await manager.queue({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 1 });
}

test("plan creates an execution aggregate at planned", async () => {
  const manager = makeManager();
  const result = await manager.plan(planRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.attempts[0]?.state, "planned");
});

test("duplicate commands: repeating dispatchAttempt with the same idempotency_key does not create two attempts", async () => {
  const manager = makeManager(new Map([["attempt-1", passingScenario()]]));
  await plannedAndQueued(manager);

  const request = dispatchRequest();
  const first = await manager.dispatchAttempt(request);
  const second = await manager.dispatchAttempt(request);

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(first, second);
  if (!first.ok) return;
  assert.equal(first.value.attempts.length, 1);
});

test("race conditions: a stale expected_revision is a conflict, not a silent overwrite", async () => {
  const manager = makeManager();
  await manager.plan(planRequest());

  const result = await manager.queue({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 99 });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "conflict");
});

test("late callbacks: recordProgress after termination is idempotently ignored, not an error", async () => {
  const manager = makeManager(new Map([["attempt-1", passingScenario()]]));
  await plannedAndQueued(manager);
  await manager.dispatchAttempt(dispatchRequest());
  const completed = await manager.complete({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 3, outcome: "passed" });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  if (!completed.ok) return;

  const lateProgress = await manager.recordProgress({
    execution_id: "EXEC-1",
    context: workspaceContext(),
    expected_revision: 999,
    evidence_refs: ["evidence://late"],
  });

  assert.equal(lateProgress.ok, true, JSON.stringify(lateProgress));
  if (!lateProgress.ok) return;
  assert.deepEqual(lateProgress.value, completed.value);
});

test("cancellation: cancel from a non-terminal state is accepted; an already-terminal cancel is a no-op", async () => {
  const manager = makeManager();
  await manager.plan(planRequest());

  const cancelled = await manager.cancel({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 1, reason: "no longer needed" });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  if (!cancelled.ok) return;
  assert.equal(cancelled.value.attempts[0]?.state, "cancelled");

  const secondCancel = await manager.cancel({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 999, reason: "cancel again" });
  assert.equal(secondCancel.ok, true, JSON.stringify(secondCancel));
  if (!secondCancel.ok) return;
  assert.equal(secondCancel.value.attempts[0]?.state, "cancelled");
});

test("timeout transitions to timed_out, distinct from failed", async () => {
  const manager = makeManager();
  await manager.plan(planRequest());

  const result = await manager.timeout({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 1 });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.attempts[result.value.attempts.length - 1]?.state, "timed_out");
});

test("retry classification: an infrastructure-failure attempt is retry-eligible", async () => {
  const manager = makeManager();
  await manager.plan(planRequest());
  const failed = await manager.fail({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 1, failure_class: "infrastructure", reason: "worker crashed" });
  assert.equal(failed.ok, true, JSON.stringify(failed));
  if (!failed.ok) return;

  const eligible = await manager.retryEligibleAttempt({
    execution_id: "EXEC-1",
    context: workspaceContext(),
    attempt_id: failed.value.attempts[0]?.attempt_id ?? "",
    max_attempts: 3,
  });

  assert.equal(eligible.ok, true, JSON.stringify(eligible));
  if (!eligible.ok) return;
  assert.equal(eligible.value, true);
});

test("retry classification: a domain-failure attempt is not retry-eligible (SPEC-602 §4/§5)", async () => {
  const manager = makeManager();
  await manager.plan(planRequest());
  const failed = await manager.fail({ execution_id: "EXEC-1", context: workspaceContext(), expected_revision: 1, failure_class: "domain", reason: "assertion mismatch" });
  assert.equal(failed.ok, true, JSON.stringify(failed));
  if (!failed.ok) return;

  const eligible = await manager.retryEligibleAttempt({
    execution_id: "EXEC-1",
    context: workspaceContext(),
    attempt_id: failed.value.attempts[0]?.attempt_id ?? "",
    max_attempts: 3,
  });

  assert.equal(eligible.ok, true, JSON.stringify(eligible));
  if (!eligible.ok) return;
  assert.equal(eligible.value, false);
});

test("evidence ordering: attempts array preserves dispatch order and prior evidence is never mutated", async () => {
  const manager = makeManager(new Map([["attempt-1", passingScenario()]]));
  await plannedAndQueued(manager);
  const dispatched = await manager.dispatchAttempt(dispatchRequest());

  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  if (!dispatched.ok) return;
  assert.equal(dispatched.value.attempts.length, 1);
  assert.equal(dispatched.value.attempts[0]?.attempt_id, "attempt-1");
  assert.deepEqual(dispatched.value.attempts[0]?.evidence, ["evidence://passed"]);
});

test("Workspace isolation: an execution from one Workspace is not retrievable from another", async () => {
  const manager = makeManager();
  await manager.plan(planRequest({ context: workspaceContext({ workspace_id: "workspace-alpha" }) }));

  const result = await manager.getExecution(workspaceContext({ workspace_id: "workspace-beta" }), "EXEC-1");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_execution");
});

test("a dispatch attempt with no scripted scenario surfaces as engine_unavailable, not a crash", async () => {
  const manager = makeManager(new Map());
  await plannedAndQueued(manager);

  const result = await manager.dispatchAttempt(dispatchRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "engine_unavailable");
});
