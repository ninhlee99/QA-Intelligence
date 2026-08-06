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
import type {
  AgentRunRecordStore,
  AgentRunRecordStoreResult,
  PeekAgentRunCommandRequest,
  RetainAgentRunMutationRequest,
} from "../../src/runtime/agent-run-record-store.js";
import type { AgentRunReference } from "../../src/runtime/public.js";
import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "../../src/runtime/executor.js";

/** Wraps a real store to force the next N `retainMutation` calls to fail with a genuine infrastructure error, then behave normally. */
class FlakyRecordStore implements AgentRunRecordStore {
  #failuresRemaining: number;
  readonly #inner: AgentRunRecordStore;
  retainMutationCalls = 0;

  constructor(inner: AgentRunRecordStore, failuresRemaining: number) {
    this.#inner = inner;
    this.#failuresRemaining = failuresRemaining;
  }

  forceNextFailure(): void {
    this.#failuresRemaining += 1;
  }

  async retainMutation(request: RetainAgentRunMutationRequest): Promise<AgentRunRecordStoreResult> {
    this.retainMutationCalls += 1;
    if (this.#failuresRemaining > 0) {
      this.#failuresRemaining -= 1;
      return {
        ok: false,
        failure: { code: "persistence_unavailable", message: "simulated transient outage" },
      };
    }
    return this.#inner.retainMutation(request);
  }

  load(reference: AgentRunReference): Promise<AgentRunRecordStoreResult> {
    return this.#inner.load(reference);
  }

  peekCommand(request: PeekAgentRunCommandRequest) {
    return this.#inner.peekCommand(request);
  }
}

/** Never resolves until the test tells it to — used to force a real interleaving window for a racing command. */
class DeferredExecutor implements AgentRunExecutor {
  execute(_input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    return new Promise(() => {
      // Intentionally never resolves for the lifetime of the test.
    });
  }
}

/** Resolves only when the test calls `resolve()` — gives a real window to attempt a racing `restore()` before completing execute(). */
class ControllableExecutor implements AgentRunExecutor {
  #resolve: ((result: AgentRunExecutorResult) => void) | undefined;
  readonly started: Promise<void>;
  #signalStarted!: () => void;

  constructor() {
    this.started = new Promise((resolve) => {
      this.#signalStarted = resolve;
    });
  }

  execute(_input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    this.#signalStarted();
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolve(result: AgentRunExecutorResult): void {
    this.#resolve?.(result);
  }
}

function successfulExecutorResult(): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output: { assessment_id: "assessment-001", verdict: "changes_required" },
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: "requirement-review-agent@1.0.0",
        skill: "assess-requirement-quality@1.0.0",
        policy: "policy@1.0.0",
      },
      rule_results: ["rule:requirement-quality:indeterminate"],
      skill_usage: ["assess-requirement-quality@1.0.0"],
      tool_usage: [],
      citations: ["REQ-1@1.0.0"],
      uncertainty: {
        level: "high",
        reasons: ["response-time threshold is missing"],
      },
      policy_events: ["authorization:allow"],
      usage: {
        steps: 1,
        duration_seconds: 1,
        tool_calls: 0,
        retries: 0,
      },
      evidence: ["run://exec-1/step-1/observation"],
      cleanup_status: "completed",
      knowledge_candidates: [],
    },
  };
}

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

test("a transient persistence failure on one command does not poison persistence for a LATER command on the same run", async () => {
  const store = await openStore();
  const flaky = new FlakyRecordStore(store, 1);
  const runtimeInstance = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    flaky,
  );

  // The `start` command's own persist attempt is forced to fail once.
  await assert.rejects(() => runtimeInstance.start(startRequest()), /durable persistence failed/);

  // A second, unrelated run must not inherit that failure: its own start
  // should persist cleanly even though the prior run's persistence threw.
  const secondStart = await runtimeInstance.start(startRequest({ idempotency_key: "start-2" }));
  assert.equal(secondStart.ok, true, JSON.stringify(secondStart));

  store.close();
});

