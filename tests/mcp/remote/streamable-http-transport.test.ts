import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicWorkspaceAuthorizer } from "../../../src/adapters/deterministic/workspace-authorizer.js";
import {
  DeterministicWorkspaceContextIssuer,
  type DeterministicIdentityClaims,
  type MembershipRecord,
} from "../../../src/adapters/oidc/workspace-context-issuer.js";
import { InMemoryAgentRuntime } from "../../../src/runtime/in-memory-agent-runtime.js";
import { SessionMemory } from "../../../src/memory/session-memory.js";
import { OidcBearerAuthenticator } from "../../../src/mcp/remote/oidc-bearer-authenticator.js";
import { StreamableHttpTransport } from "../../../src/mcp/remote/streamable-http-transport.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../../../src/runtime/executor.js";
import type {
  WorkspaceAuthorizer,
  WorkspaceAuthorizationRequest,
} from "../../../src/requirement-review/public.js";

const EXPECTED_ISSUER = "https://idp.test.invalid";
const EXPECTED_AUDIENCE = "qa-intelligence-remote-test";
const WORKSPACE_ID = "workspace-remote-001";
const ACTOR_ID = "actor-remote-001";

const MEMBERSHIP: MembershipRecord = {
  workspace_id: WORKSPACE_ID,
  actor_id: ACTOR_ID,
  actor_type: "human",
  roles: ["mcp-remote-caller"],
  permissions: ["agent:execute"],
  policy_version: "policy@1.0.0",
};

function encodeToken(claims: DeterministicIdentityClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

function makeIssuer(overrides: Readonly<{ workspaceStatus?: "active" | "suspended" }> = {}) {
  return new DeterministicWorkspaceContextIssuer({
    expected_issuer: EXPECTED_ISSUER,
    expected_audience: EXPECTED_AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: overrides.workspaceStatus ?? "active" },
    membership: {
      resolve: (actorId, workspaceId) =>
        actorId === MEMBERSHIP.actor_id && workspaceId === WORKSPACE_ID ? MEMBERSHIP : undefined,
    },
    decoder: {
      decode: (idToken) => {
        try {
          return JSON.parse(Buffer.from(idToken, "base64url").toString("utf8")) as DeterministicIdentityClaims;
        } catch {
          return undefined;
        }
      },
    },
    signProof: (canonicalClaims) => `fixture-sha256:${canonicalClaims.length}`,
    context_issuer: "https://workspace-manager.test.invalid",
    clock: { now: () => new Date("2026-08-06T08:00:00.000Z") },
  });
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  requests: WorkspaceAuthorizationRequest[] = [];
  async authorize(request: WorkspaceAuthorizationRequest) {
    this.requests.push(request);
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

class ExecutorStub implements AgentRunExecutor {
  readonly inputs: AgentRunExecutorInput[] = [];
  constructor(private readonly result: AgentRunExecutorResult) {}
  execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    this.inputs.push(input);
    return Promise.resolve(this.result);
  }
}

function successfulExecution(): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output: { assessment_id: "assessment-001", verdict: "pass" },
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: "requirement-review-agent@1.0.0",
        skill: "assess-requirement-quality@1.0.0",
        policy: "policy@1.0.0",
      },
      rule_results: ["rule:requirement-quality:satisfied"],
      skill_usage: ["assess-requirement-quality@1.0.0"],
      tool_usage: [],
      citations: ["REQ-1@1.0.0"],
      uncertainty: { level: "none", reasons: [] },
      policy_events: ["authorization:allow"],
      usage: { steps: 1, duration_seconds: 1, tool_calls: 0, retries: 0, tokens: 500 },
      evidence: ["evidence://assessment-001"],
      cleanup_status: "not_required",
      knowledge_candidates: [],
    },
  };
}

function makeTransport(
  overrides: Readonly<{ issuer?: DeterministicWorkspaceContextIssuer; sessionMemory?: SessionMemory }> = {},
): {
  transport: StreamableHttpTransport;
  authorizer: AllowingAuthorizer;
  executor: ExecutorStub;
} {
  const authorizer = new AllowingAuthorizer();
  const executor = new ExecutorStub(successfulExecution());
  const runtime = new InMemoryAgentRuntime(
    { now: () => new Date("2026-08-06T08:00:00.000Z") },
    { next: (kind: "run" | "event") => `${kind}-1` },
    authorizer,
    executor,
  );

  const authenticator = new OidcBearerAuthenticator({
    issuer: overrides.issuer ?? makeIssuer(),
    runtime,
    tools: [
      {
        name: "assess_requirement_quality",
        description: "Assess a requirement's quality against SPEC-203",
        inputSchema: {
          type: "object",
          properties: { requirement_ref: { type: "string" } },
          required: ["requirement_ref"],
        },
        agent: { id: "requirement-review-agent", version: "1.0.0" },
        purpose: "Review requirement quality via remote MCP",
        consequence_class: "advisory",
        policy_version: "policy@1.0.0",
        allowed_skills: [{ id: "assess-requirement-quality", version: "1.0.0" }],
        buildInput: (args) => ({ requirement_ref: (args["requirement_ref"] as string | undefined) ?? null }),
      },
    ],
    serverInfo: { name: "qa-intelligence-remote-test", version: "0.1.0" },
    environment: "test",
    deadlineSeconds: 120,
    now: () => new Date("2026-08-06T08:00:00.000Z"),
    ...(overrides.sessionMemory !== undefined ? { sessionMemory: overrides.sessionMemory } : {}),
  });

  return {
    transport: new StreamableHttpTransport({ authenticator, allowInsecureBind: true }),
    authorizer,
    executor,
  };
}

