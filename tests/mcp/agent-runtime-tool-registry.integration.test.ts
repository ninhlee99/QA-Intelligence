import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentRuntime } from "../../src/runtime/in-memory-agent-runtime.js";
import {
  AgentRuntimeToolRegistry,
  fixedWorkspaceContext,
} from "../../src/mcp/agent-runtime-tool-registry.js";
import { McpServer } from "../../src/mcp/mcp-server.js";
import { MCP_PROTOCOL_VERSION } from "../../src/mcp/protocol.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../../src/runtime/executor.js";
import type {
  WorkspaceAuthorizer,
  WorkspaceAuthorizationRequest,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class FixedClock {
  constructor(private readonly iso: string) {}
  now(): Date {
    return new Date(this.iso);
  }
}

class SequenceIdFactory {
  #run = 0;
  next(kind: "run" | "event"): string {
    this.#run += 1;
    return `${kind}-${this.#run}`;
  }
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

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-mcp-001",
    actor_id: "actor-mcp-host",
    actor_type: "service",
    roles: ["mcp-host"],
    permissions: ["agent:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-mcp-001",
    correlation_id: "correlation-mcp-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-05T22:00:00.000Z",
    expires_at: "2026-08-06T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

test("a real tools/call reaches InMemoryAgentRuntime and returns the terminal result (ADR-016 §4, ADR-019 §5)", async () => {
  const authorizer = new AllowingAuthorizer();
  const executor = new ExecutorStub(successfulExecution());
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-05T22:30:00.000Z"),
    new SequenceIdFactory(),
    authorizer,
    executor,
  );

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext()),
    now: () => new Date("2026-08-05T22:30:00.000Z"),
    nextIdempotencyKey: () => {
      nextKey += 1;
      return `mcp-call-${nextKey}`;
    },
    deadlineSeconds: 120,
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
        purpose: "Review requirement quality via MCP",
        consequence_class: "advisory",
        policy_version: "policy@1.0.0",
        allowed_skills: [{ id: "assess-requirement-quality", version: "1.0.0" }],
        buildInput: (args) => ({ requirement_ref: (args["requirement_ref"] as string | undefined) ?? null }),
      },
    ],
  });

  const sent: unknown[] = [];
  const server = new McpServer({
    serverInfo: { name: "qa-intelligence", version: "0.1.0" },
    tools: registry,
    send: (line) => sent.push(JSON.parse(line)),
  });

  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "claude-code", version: "1.0.0" } },
    }),
  );
  await server.handleLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "assess_requirement_quality", arguments: { requirement_ref: "REQ-1@1.0.0" } },
    }),
  );

  assert.equal(sent.length, 2);
  const callResult = (sent[1] as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
  assert.equal(callResult.isError, false, JSON.stringify(callResult));
  const resultPayload = JSON.parse(callResult.content[0]?.text ?? "{}");
  assert.equal(resultPayload.outcome, "completed");
  assert.equal(resultPayload.output.verdict, "pass");

  // The transport layer never fabricated authority: the runtime's own
  // authorizer saw the call, and the executor received the actual input.
  assert.equal(authorizer.requests.length > 0, true);
  assert.equal(executor.inputs.length, 1);
});

test("a run that the runtime rejects (authorization denial) surfaces as an MCP error result, not a crash", async () => {
  class DenyingAuthorizer implements WorkspaceAuthorizer {
    async authorize() {
      return {
        ok: false as const,
        failure: { code: "insufficient_permission" as const, message: "denied", retryable: false, evidence: [] },
      };
    }
  }
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-05T22:30:00.000Z"),
    new SequenceIdFactory(),
    new DenyingAuthorizer(),
  );
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext()),
    now: () => new Date("2026-08-05T22:30:00.000Z"),
    nextIdempotencyKey: () => "mcp-deny-1",
    deadlineSeconds: 120,
    tools: [
      {
        name: "assess_requirement_quality",
        description: "Assess a requirement's quality",
        inputSchema: { type: "object" },
        agent: { id: "requirement-review-agent", version: "1.0.0" },
        purpose: "Review requirement quality via MCP",
        consequence_class: "advisory",
        policy_version: "policy@1.0.0",
        buildInput: () => ({}),
      },
    ],
  });

  const outcome = await registry.call("assess_requirement_quality", {}, new AbortController().signal);
  assert.equal(outcome.ok, false);
  assert.match(outcome.text, /Run could not start/);
});
