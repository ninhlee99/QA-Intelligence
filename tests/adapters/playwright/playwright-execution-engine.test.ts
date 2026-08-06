import assert from "node:assert/strict";
import test from "node:test";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../../../src/adapters/playwright/playwright-execution-engine.js";
import type {
  ExecutionAttemptIdentity,
  StartRequest,
} from "../../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";
import { runExecutionEngineContract } from "../../execution-engine/execution-engine-contract.js";

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
    workspace_id: "workspace-playwright-001",
    actor_id: "actor-playwright-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-playwright-001",
    correlation_id: "correlation-playwright-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

const PASSED_PAGE = `data:text/html,${encodeURIComponent(
  '<html><body><button aria-label="Log in">Log in</button></body></html>',
)}`;
const FAILED_PAGE = `data:text/html,${encodeURIComponent("<html><body><div>No login here</div></body></html>")}`;

function planFor(outcome: "passed" | "failed" | "cancelled"): PlaywrightExecutionPlan {
  return {
    url: outcome === "failed" ? FAILED_PAGE : PASSED_PAGE,
    assert: (cleaned) => hasAccessibleName(cleaned, "Log in"),
  };
}

function hasAccessibleName(node: import("../../../src/dom-cleaner/public.js").CleanedDomNode, name: string): boolean {
  if (node.accessible_name === name) return true;
  return node.children.some((child) => hasAccessibleName(child, name));
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

function makeEngine(plans: ReadonlyMap<string, PlaywrightExecutionPlan>): PlaywrightExecutionEngine {
  return new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
}

/** Every attempt_id the shared contract suite exercises, pre-planned so `makeEngine()` needs no per-test wiring. */
function contractPlans(): ReadonlyMap<string, PlaywrightExecutionPlan> {
  return new Map([
    ["attempt-idempotent-1", planFor("passed")],
    ["attempt-ordering-1", planFor("passed")],
    ["attempt-map-passed", planFor("passed")],
    ["attempt-map-failed", planFor("failed")],
    ["attempt-cancel-1", planFor("cancelled")],
    ["attempt-terminal-cancel-1", planFor("passed")],
    ["attempt-finalize-1", planFor("passed")],
  ]);
}

runExecutionEngineContract("playwright-execution-engine", {
  makeEngine: () => makeEngine(contractPlans()),
  workspaceContext,
  startRequestFor,
});

test("start drives a real Chromium page through the Semantic UI pipeline and reports passed", async () => {
  const engine = makeEngine(new Map([["attempt-real-passed", planFor("passed")]]));
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-real", attempt_id: "attempt-real-passed" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.ok(result.value.evidence.length > 0, "a real run SHALL retain a DOM-clean capture id as evidence");
});

test("start drives a real Chromium page through the Semantic UI pipeline and reports failed when the plan assertion does not hold", async () => {
  const engine = makeEngine(new Map([["attempt-real-failed", planFor("failed")]]));
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-real", attempt_id: "attempt-real-failed" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
});

test("start fails closed with infrastructure_failure when the browser cannot launch (ADR-022 §4)", async () => {
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-launch-fails", planFor("passed")]]),
    launchBrowser: async () => {
      throw new Error("no browser binary installed");
    },
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-launch", attempt_id: "attempt-launch-fails" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.code, "infrastructure_failure");
  assert.equal(result.failure.retryable, true);
});