async function withListeningTransport<T>(
  transport: StreamableHttpTransport,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  await transport.listen(0, "127.0.0.1");
  try {
    const port = transport.address()?.port;
    return await run(`http://127.0.0.1:${port}/mcp`);
  } finally {
    await transport.close();
  }
}

test("ADR-020 §9: a valid bearer token reaches the same tools/call outcome a stdio caller would", async () => {
  const { transport, authorizer, executor } = makeTransport();
  const token = encodeToken({ sub: ACTOR_ID, iss: EXPECTED_ISSUER, aud: EXPECTED_AUDIENCE });

  await withListeningTransport(transport, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "assess_requirement_quality", arguments: { requirement_ref: "REQ-1@1.0.0" } },
      }),
    });

    assert.equal(response.status, 200);
    const payload = (await response.json()) as { result: { isError: boolean; content: Array<{ text: string }> } };
    assert.equal(payload.result.isError, false, JSON.stringify(payload));
    const resultPayload = JSON.parse(payload.result.content[0]?.text ?? "{}");
    assert.equal(resultPayload.outcome, "completed");
    assert.equal(resultPayload.output.verdict, "pass");
  });

  assert.equal(authorizer.requests.length > 0, true);
  assert.equal(executor.inputs.length, 1);
});

test("ADR-020 §2.6 / SPEC-108 §4.2: Session Memory retains a completed call's outcome across two independent HTTP requests in the same Workspace", async () => {
  const sessionMemory = new SessionMemory({ now: () => new Date("2026-08-06T08:00:00.000Z") });
  const { transport } = makeTransport({ sessionMemory });
  const token = encodeToken({ sub: ACTOR_ID, iss: EXPECTED_ISSUER, aud: EXPECTED_AUDIENCE });

  assert.equal(sessionMemory.get(WORKSPACE_ID, "assess_requirement_quality:last_outcome"), undefined);

  await withListeningTransport(transport, async (url) => {
    const callTool = () =>
      fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "assess_requirement_quality", arguments: { requirement_ref: "REQ-1@1.0.0" } },
        }),
      });

    const first = await callTool();
    assert.equal(first.status, 200);

    // Each HTTP request is its own MCP session (ADR-020 §3.1) with a fresh
    // AgentRuntimeToolRegistry — Session Memory is what must survive across
    // them, since nothing else in this request/response cycle does.
    const retainedBetweenRequests = sessionMemory.get(WORKSPACE_ID, "assess_requirement_quality:last_outcome");
    assert.notEqual(retainedBetweenRequests, undefined);
    assert.equal(retainedBetweenRequests?.workspace_id, WORKSPACE_ID);

    const second = await callTool();
    assert.equal(second.status, 200);
  });
});

test("ADR-020 §9: a missing bearer token fails the HTTP request closed (401) before tools/list is reachable", async () => {
  const { transport } = makeTransport();

  await withListeningTransport(transport, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    assert.equal(response.status, 401);
    const payload = (await response.json()) as { error?: unknown; result?: unknown };
    assert.ok(payload.error, "a missing bearer token must never reach tools/list");
    assert.equal(payload.result, undefined);
  });
});

test("ADR-020 §9: an expired bearer token fails the HTTP request closed (401)", async () => {
  const { transport } = makeTransport();
  const token = encodeToken({ sub: ACTOR_ID, iss: EXPECTED_ISSUER, aud: EXPECTED_AUDIENCE, expired: true });

  await withListeningTransport(transport, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    assert.equal(response.status, 401);
  });
});

test("ADR-020 §9: a token for a suspended Workspace fails closed (401), not a widened allow", async () => {
  const { transport } = makeTransport({ issuer: makeIssuer({ workspaceStatus: "suspended" }) });
  const token = encodeToken({ sub: ACTOR_ID, iss: EXPECTED_ISSUER, aud: EXPECTED_AUDIENCE });

  await withListeningTransport(transport, async (url) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    assert.equal(response.status, 401);
  });
});

test("ADR-020 §4: refuses to bind to a non-loopback host without the explicit test-only opt-out", async () => {
  const transport = new StreamableHttpTransport({
    authenticator: { authenticate: async () => ({ ok: false, failure: { status: 401, message: "unused" } }) },
  });

  await assert.rejects(
    () => transport.listen(0, "0.0.0.0"),
    /Refusing to bind/,
  );
});

test("ADR-020 §9: disabling remote transport (never started) leaves no listening side effect", async () => {
  const { transport } = makeTransport();
  // Never call listen(); close() on an unstarted server must not throw.
  await assert.doesNotReject(() => transport.close());
});
