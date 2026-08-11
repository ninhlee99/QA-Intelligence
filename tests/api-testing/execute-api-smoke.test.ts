import assert from "node:assert/strict";
import test from "node:test";

import { ExecuteApiSmoke } from "../../src/api-testing/execute-api-smoke.js";
import type { HttpClient, HttpRequest, HttpResponse } from "../../src/api-testing/http-client.js";
import type { ApiSmokeCase } from "../../src/api-testing/public.js";
import { InMemoryWorkspaceCredentialRegistry } from "../../src/credentials/workspace-credential-registry.js";
import type {
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: "policy-1",
        effective_permissions: ["execution:execute"],
        authorized_resource_refs: ["workspace:workspace-api"],
        decision_evidence: ["policy:allow-api-smoke"],
      },
    });
  }
}

class ScriptedHttp implements HttpClient {
  readonly calls: HttpRequest[] = [];
  constructor(private readonly handler: (request: HttpRequest) => HttpResponse) {}
  request(input: HttpRequest): Promise<HttpResponse> {
    this.calls.push(input);
    return Promise.resolve(this.handler(input));
  }
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-api",
    actor_id: "tester-1",
    actor_type: "human",
    roles: ["qa-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy-1",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-10T07:00:00.000Z",
    expires_at: "2026-08-10T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "proof",
  };
}

function baseCase(overrides: Partial<ApiSmokeCase> = {}): ApiSmokeCase {
  return {
    id: "health",
    method: "GET",
    path: "/health",
    expect: { status: 200, body_includes: "ok" },
    ...overrides,
  };
}

test("API smoke passes when status and body match", async () => {
  const http = new ScriptedHttp(() => ({
    ok: true,
    status: 200,
    headers: { "content-type": "application/json" },
    body_text: '{"status":"ok"}',
    duration_ms: 12,
  }));
  const skill = new ExecuteApiSmoke({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    http,
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-api",
    context: context(),
    base_url: "https://api.example.test",
    cases: [baseCase()],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.equal(result.value.cases[0]?.outcome, "passed");
  assert.equal(http.calls[0]?.url, "https://api.example.test/health");
});

test("API smoke product assertion failure is failed, not infrastructure", async () => {
  const http = new ScriptedHttp(() => ({
    ok: true,
    status: 500,
    headers: {},
    body_text: "boom",
    duration_ms: 5,
  }));
  const skill = new ExecuteApiSmoke({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    http,
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-api",
    context: context(),
    base_url: "https://api.example.test",
    cases: [baseCase()],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
  assert.equal(result.value.cases[0]?.outcome, "failed");
});

test("API smoke transport failure is infrastructure_error", async () => {
  const http = new ScriptedHttp(() => ({
    ok: false,
    class: "infrastructure",
    message: "DNS lookup failed",
    duration_ms: 3,
    evidence: ["http:infrastructure:transport"],
  }));
  const skill = new ExecuteApiSmoke({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    http,
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-api",
    context: context(),
    base_url: "https://api.example.test",
    cases: [baseCase()],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.outcome, "infrastructure_error");
  assert.equal(result.value.cases[0]?.outcome, "infrastructure_error");
});

test("API smoke injects Bearer token from secret_ref without putting value in evidence", async () => {
  const clock = { now: () => new Date("2026-08-10T08:00:00.000Z") };
  const credentials = new InMemoryWorkspaceCredentialRegistry(clock);
  credentials.register({
    workspace_id: "workspace-api",
    secret_ref: "workspace-secret:api-token",
    value: "super-secret-token",
    kind: "api_token",
  });
  const http = new ScriptedHttp(() => ({
    ok: true,
    status: 200,
    headers: {},
    body_text: "ok",
    duration_ms: 1,
  }));
  const skill = new ExecuteApiSmoke({
    authorizer: new AllowingAuthorizer(),
    clock,
    ids: { next: (scope) => `${scope}-1` },
    http,
    credentials,
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-api",
    context: context(),
    base_url: "https://api.example.test",
    cases: [baseCase({ expect: { status: 200 } })],
    bearer_token_secret_ref: "workspace-secret:api-token",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(http.calls[0]?.headers.authorization, "Bearer super-secret-token");
  assert.equal(result.value.evidence.some((item) => item.includes("super-secret-token")), false);
});

test("API smoke rejects missing expectations as blocked", async () => {
  const skill = new ExecuteApiSmoke({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    http: new ScriptedHttp(() => {
      throw new Error("should not call http");
    }),
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-api",
    context: context(),
    base_url: "https://api.example.test",
    cases: [{ id: "noop", method: "GET", path: "/", expect: {} }],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.outcome, "blocked");
});
