import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { DiscoverAfterLogin } from "../../src/discovery/discover-after-login.js";
import { DiscoverAfterLoginRuntimeExecutor } from "../../src/discovery/discover-after-login-runtime-executor.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T12:00:00.000Z";
const WORKSPACE_ID = "workspace-discover-after-login-001";
const AGENT = { id: "discover-after-login-agent", version: "0.1.0" } as const;
const SKILL = { id: "discover-after-login", version: "0.1.0" } as const;

const clock = { now: (): Date => new Date(NOW) };

class RuntimeSequenceIds implements RuntimeIdFactory {
  #run = 0;
  #event = 0;
  next(kind: "run" | "event"): string {
    if (kind === "run") return `run-${++this.#run}`;
    return `event-${++this.#event}`;
  }
}

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function context(permissions: readonly string[]): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-001",
    actor_type: "human",
    roles: ["execution-operator"],
    permissions: [...permissions],
    policy_version: "test-policy@0.1.0",
    request_id: "request-discover-after-login-001",
    correlation_id: "correlation-discover-after-login-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T11:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return { ...unsigned, integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)) };
}

// A real cookie-session-gated app: /login serves a form; POSTing correct
// credentials sets a session cookie and redirects to /dashboard; visiting
// /dashboard without that cookie redirects back to /login. This is the
// exact shape `discover_ui_surface` alone cannot handle (a fresh browser
// per call never carries the cookie), which is what this Skill exists for.
function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const cookie = req.headers.cookie ?? "";
    const loggedIn = cookie.includes("session=valid");

    if (req.url === "/login" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body>
          <h1>Sign in</h1>
          <label for="u">Username</label><input id="u" name="u"/>
          <label for="p">Password</label><input id="p" name="p" type="password"/>
          <form method="POST" action="/login">
            <input type="hidden" name="_csrf" value="ignored"/>
            <button aria-label="Sign in" onclick="
              var xhr = new XMLHttpRequest();
              xhr.open('POST', '/login', false);
              xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
              xhr.send('u=' + encodeURIComponent(document.getElementById('u').value) + '&p=' + encodeURIComponent(document.getElementById('p').value));
              if (xhr.status === 200) { window.location.href = '/dashboard'; }
              return false;
            ">Sign in</button>
          </form>
        </body></html>
      `);
      return;
    }
    if (req.url === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const valid = body.includes("u=real-user") && body.includes("p=real-pass");
        if (valid) {
          res.writeHead(200, { "Set-Cookie": "session=valid; Path=/", "Content-Type": "text/plain" });
          res.end("ok");
        } else {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("denied");
        }
      });
      return;
    }
    if (req.url === "/dashboard") {
      if (!loggedIn) {
        res.writeHead(302, { Location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body><h1>Job Management</h1><input aria-label="Job Title Filter"/><button aria-label="Search Jobs">Search Jobs</button></body></html>`);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

test("discovers a session-gated screen by logging in first, on the exact same browser session", async () => {
  const fixture = await startFixtureServer();
  try {
    const permissions = ["agent:execute", "agent:read", "discovery:observe", "execution:execute"];
    const authorizer = new DeterministicWorkspaceAuthorizer({
      clock,
      expected_issuer: "https://identity.test.invalid",
      expected_audience: "qa-intelligence-test",
      workspace: { workspace_id: WORKSPACE_ID, status: "active" },
      policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions },
      integrity_proof_verifier: {
        verify({ canonical_claims, integrity_proof }): boolean {
          return integrity_proof === fixtureProof(canonical_claims);
        },
      },
    });

    const skill = new DiscoverAfterLogin({ clock, authorizer });
    const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
      new Map([[AGENT.id, new DiscoverAfterLoginRuntimeExecutor({ skill, expected_agent: AGENT, expected_skill: SKILL, engine_ref: "playwright-dom-pipeline@0.1.0" })]]),
    );
    const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
    const workspaceContext = context(permissions);

    const started = await runtime.start({
      schema_version: "1.0.0",
      operation_id: "operation-runtime-start",
      workspace_id: WORKSPACE_ID,
      actor_id: workspaceContext.actor_id,
      workspace_context: workspaceContext,
      agent: AGENT,
      purpose: "Discover the session-gated dashboard after logging in.",
      consequence_class: "reversible",
      input: {
        login_url: `${fixture.url}/login`,
        username_field_name: "Username",
        username: "real-user",
        password_field_name: "Password",
        password: "real-pass",
        submit_action_name: "Sign in",
        target_url: `${fixture.url}/dashboard`,
      },
      allowed_skills: [SKILL],
      allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
      policy_version: workspaceContext.policy_version,
      budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
      deadline: "2030-01-01T00:00:00.000Z",
      idempotency_key: "discover-after-login-start-001",
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) return;

    const executed = await runtime.execute(started.value, {
      schema_version: "1.0.0",
      operation_id: "operation-runtime-execute",
      workspace_id: WORKSPACE_ID,
      actor_id: workspaceContext.actor_id,
      policy_version: workspaceContext.policy_version,
      workspace_context: workspaceContext,
      expected_revision: 3,
      idempotency_key: "discover-after-login-execute-001",
    });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    if (!executed.ok) return;
    assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

    const output = executed.value.output as { source_url: string; elements: Array<{ accessible_name: string | null; kind: string }> } | null;
    assert.ok(output, "expected a Semantic UI Map output");
    assert.equal(output!.source_url, `${fixture.url}/dashboard`);

    const searchAction = output!.elements.find((element) => element.accessible_name === "Search Jobs");
    assert.ok(searchAction, "expected to discover the post-login dashboard's Search Jobs action — proves the session cookie carried over");
    assert.equal(searchAction!.kind, "action");
  } finally {
    await fixture.close();
  }
});
