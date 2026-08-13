import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCandidateRepository } from "../../src/adapters/memory/in-memory-candidate-repository.js";
import { MistakeRecurrenceTracker } from "../../src/learning-engine/mistake-recurrence.js";
import { AgentRuntimeToolRegistry, fixedWorkspaceContext } from "../../src/mcp/agent-runtime-tool-registry.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
import { InMemoryAgentRuntime } from "../../src/runtime/in-memory-agent-runtime.js";
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
    issued_at: "2026-08-11T00:00:00.000Z",
    expires_at: "2026-08-12T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function qaRunWithDraft(draftId: string): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output: {
        draft_defects: [
          {
            id: draftId,
            classification: "functional",
            summary: "Login rejected valid user",
            suspected_cause: "wrong password field binding",
            related_test_refs: ["TC-LOGIN-1"],
          },
        ],
      },
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: "auto-qa-agent@0.1.0",
        skill: "run-auto-qa@0.1.0",
        policy: "policy@1.0.0",
      },
      rule_results: [],
      skill_usage: [],
      tool_usage: [],
      citations: [],
      uncertainty: { level: "none", reasons: [] },
      policy_events: [],
      usage: { steps: 1, duration_seconds: 1, tool_calls: 0, retries: 0 },
      evidence: ["evidence://qa-run-draft"],
      cleanup_status: "not_required",
      knowledge_candidates: [],
    },
  };
}

const runAutoQaTool = {
  name: "run_expert_qa",
  description: "test",
  inputSchema: { type: "object" as const, properties: {}, required: [] as const },
  agent: { id: "auto-qa-agent", version: "0.1.0" },
  purpose: "Run auto QA",
  consequence_class: "reversible" as const,
  policy_version: "policy@1.0.0",
  budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 2, max_retries: 1 },
  buildInput: () => ({}),
};

test("stable causal key: two draft ids with same class+test_ref trip recurrence + Learning candidate", async () => {
  const clock = new FixedClock("2026-08-11T12:00:00.000Z");
  const sessionMemory = new SessionMemory(clock);
  const tracker = new MistakeRecurrenceTracker(clock);
  const candidates = new InMemoryCandidateRepository(clock);
  const executor = new ScriptedExecutor([
    qaRunWithDraft("DEF-DRAFT:run-1"),
    qaRunWithDraft("DEF-DRAFT:run-2"),
  ]);
  const runtime = new InMemoryAgentRuntime(clock, new SequenceIdFactory(), new AllowingAuthorizer(), executor);

  let nextKey = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(workspaceContext("workspace-recurrence-001")),
    now: () => clock.now(),
    nextIdempotencyKey: () => `mcp-call-${++nextKey}`,
    deadlineSeconds: 120,
    sessionMemory,
    mistakeRecurrenceTracker: tracker,
    candidateRepository: candidates,
    tools: [runAutoQaTool],
  });

  const first = await registry.call("run_expert_qa", {}, new AbortController().signal);
  assert.equal(first.ok, true, first.text);
  assert.equal(tracker.occurrenceCount("workspace-recurrence-001", "avoid:functional:TC-LOGIN-1"), 1);
  const hintsAfterFirst = sessionMemory.list("workspace-recurrence-001", "avoid:");
  assert.equal(hintsAfterFirst.length, 1);
  assert.equal(hintsAfterFirst[0]?.key, "avoid:functional:TC-LOGIN-1");

  const second = await registry.call("run_expert_qa", {}, new AbortController().signal);
  assert.equal(second.ok, true, second.text);
  assert.equal(tracker.occurrenceCount("workspace-recurrence-001", "avoid:functional:TC-LOGIN-1"), 2);

  const listed = await candidates.query({
    context: workspaceContext("workspace-recurrence-001"),
    discovery_source: "mistake-recurrence",
  });
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  assert.ok(listed.value.some((c) => c.id.includes("avoid:functional:TC-LOGIN-1")));
});
