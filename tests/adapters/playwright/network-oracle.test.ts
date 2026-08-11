import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { PlaywrightExecutionEngine } from "../../../src/adapters/playwright/playwright-execution-engine.js";
import {
  networkOracleSatisfied,
  readBodySnippet,
  shouldCaptureNetworkResponse,
} from "../../../src/adapters/playwright/network-oracle.js";
import type { ExecutionAttemptIdentity, StartRequest } from "../../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";
import { testCaseToExecutionPlan } from "../../../src/test-design/to-execution-plan.js";
import type { TestCase, TestCaseGeneratedAssertion } from "../../../src/test-design/public.js";

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
    workspace_id: "workspace-net-001",
    actor_id: "actor-net-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-net-001",
    correlation_id: "correlation-net-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

test("shouldCaptureNetworkResponse keeps xhr/fetch only", () => {
  assert.equal(shouldCaptureNetworkResponse("xhr", "https://api.example/login"), true);
  assert.equal(shouldCaptureNetworkResponse("fetch", "https://api.example/login"), true);
  assert.equal(shouldCaptureNetworkResponse("stylesheet", "https://cdn/x.css"), false);
  assert.equal(shouldCaptureNetworkResponse("xhr", "data:text/plain,hi"), false);
});

test("readBodySnippet truncates long textual bodies", async () => {
  const long = "x".repeat(10_000);
  const snippet = await readBodySnippet("application/json", async () => long);
  assert.equal(snippet.length, 4_096);
  const empty = await readBodySnippet("image/png", async () => long);
  assert.equal(empty, "");
});

test("networkOracleSatisfied matches url/method/status/body", () => {
  const observations = [
    { method: "POST", url: "https://api.example/v1/login", status: 200, body_snippet: '{"ok":true}' },
    { method: "GET", url: "https://api.example/v1/me", status: 401, body_snippet: "unauthorized" },
  ];
  assert.equal(
    networkOracleSatisfied(observations, { url_includes: "/v1/login", method: "POST", status: 200, body_includes: '"ok":true' }),
    true,
  );
  assert.equal(networkOracleSatisfied(observations, { url_includes: "/v1/login", status: 500 }), false);
  assert.equal(networkOracleSatisfied(observations, { url_includes: "/v1/me", status: [401, 403] }), true);
});

test("to-execution-plan wires expected_network into assert", () => {
  const testCase: TestCase = {
    id: "TC-NET",
    version: "1.0.0",
    status: "draft",
    purpose: "Submit login and observe API",
    traceability: ["REQ-1@1.0.0"],
    preconditions: [],
    workspace_scope: "ws-1",
    steps: [
      { action: "navigate", input: { url: "https://example.com/login" } },
      { action: "click", input: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    expected_results: [{ assertion: "API login returns 200", authority: "REQ-1@1.0.0" }],
    owner: "qa",
  };
  const assertion: TestCaseGeneratedAssertion = {
    test_case_id: "TC-NET",
    expected_text: "Welcome",
    expected_network: { url_includes: "/api/login", method: "POST", status: 200, body_includes: "token" },
  };
  const plan = testCaseToExecutionPlan(testCase, [assertion]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;

  // hasText only needs text/children
  const fakeCleaned = { text: "Welcome", children: [] } as unknown as import("../../../src/dom-cleaner/public.js").CleanedDomNode;

  assert.equal(
    plan.value.assert(fakeCleaned, {
      dialog_triggered: false,
      url: "https://example.com/home",
      title: "Home",
      network: [{ method: "POST", url: "https://example.com/api/login", status: 200, body_snippet: '{"token":"x"}' }],
    }),
    true,
  );
  assert.equal(
    plan.value.assert(fakeCleaned, {
      dialog_triggered: false,
      url: "https://example.com/home",
      title: "Home",
      network: [{ method: "POST", url: "https://example.com/api/login", status: 500, body_snippet: "err" }],
    }),
    false,
  );
});

test("Playwright run: click→fetch captured; expected_network passes in same assert", async () => {
  const loginHtml = `<!doctype html><html><body>
  <h1>Sign in</h1>
  <button aria-label="Sign in" onclick="
    document.body.innerHTML = '<h1>Welcome</h1>';
    fetch('/api/login', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'});
  ">Sign in</button>
</body></html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(loginHtml);
      return;
    }
    if (req.url === "/api/login" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"token":"abc"}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const pageUrl = `http://127.0.0.1:${port}/login`;

  try {
    const testCase: TestCase = {
      id: "TC-NET-LIVE",
      version: "1.0.0",
      status: "draft",
      purpose: "Submit triggers API",
      traceability: ["REQ-1@1.0.0"],
      preconditions: [],
      workspace_scope: "workspace-net-001",
      steps: [
        { action: "navigate", input: { url: pageUrl } },
        { action: "click", input: { accessible_name: "Sign in", accessible_role: "button" } },
      ],
      expected_results: [{ assertion: "Welcome + API 200", authority: "REQ-1@1.0.0" }],
      owner: "qa",
    };
    const assertion: TestCaseGeneratedAssertion = {
      test_case_id: "TC-NET-LIVE",
      expected_text: "Welcome",
      expected_network: {
        url_includes: "/api/login",
        method: "POST",
        status: 200,
        body_includes: "token",
      },
    };
    const converted = testCaseToExecutionPlan(testCase, [assertion]);
    assert.equal(converted.ok, true, JSON.stringify(converted));
    if (!converted.ok) return;

    const attempt: ExecutionAttemptIdentity = {
      execution_id: "execution-net",
      attempt_id: "attempt-net",
    };
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
      payload: {
        environment_lease: `lease:${attempt.execution_id}`,
        execution_plan_ref: `plan:${attempt.attempt_id}`,
        authorized_input_refs: [],
      },
    };

    const result = await engine.start(startRequest, () => {});
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.value.outcome, "passed", JSON.stringify(result.value));
    assert.ok(
      result.value.evidence.some((ref: string) => ref.startsWith("network-obs:")),
      JSON.stringify(result.value.evidence),
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
