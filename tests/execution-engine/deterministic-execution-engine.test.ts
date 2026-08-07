import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicExecutionEngine,
  type ScriptedExecutionScenario,
} from "../../src/adapters/replay/deterministic-execution-engine.js";
import type {
  ExecutionAttemptIdentity,
  ExecutionEngineEvent,
  StartRequest,
} from "../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import { runExecutionEngineContract } from "./execution-engine-contract.js";

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

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-execution-001",
    actor_id: "actor-execution-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-execution-001",
    correlation_id: "correlation-execution-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function scenarioFor(outcome: "passed" | "failed" | "cancelled"): ScriptedExecutionScenario {
  return {
    event_types: ["accepted", "preparing", "started", "progress", "completed"],
    outcome,
    evidence: [`evidence://${outcome}`],
    assertion_results: [{ assertion: "example", result: outcome === "passed" ? "pass" : "fail" }],
  };
}

function startRequestFor(attempt: ExecutionAttemptIdentity, outcome: "passed" | "failed" | "cancelled"): StartRequest {
  return {
    operation: "start",
    operationId: `op-start:${attempt.attempt_id}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${attempt.attempt_id}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      environment_lease: `lease:${attempt.execution_id}`,
      execution_plan_ref: `plan:${attempt.attempt_id}`,
      authorized_input_refs: [],
    },
  };
}

function makeEngine(scenarios: ReadonlyMap<string, ScriptedExecutionScenario>): DeterministicExecutionEngine {
  return new DeterministicExecutionEngine({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "deterministic-execution-engine", version: "0.1.0" },
    scenarios,
  });
}

/** Every attempt_id the shared contract suite exercises, pre-scripted so `makeEngine()` needs no per-test wiring. */
function contractScenarios(): ReadonlyMap<string, ScriptedExecutionScenario> {
  return new Map([
    ["attempt-idempotent-1", scenarioFor("passed")],
    ["attempt-ordering-1", scenarioFor("passed")],
    ["attempt-map-passed", scenarioFor("passed")],
    ["attempt-map-failed", scenarioFor("failed")],
    ["attempt-cancel-1", scenarioFor("cancelled")],
    ["attempt-terminal-cancel-1", scenarioFor("passed")],
    ["attempt-finalize-1", scenarioFor("passed")],
  ]);
}

runExecutionEngineContract("deterministic-execution-engine", {
  makeEngine: () => makeEngine(contractScenarios()),
  workspaceContext,
  startRequestFor,
});

test("validate reports incompatibility reasons when scripted incompatible", async () => {
  const engine = makeEngine(
    new Map([
      [
        "attempt-incompatible",
        { ...scenarioFor("failed"), compatible: false, incompatibility_reasons: ["engine does not support asset type"] },
      ],
    ]),
  );

  const result = await engine.validate({
    operation: "validate",
    operationId: "op-validate-1",
    attempt: { execution_id: "execution-1", attempt_id: "attempt-incompatible" },
    workspace: workspaceContext(),
    idempotency: { key: "k-validate-1", scope: "validate", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      asset_ref: "asset:1",
      test_version: { id: "test-case-1", version: "1.0.0" },
      environment_ref: "env:1",
      data_refs: [],
      configuration: {},
      evidence_policy_ref: "policy:default",
    },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.compatible, false);
  assert.deepEqual(result.value.incompatibility_reasons, ["engine does not support asset type"]);
});

test("start against an unscripted attempt fails closed instead of throwing", async () => {
  const engine = makeEngine(new Map());
  const request = startRequestFor({ execution_id: "execution-unscripted", attempt_id: "attempt-unscripted" }, "passed");

  const result = await engine.start(request, () => {});

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_request");
});

test("a worker that hangs mid-attempt still reports the terminal outcome once cancelled (SPEC-602 §5)", async () => {
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-hang", attempt_id: "attempt-hang" };
  const engine = makeEngine(
    new Map([
      [
        "attempt-hang",
        {
          event_types: ["accepted", "preparing", "started", "progress", "completed"],
          outcome: "cancelled",
          hangs_after_events: 2,
        },
      ],
    ]),
  );
  const request = startRequestFor(attempt, "cancelled");

  await engine.cancel({
    operation: "cancel",
    operationId: "op-cancel-hang",
    attempt,
    workspace: request.workspace,
    idempotency: { key: "k-cancel-hang", scope: "cancel", request_digest: "" },
    deadline: request.deadline,
    version: request.version,
    payload: { reason: "worker hung" },
  });

  const events: ExecutionEngineEvent[] = [];
  const result = await engine.start(request, (event) => events.push(event));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "cancelled");
  assert.equal(events.at(-1)?.type, "cancelled");
  assert.ok(events.length <= 3, "a hung worker must not emit events past its cancellation point plus the cancelled event");
});

test("authorization denial fails closed without exposing a scenario's evidence", async () => {
  const denyingAuthorizer: WorkspaceAuthorizer = {
    async authorize() {
      return {
        ok: false as const,
        failure: { code: "insufficient_permission" as const, message: "denied", retryable: false, evidence: [] },
      };
    },
  };
  const engine = new DeterministicExecutionEngine({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: denyingAuthorizer,
    provider: { id: "deterministic-execution-engine", version: "0.1.0" },
    scenarios: contractScenarios(),
  });

  const request = startRequestFor({ execution_id: "execution-denied", attempt_id: "attempt-idempotent-1" }, "passed");
  const result = await engine.start(request, () => {});

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_denied");
  assert.deepEqual(result.evidence, []);
});
