import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicWorkspaceAuthorizer } from "../../src/adapters/deterministic/workspace-authorizer.js";
import { PlaywrightExecutionEngine } from "../../src/adapters/playwright/playwright-execution-engine.js";
import { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import { GenerateTestCases } from "../../src/test-design/generate-test-cases.js";
import { testCaseToExecutionPlan } from "../../src/test-design/to-execution-plan.js";
import type { WorkspaceAuthorizationRequest, WorkspaceContext } from "../../src/requirement-review/public.js";
import type { ExecutionAttemptIdentity, StartRequest } from "../../src/execution-engine/public.js";

class AllowingAuthorizer {
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
    workspace_id: "workspace-variants-001",
    actor_id: "actor-variants-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute", "discovery:observe", "requirement:read", "test-case:create"],
    policy_version: "policy@1.0.0",
    request_id: "request-variants-001",
    correlation_id: "correlation-variants-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    // A real, non-mocked clock drives this test (it exercises real
    // Chromium against real pages, so a fixed test clock would not match
    // real request timestamps) — the expiry SHALL be far enough in the
    // future that ordinary test runtime (real network/browser latency)
    // can never race past it, unlike a same-day expiry.
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

// A form that (a) requires exact credentials, (b) truncates absurdly long
// input before ever touching a "backend" (simulating basic validation),
// and (c) never uses innerHTML on user input, so a correctly-built page
// naturally escapes an injected <script> tag as inert text.
const SAFE_LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <h1>Sign in</h1>
  <input aria-label="Username" id="u"/>
  <input aria-label="Password" id="p" type="password"/>
  <button aria-label="Sign in" onclick="
    var u = document.getElementById('u').value;
    var p = document.getElementById('p').value;
    if (u.length > 100 || p.length > 100) {
      document.body.innerHTML = '<h1>Value too long</h1>';
    } else if (u === 'demo-user' &amp;&amp; p === 'demo-pass') {
      document.body.innerHTML = '<h1>Welcome</h1>';
    } else {
      var msg = document.createElement('h1');
      msg.textContent = 'Invalid credentials for ' + u;
      document.body.innerHTML = '';
      document.body.appendChild(msg);
    }
  ">Sign in</button>
</body></html>
`)}`;

class GenIds {
  #testCase = 0;
  #finding = 0;
  next(scope: "test-case" | "finding"): string {
    return scope === "test-case" ? `test-case-${++this.#testCase}` : `finding-${++this.#finding}`;
  }
}

async function runGenerated(url: string) {
  const authorizer = new AllowingAuthorizer();
  const clock = { now: () => new Date() };
  const discovery = new DiscoverUiSurface({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });

  const discovered = await discovery.discover({ operation_id: "op-discover", context: workspaceContext(), url });
  assert.equal(discovered.ok, true, JSON.stringify(discovered));
  if (!discovered.ok) throw new Error("unreachable");

  const generated = await generator.generate({
    operation_id: "op-generate",
    workspace_id: "workspace-variants-001",
    context: workspaceContext(),
    requirement_ref: "REQ-VARIANTS-001@1.0.0",
    requirement_title: "User can sign in",
    acceptance_criteria: [
      {
        id: "AC-1",
        statement: 'The "Sign in" action authenticates a user who has entered valid Username and Password.',
        expected_text: "Welcome",
      },
    ],
    ui_map_elements: discovered.value.elements,
    ui_map_source_url: discovered.value.source_url,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  if (!generated.ok) throw new Error("unreachable");
  return generated.value;
}

async function execute(url: string, testCaseId: string, plans: ReturnType<typeof buildPlans>) {
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-variant", attempt_id: testCaseId };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new DeterministicWorkspaceAuthorizer({
      clock: { now: () => new Date() },
      expected_issuer: "identity-test",
      expected_audience: "qa-intelligence",
      workspace: { workspace_id: "workspace-variants-001", status: "active" },
      policy: { workspace_id: "workspace-variants-001", version: "policy@1.0.0", permissions: ["execution:execute"] },
      integrity_proof_verifier: { verify: () => true },
    }),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
  const startRequest: StartRequest = {
    operation: "start",
    operationId: `op-start:${testCaseId}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${testCaseId}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-07T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { environment_lease: "lease", execution_plan_ref: `plan:${testCaseId}`, authorized_input_refs: [] },
  };
  return engine.start(startRequest, () => {});
}

function buildPlans(...entries: Array<[string, ReturnType<typeof testCaseToExecutionPlan>]>) {
  const map = new Map();
  for (const [id, converted] of entries) {
    if (converted.ok) map.set(id, converted.value);
  }
  return map;
}

test("generated positive/negative/boundary/adversarial variants all execute correctly against a safely-built page", async () => {
  const result = await runGenerated(SAFE_LOGIN_PAGE);

  const byVariant = (variant: string) => result.test_cases.filter((testCase) => testCase.tags?.includes(variant));
  const positive = byVariant("positive")[0]!;
  const negativeOnPassword = byVariant("negative").find((testCase) => testCase.purpose.includes("Password"))!;
  const boundaryOnPassword = byVariant("boundary").find((testCase) => testCase.purpose.includes("Password"))!;
  const adversarialOnPassword = byVariant("adversarial").find((testCase) => testCase.purpose.includes("Password"))!;

  for (const testCase of [positive, negativeOnPassword, boundaryOnPassword, adversarialOnPassword]) {
    const converted = testCaseToExecutionPlan(testCase, result.generated_assertions);
    assert.equal(converted.ok, true, JSON.stringify(converted));
    if (!converted.ok) continue;

    // Positive needs real credentials filled in (SPEC-207 §6: generator
    // never invents "correct" data) — the other variants' probe values are
    // already baked in by the generator itself.
    const plan =
      testCase === positive
        ? {
            ...converted.value,
            steps: (converted.value.steps ?? []).map((step) =>
              step.kind === "type" && step.target.accessible_name === "Username"
                ? { ...step, text: "demo-user" }
                : step.kind === "type" && step.target.accessible_name === "Password"
                  ? { ...step, text: "demo-pass" }
                  : step,
            ),
          }
        : converted.value;

    const result_ = await execute(SAFE_LOGIN_PAGE, testCase.id, buildPlans([testCase.id, { ok: true, value: plan }]));
    assert.equal(result_.ok, true, JSON.stringify(result_));
    if (!result_.ok) continue;
    assert.equal(result_.value.outcome, "passed", `${testCase.tags?.join(",")} variant should pass against the safely-built page: ${JSON.stringify(result_.value)}`);
  }
});

// Directly concatenates user input into innerHTML — a real, common XSS bug.
// This is what the adversarial variant exists to catch: not a hypothetical,
// an actual vulnerable page shape.
const VULNERABLE_LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <h1>Sign in</h1>
  <input aria-label="Username" id="u"/>
  <input aria-label="Password" id="p" type="password"/>
  <button aria-label="Sign in" onclick="
    var u = document.getElementById('u').value;
    var p = document.getElementById('p').value;
    if (u === 'demo-user' &amp;&amp; p === 'demo-pass') {
      document.body.innerHTML = '<h1>Welcome</h1>';
    } else {
      document.body.innerHTML = '<h1>Invalid credentials for ' + u + '</h1>';
    }
  ">Sign in</button>
</body></html>
`)}`;

test("the adversarial variant catches a real XSS bug (unescaped innerHTML concatenation) that the positive case alone would miss", async () => {
  const result = await runGenerated(VULNERABLE_LOGIN_PAGE);
  const adversarialOnUsername = result.test_cases
    .filter((testCase) => testCase.tags?.includes("adversarial"))
    .find((testCase) => testCase.purpose.includes("Username"))!;
  assert.ok(adversarialOnUsername, "expected an adversarial case targeting Username");

  const converted = testCaseToExecutionPlan(adversarialOnUsername, result.generated_assertions);
  assert.equal(converted.ok, true, JSON.stringify(converted));
  if (!converted.ok) return;

  const executed = await execute(
    VULNERABLE_LOGIN_PAGE,
    adversarialOnUsername.id,
    buildPlans([adversarialOnUsername.id, { ok: true, value: converted.value }]),
  );
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;

  // The vulnerable page reflects the raw <script> tag into innerHTML, so
  // the forbidden probe string IS present in the DOM — the generated
  // assertion correctly reports this as a failure, not a false pass.
  assert.equal(executed.value.outcome, "failed", `adversarial variant should catch the XSS bug, got: ${JSON.stringify(executed.value)}`);
});
