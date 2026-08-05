import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import type { AgentRunAccessRequest, AgentRunStartRequest } from "../../src/runtime/public.js";
import type { Clock, IdFactory } from "../../src/runtime/in-memory-agent-runtime.js";
import { PersistedAgentRuntime } from "../../src/runtime/persisted-agent-runtime.js";
import { SqliteAgentRunRecordStore } from "../../src/runtime/sqlite-agent-run-record-store.js";

class FixedClock implements Clock {
  readonly #time: Date;
  constructor(time: string) {
    this.#time = new Date(time);
  }
  now(): Date {
    return new Date(this.#time);
  }
}

class SequenceIdFactory implements IdFactory {
  #run = 0;
  #event = 0;
  next(kind: "run" | "event"): string {
    if (kind === "run") {
      this.#run += 1;
      return `run-${this.#run}`;
    }
    this.#event += 1;
    return `event-${this.#event}`;
  }
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    });
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
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
    issued_at: "2026-08-03T00:00:00.000Z",
    expires_at: "2026-08-03T02:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function startRequest(overrides: Partial<AgentRunStartRequest> = {}): AgentRunStartRequest {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    workspace_context: workspaceContext(),
    agent: { id: "requirement-review-agent", version: "1.0.0" },
    purpose: "Review requirement REQ-1",
    consequence_class: "advisory",
    input: { requirement_ref: "REQ-1@1.0.0" },
    policy_version: "policy@1.0.0",
    budgets: {
      max_steps: 10,
      max_duration_seconds: 60,
      max_tool_calls: 5,
      max_retries: 1,
    },
    deadline: "2026-08-03T01:00:00.000Z",
    idempotency_key: "start-1",
    ...overrides,
  };
}

function accessRequest(overrides: Partial<AgentRunAccessRequest> = {}): AgentRunAccessRequest {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-access",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    policy_version: "policy@1.0.0",
    workspace_context: workspaceContext(),
    ...overrides,
  };
}

async function openStore(): Promise<SqliteAgentRunRecordStore> {
  const root = await mkdtemp(join(tmpdir(), "qa-intelligence-persisted-agent-runtime-"));
  return new SqliteAgentRunRecordStore({
    database_path: join(root, "qa-intelligence.sqlite"),
    workspace_id: "workspace-alpha",
  });
}

test("a run started before a restart is inspectable after a fresh PersistedAgentRuntime restores it from the real SQLite store", async () => {
  const store = await openStore();
  const before = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );

  const started = await before.start(startRequest());
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  // Simulate a process restart: a brand-new PersistedAgentRuntime, sharing
  // nothing in-process with `before`, backed by the same durable store.
  const after = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:05:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );

  const restored = await after.restore(started.value);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  if (!restored.ok) return;
  assert.equal(restored.value.state, "ready");
  assert.equal(restored.value.revision, 3);

  const inspected = await after.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  if (!inspected.ok) return;
  assert.equal(inspected.value.state, "ready");
  assert.equal(inspected.value.objective, "Review requirement REQ-1");

  store.close();
});

test("a cancel issued after restart is durably retained and visible to a third instance", async () => {
  const store = await openStore();
  const first = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );
  const started = await first.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const second = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:05:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );
  const restoredForCancel = await second.restore(started.value);
  assert.equal(restoredForCancel.ok, true);
  if (!restoredForCancel.ok) return;

  const cancelled = await second.cancel(started.value, {
    ...accessRequest(),
    expected_revision: restoredForCancel.value.revision,
    reason: "no longer needed",
    evidence: ["operator:decision"],
    idempotency_key: "cancel-1",
  });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));

  const third = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:10:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );
  const restoredForRead = await third.restore(started.value);
  assert.equal(restoredForRead.ok, true, JSON.stringify(restoredForRead));
  if (!restoredForRead.ok) return;
  assert.equal(restoredForRead.value.state, "cancelled");

  store.close();
});

test("restore reports not_found for a run that was never retained in this Workspace's store", async () => {
  const store = await openStore();
  const runtimeInstance = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );

  const restored = await runtimeInstance.restore({
    schema_version: "1.0.0",
    run_id: "run-never-started",
    workspace_id: "workspace-alpha",
  });

  assert.equal(restored.ok, false);
  if (restored.ok) return;
  assert.equal(restored.failure.code, "not_found");

  store.close();
});
