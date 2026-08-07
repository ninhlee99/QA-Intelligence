import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentRuntime } from "../../src/runtime/in-memory-agent-runtime.js";
import { AgentRuntimeToolRegistry, fixedWorkspaceContext } from "../../src/mcp/agent-runtime-tool-registry.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
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

class ScriptedExecutor implements AgentRunExecutor {
  #index = 0;
  constructor(private readonly results: readonly AgentRunExecutorResult[]) {}
  execute(_input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const result = this.results[this.#index] ?? this.results[this.results.length - 1];
    this.#index += 1;
    return Promise.resolve(result as AgentRunExecutorResult);
  }
}

function completedResult(overrides: Partial<Extract<AgentRunExecutorResult, { ok: true }>["value"]> = {}): AgentRunExecutorResult {
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
      ...overrides,
    },
  };
}

function workspaceContext(workspaceId: string): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    actor_id: "actor-mcp-host",
    actor_type: "service",
    roles: ["mcp-host"],
    permissions: ["agent:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-mcp-001",
    correlation_id: "correlation-mcp-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function toolDefinition() {
  return {
    name: "assess_requirement_quality",
    description: "Assess a requirement's quality against SPEC-203",
    inputSchema: {
      type: "object" as const,
      properties: { requirement_ref: { type: "string" } },
      required: ["requirement_ref"],
    },
    agent: { id: "requirement-review-agent", version: "1.0.0" },
    purpose: "Review requirement quality via MCP",
    consequence_class: "advisory" as const,
    policy_version: "policy@1.0.0",
    allowed_skills: [{ id: "assess-requirement-quality", version: "1.0.0" }],
    buildInput: (args: Readonly<Record<string, unknown>>) => ({
      requirement_ref: (args["requirement_ref"] as string | undefined) ?? null,
    }),
  };
}

test("ADR-020 §2.6 / SPEC-108 §4.2: a completed run's outcome is retained in Session Memory and readable by a later call in the same Workspace", async () => {
  const executor = new ScriptedExecutor([completedResult()]);
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-06T09:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    executor,
  );
  const sessionMemory = new SessionMemory({ now: () => new Date("2026-08-06T09:30:00.000Z") });

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext("workspace-session-001")),
    now: () => new Date("2026-08-06T09:30:00.000Z"),
    nextIdempotencyKey: () => `mcp-call-${++nextKey}`,
    deadlineSeconds: 120,
    sessionMemory,
    tools: [toolDefinition()],
  });

  assert.equal(registry.readSessionMemory("workspace-session-001", "assess_requirement_quality"), undefined);

  const outcome = await registry.call(
    "assess_requirement_quality",
    { requirement_ref: "REQ-1@1.0.0" },
    new AbortController().signal,
  );
  assert.equal(outcome.ok, true, outcome.text);

  const retained = registry.readSessionMemory("workspace-session-001", "assess_requirement_quality");
  assert.notEqual(retained, undefined);
  assert.equal(retained?.workspace_id, "workspace-session-001");
  const value = JSON.parse(retained?.value ?? "{}") as { outcome: string };
  assert.equal(value.outcome, "completed");
  assert.deepEqual(sessionMemory.stats().promotions, 1);
});

test("ADR-020 §2.6 / SPEC-108 §8: Session Memory never leaks a retained outcome across Workspaces", async () => {
  const executor = new ScriptedExecutor([completedResult()]);
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-06T09:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    executor,
  );
  const sessionMemory = new SessionMemory({ now: () => new Date("2026-08-06T09:30:00.000Z") });

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext("workspace-session-alpha")),
    now: () => new Date("2026-08-06T09:30:00.000Z"),
    nextIdempotencyKey: () => `mcp-call-${++nextKey}`,
    deadlineSeconds: 120,
    sessionMemory,
    tools: [toolDefinition()],
  });

  await registry.call("assess_requirement_quality", { requirement_ref: "REQ-1@1.0.0" }, new AbortController().signal);

  assert.notEqual(registry.readSessionMemory("workspace-session-alpha", "assess_requirement_quality"), undefined);
  assert.equal(registry.readSessionMemory("workspace-session-beta", "assess_requirement_quality"), undefined);
});

test("ADR-020 §2.6 / SPEC-108 §7.1: a run the runtime does not complete is not retained as a reuse-likely outcome", async () => {
  const executor = new ScriptedExecutor([
    {
      ok: false,
      failure: { class: "subject", code: "invalid_output", message: "bad output", retryable: false, evidence: [] },
    },
  ]);
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-06T09:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    executor,
  );
  const sessionMemory = new SessionMemory({ now: () => new Date("2026-08-06T09:30:00.000Z") });

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext("workspace-session-002")),
    now: () => new Date("2026-08-06T09:30:00.000Z"),
    nextIdempotencyKey: () => `mcp-call-${++nextKey}`,
    deadlineSeconds: 120,
    sessionMemory,
    tools: [toolDefinition()],
  });

  const outcome = await registry.call(
    "assess_requirement_quality",
    { requirement_ref: "REQ-1@1.0.0" },
    new AbortController().signal,
  );
  assert.equal(outcome.ok, false);

  assert.equal(registry.readSessionMemory("workspace-session-002", "assess_requirement_quality"), undefined);
  assert.equal(sessionMemory.stats().promotions, 0);
});

test("a registry without sessionMemory configured behaves exactly as before (no crash, readSessionMemory returns undefined)", async () => {
  const executor = new ScriptedExecutor([completedResult()]);
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-06T09:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    executor,
  );

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext("workspace-session-003")),
    now: () => new Date("2026-08-06T09:30:00.000Z"),
    nextIdempotencyKey: () => `mcp-call-${++nextKey}`,
    deadlineSeconds: 120,
    tools: [toolDefinition()],
  });

  const outcome = await registry.call(
    "assess_requirement_quality",
    { requirement_ref: "REQ-1@1.0.0" },
    new AbortController().signal,
  );
  assert.equal(outcome.ok, true);
  assert.equal(registry.readSessionMemory("workspace-session-003", "assess_requirement_quality"), undefined);
});