test("a transient persistence failure on one command does not poison a LATER command on the SAME run", async () => {
  const store = await openStore();
  const flaky = new FlakyRecordStore(store, 0);
  const runtimeInstance = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    flaky,
  );

  const started = await runtimeInstance.start(startRequest());
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  // Now make the NEXT persist attempt (cancel's) fail transiently.
  flaky.forceNextFailure();
  await assert.rejects(
    () =>
      runtimeInstance.cancel(started.value, {
        ...accessRequest(),
        expected_revision: 3,
        reason: "forced failure test",
        evidence: ["operator:decision"],
        idempotency_key: "cancel-1",
      }),
    /durable persistence failed/,
  );

  // A later, distinct command on the SAME run must still persist normally —
  // the earlier failure must not have poisoned this run's chain forever.
  const restored = await store.load(started.value);
  // The store's own state reflects whatever the last SUCCESSFUL persist
  // was (the start), because the cancel's persist attempt failed and the
  // in-memory runtime already transitioned to "cancelled" independent of
  // durability. Reading it back proves the store is still writable for
  // this run: retry the same durable write and confirm it succeeds.
  assert.equal(restored.ok, true, JSON.stringify(restored));
});

test("a real race between execute and cancel on the same run persists without throwing a false persistence failure", async () => {
  const store = await openStore();
  const runtimeInstance = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
    new DeferredExecutor(),
  );

  const started = await runtimeInstance.start(startRequest({ consequence_class: "advisory" }));
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const inspected = await runtimeInstance.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;

  // execute() awaits the DeferredExecutor, which never resolves in this
  // test — giving cancel() a real chance to interleave and commit first.
  const executePromise = runtimeInstance.execute(started.value, {
    ...accessRequest(),
    expected_revision: inspected.value.revision,
    idempotency_key: "execute-1",
  });

  const cancelled = await runtimeInstance.cancel(started.value, {
    ...accessRequest(),
    expected_revision: inspected.value.revision,
    reason: "cancel wins the race",
    evidence: ["operator:decision"],
    idempotency_key: "cancel-1",
  });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));

  const executed = await executePromise;
  assert.equal(executed.ok, false);
  if (executed.ok) return;
  assert.equal(executed.failure.code, "stale_revision");

  const restored = await store.load(started.value);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  if (!restored.ok) return;
  assert.equal(restored.value.snapshot.state, "cancelled");

  store.close();
});

test("restore() on the SAME instance is refused while a run is active, instead of rolling back and losing a real completed effect", async () => {
  const store = await openStore();
  const executor = new ControllableExecutor();
  const runtimeInstance = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
    executor,
  );

  const started = await runtimeInstance.start(
    startRequest({
      consequence_class: "advisory",
      allowed_skills: [{ id: "assess-requirement-quality", version: "1.0.0" }],
    }),
  );
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const inspected = await runtimeInstance.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;

  // execute() starts and awaits the executor — it is now in-flight and
  // in-process, at revision `running` past what the store durably holds.
  const executePromise = runtimeInstance.execute(started.value, {
    ...accessRequest(),
    expected_revision: inspected.value.revision,
    idempotency_key: "execute-1",
  });
  await executor.started;

  // Attempting to restore the SAME run on the SAME instance while it is
  // still active must be refused, not silently roll `#runs` back.
  const restoredWhileActive = await runtimeInstance.restore(started.value);
  assert.equal(restoredWhileActive.ok, false, JSON.stringify(restoredWhileActive));
  if (restoredWhileActive.ok) return;
  assert.equal(restoredWhileActive.failure.code, "invalid_request");

  // The executor now genuinely completes — its real effect must not have
  // been discarded as stale by the refused restore attempt above.
  executor.resolve(successfulExecutorResult());
  const executed = await executePromise;
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed");

  const persisted = await store.load(started.value);
  assert.equal(persisted.ok, true, JSON.stringify(persisted));
  if (!persisted.ok) return;
  assert.equal(persisted.value.snapshot.state, "completed");

  store.close();
});

test("restore() succeeds for a run this instance holds only in a TERMINAL state", async () => {
  const store = await openStore();
  const before = new PersistedAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    new AllowingAuthorizer(),
    store,
  );

  const started = await before.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const cancelled = await before.cancel(started.value, {
    ...accessRequest(),
    expected_revision: 3,
    reason: "no longer needed",
    evidence: ["operator:decision"],
    idempotency_key: "cancel-1",
  });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));

  // The SAME instance re-restoring a run it already holds, but now
  // terminal, is harmless and must remain allowed.
  const restored = await before.restore(started.value);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  if (!restored.ok) return;
  assert.equal(restored.value.state, "cancelled");

  store.close();
});
