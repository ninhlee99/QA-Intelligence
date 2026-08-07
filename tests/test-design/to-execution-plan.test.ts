import assert from "node:assert/strict";
import test from "node:test";

import { testCaseToExecutionPlan } from "../../src/test-design/to-execution-plan.js";
import { PlaywrightExecutionEngine } from "../../src/adapters/playwright/playwright-execution-engine.js";
import type { TestCase, TestCaseGeneratedAssertion } from "../../src/test-design/public.js";
import type { ExecutionAttemptIdentity, StartRequest } from "../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

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
    workspace_id: "workspace-plan-001",
    actor_id: "actor-plan-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-plan-001",
    correlation_id: "correlation-plan-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

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

function generatedTestCase(): TestCase {
  return {
    id: "test-case-1",
    version: "1.0.0",
    status: "draft",
    purpose: "Validate sign in",
    traceability: ["REQ-DEMO-002@1.0.0", "REQ-DEMO-002@1.0.0#AC-1"],
    preconditions: [`Semantic UI Map available for ${LOGIN_PAGE}`],
    workspace_scope: "workspace-plan-001",
    steps: [
      { action: "navigate", input: { url: LOGIN_PAGE } },
      { action: "type", input: { accessible_name: "Username", accessible_role: "textbox" } },
      { action: "type", input: { accessible_name: "Password", accessible_role: "textbox" } },
      { action: "click", input: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    expected_results: [{ assertion: 'After the step sequence, the page contains the text "Welcome".', authority: "REQ-DEMO-002@1.0.0#AC-1" }],
    owner: "test-design-generator",
  };
}

test("converts a generated TestCase into a PlaywrightExecutionPlan with the correct url and steps", () => {
  const assertions: TestCaseGeneratedAssertion[] = [{ test_case_id: "test-case-1", expected_text: "Welcome" }];
  const result = testCaseToExecutionPlan(generatedTestCase(), assertions);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.url, LOGIN_PAGE);
  assert.equal(result.value.steps?.length, 3);
  assert.deepEqual(result.value.steps?.[2], { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } });
});

test("a TestCase with no generated assertion is refused, never converted into an always-pass/fail plan", () => {
  const result = testCaseToExecutionPlan(generatedTestCase(), []);
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.code, "no_generated_assertion");
});

test("the converted plan runs through the real ExecutionEngine — fails because generated type steps carry no literal data (SPEC-207 §6: no invented test data)", async () => {
  const assertions: TestCaseGeneratedAssertion[] = [{ test_case_id: "test-case-1", expected_text: "Welcome" }];
  const converted = testCaseToExecutionPlan(generatedTestCase(), assertions);
  assert.equal(converted.ok, true, JSON.stringify(converted));
  if (!converted.ok) return;

  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-converted", attempt_id: "attempt-converted" };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([[attempt.attempt_id, converted.value]]),
  });

  const startRequest: StartRequest = {
    operation: "start",
    operationId: `op-start:${attempt.attempt_id}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${attempt.attempt_id}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-07T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { environment_lease: `lease:${attempt.execution_id}`, execution_plan_ref: `plan:${attempt.attempt_id}`, authorized_input_refs: [] },
  };

  const result = await engine.start(startRequest, () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  // Confirms the honest limitation documented above — not a bug to fix
  // here, but the reason a generated plan still needs real data supplied
  // before it can pass.
  assert.equal(result.value.outcome, "failed");
});
