import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentRuntime } from "../../src/runtime/in-memory-agent-runtime.js";
import { resolveAgentRunBudgets } from "../../src/runtime/default-budgets.js";
import type {
  AgentRunAccessRequest,
  AgentRunStartRequest,
} from "../../src/runtime/public.js";
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
  #next = 0;
  next(kind: "run" | "event"): string {
    this.#next += 1;
    return `${kind}-${this.#next}`;
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

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    actor_type: "human",
    roles: ["agent-operator"],
    permissions: ["agent:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-05T23:00:00.000Z",
    expires_at: "2026-08-06T01:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function startRequestWithResolvedBudgets(
  consequenceClass: AgentRunStartRequest["consequence_class"],
  idempotencyKey: string,
): AgentRunStartRequest {
  return {
    schema_version: "1.0.0",
    operation_id: `operation-${idempotencyKey}`,
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    workspace_context: workspaceContext(),
    agent: { id: "requirement-review-agent", version: "1.0.0" },
    purpose: "Review requirement REQ-1",
    consequence_class: consequenceClass,
    input: { requirement_ref: "REQ-1@1.0.0" },
    policy_version: "policy@1.0.0",
    // Proves the SPEC-508 §3.1 table is a real, callable resolution path —
    // not just documentation — by feeding its output straight into the
    // runtime's own start-request validation.
    budgets: resolveAgentRunBudgets(consequenceClass),
    deadline: "2026-08-06T01:00:00.000Z",
    idempotency_key: idempotencyKey,
  };
}

function accessRequest(): AgentRunAccessRequest {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-access",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    policy_version: "policy@1.0.0",
    workspace_context: workspaceContext(),
  };
}

test("the runtime accepts a start request built from the advisory-tier default budget", async () => {
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-05T23:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
  );

  const started = await runtime.start(startRequestWithResolvedBudgets("advisory", "start-advisory"));
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.ok(started.ok);

  const snapshot = await runtime.inspect(started.value, accessRequest());
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  assert.ok(snapshot.ok);
  assert.equal(snapshot.value.consumed_budgets.steps, 0);
});

test("the runtime accepts a start request built from the high_consequence-tier default budget and requires approval", async () => {
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-05T23:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
  );

  const started = await runtime.start(
    startRequestWithResolvedBudgets("high_consequence", "start-high"),
  );
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.ok(started.ok);

  const snapshot = await runtime.inspect(started.value, accessRequest());
  assert.equal(snapshot.ok, true, JSON.stringify(snapshot));
  assert.ok(snapshot.ok);
  // The high_consequence default budget (40 steps / 400k tokens / 100 tool
  // calls / 1800s) is large enough to be accepted by validateStart's
  // positive-integer bounds check, and high_consequence still independently
  // requires approval before it can run — the budget table does not bypass
  // that.
  assert.equal(snapshot.value.state, "awaiting_approval");
  assert.equal(snapshot.value.pending_approval?.consequence_class, "high_consequence");
});

test("a caller-declared stricter override than the class default is still accepted by the runtime", async () => {
  const runtime = new InMemoryAgentRuntime(
    new FixedClock("2026-08-05T23:30:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
  );
  const request: AgentRunStartRequest = {
    ...startRequestWithResolvedBudgets("reversible", "start-strict"),
    budgets: {
      max_steps: 1,
      max_duration_seconds: 30,
      max_tool_calls: 1,
      max_retries: 0,
      max_tokens: 1_000,
    },
  };

  const started = await runtime.start(request);
  assert.equal(started.ok, true, JSON.stringify(started));
});
