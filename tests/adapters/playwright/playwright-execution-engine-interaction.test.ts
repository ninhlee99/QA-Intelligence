import assert from "node:assert/strict";
import test from "node:test";

import {
  PlaywrightExecutionEngine,
  type PlaywrightExecutionPlan,
  type SecretResolver,
} from "../../../src/adapters/playwright/playwright-execution-engine.js";
import type { ExecutionAttemptIdentity, StartRequest } from "../../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";

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
    workspace_id: "workspace-interaction-001",
    actor_id: "actor-interaction-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-interaction-001",
    correlation_id: "correlation-interaction-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

// A form whose own JS redirects only when the exact expected credentials are
// submitted, landing on a page only reachable post-login — same shape as a
// real login flow, self-contained (no network dependency).
const LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <h1>Sign in</h1>
  <input aria-label="Username" id="u"/>
  <input aria-label="Password" id="p" type="password"/>
  <button aria-label="Sign in" onclick="
    if (document.getElementById('u').value === 'demo-user' &amp;&amp; document.getElementById('p').value === 'demo-pass') {
      document.body.innerHTML = '<h1>Welcome</h1>';
    } else {
      document.body.innerHTML = '<h1>Invalid credentials</h1>';
    }
  ">Sign in</button>
</body></html>
`)}`;

function makeEngine(
  plans: ReadonlyMap<string, PlaywrightExecutionPlan>,
  secrets?: SecretResolver,
): PlaywrightExecutionEngine {
  return new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
    ...(secrets !== undefined ? { secrets } : {}),
  });
}

function startRequestFor(attempt: ExecutionAttemptIdentity): StartRequest {
  return {
    operation: "start",
    operationId: `op-start:${attempt.attempt_id}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${attempt.attempt_id}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-07T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      environment_lease: `lease:${attempt.execution_id}`,
      execution_plan_ref: `plan:${attempt.attempt_id}`,
      authorized_input_refs: [],
    },
  };
}

test("logs into a fixture form via semantic type+click steps and asserts the post-login page", async () => {
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [
      { kind: "type", target: { accessible_name: "Username", accessible_role: "textbox" }, text: "demo-user" },
      { kind: "type", target: { accessible_name: "Password" }, text: "demo-pass" },
      { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Welcome"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-login", attempt_id: "attempt-login" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]));

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
});

test("a step targeting a nonexistent element fails closed with plugin_failure, not a hang", async () => {
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [{ kind: "click", target: { accessible_name: "Does not exist", accessible_role: "button" } }],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-missing", attempt_id: "attempt-missing" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]));

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.code, "plugin_failure");
  assert.equal(result.failure.responsible_domain, "plugin");
});

test("a type step's secret_ref resolves through the SecretResolver, never a plan-supplied raw value", async () => {
  const resolvedRefs: string[] = [];
  const secrets: SecretResolver = {
    resolve: async (ref) => {
      resolvedRefs.push(ref);
      return ref === "workspace-secret:demo-password" ? "demo-pass" : undefined;
    },
  };
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [
      { kind: "type", target: { accessible_name: "Username" }, text: "demo-user" },
      { kind: "type", target: { accessible_name: "Password" }, secret_ref: "workspace-secret:demo-password" },
      { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Welcome"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-secret", attempt_id: "attempt-secret" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), secrets);

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.deepEqual(resolvedRefs, ["workspace-secret:demo-password"]);
});

function hasText(node: import("../../../src/dom-cleaner/public.js").CleanedDomNode, text: string): boolean {
  if (node.text === text) return true;
  return node.children.some((child) => hasText(child, text));
}
