import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentRunRecordStore,
  RetainAgentRunMutationRequest,
} from "../../src/runtime/agent-run-record-store.js";
import type { AgentRunRecord } from "../../src/runtime/agent-run-record-store.js";

export type RunRecordStoreContractFixture = Readonly<{
  workspace_id: string;
  run_id: string;
  makeStore(workspaceId: string): Promise<AgentRunRecordStore> | AgentRunRecordStore;
  closeStore?(store: AgentRunRecordStore): Promise<void> | void;
}>;

/**
 * SPEC-410 §5 / ADR-017 §6: local and shared Agent Run adapters SHALL pass
 * the same lifecycle, idempotency, optimistic-concurrency, and Workspace
 * identity contract suite. Mirrors
 * tests/evaluation/record-store-contract.ts for the Agent Run aggregate.
 */
export function runAgentRunRecordStoreContract(
  adapterName: string,
  fixture: RunRecordStoreContractFixture,
): void {
  test(`[${adapterName}] atomically retains a started run and loads it back`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = startedRecord(fixture);

    const retained = await store.retainMutation(startMutation(record));
    assert.equal(retained.ok, true, JSON.stringify(retained));
    assert.ok(retained.ok);
    assert.deepEqual(retained.value, record);

    const loaded = await store.load({
      schema_version: "1.0.0",
      workspace_id: fixture.workspace_id,
      run_id: fixture.run_id,
    });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.ok(loaded.ok);
    assert.deepEqual(loaded.value, record);
  });

  test(`[${adapterName}] replays a retained command result without duplicating state`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = startedRecord(fixture);
    const request = startMutation(record);

    const first = await store.retainMutation(request);
    const second = await store.retainMutation(request);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.ok(first.ok && second.ok);
    assert.deepEqual(second.value, first.value);
  });

  test(`[${adapterName}] rejects idempotency key reuse bound to a different request`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = startedRecord(fixture);
    const request = startMutation(record);
    await store.retainMutation(request);

    const conflicting = await store.retainMutation({
      ...request,
      command: { ...request.command, request_digest: "sha256:different-request" },
    });

    assert.equal(conflicting.ok, false);
    assert.ok(!conflicting.ok);
    assert.equal(conflicting.failure.code, "idempotency_conflict");
  });

  test(`[${adapterName}] retains only the next optimistic run revision`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const started = startedRecord(fixture);
    await store.retainMutation(startMutation(started));
    const cancelled = cancelledRecord(fixture);

    const retained = await store.retainMutation(cancelMutation(cancelled));

    assert.equal(retained.ok, true, JSON.stringify(retained));
    assert.ok(retained.ok);
    assert.equal(retained.value.snapshot.revision, 2);
    assert.equal(retained.value.snapshot.state, "cancelled");
  });

  test(`[${adapterName}] rejects a stale optimistic revision instead of overwriting`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const started = startedRecord(fixture);
    await store.retainMutation(startMutation(started));
    const cancelled = cancelledRecord(fixture);
    await store.retainMutation(cancelMutation(cancelled));

    const staleRetry = await store.retainMutation({
      ...cancelMutation(cancelled),
      command: {
        kind: "cancel",
        idempotency_key: "cancel-002-stale",
        request_digest: "sha256:cancel-002-stale",
      },
    });

    assert.equal(staleRetry.ok, false);
    assert.ok(!staleRetry.ok);
    assert.equal(staleRetry.failure.code, "stale_revision");
  });

  test(`[${adapterName}] cannot load a retained run through another Workspace's reference`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = startedRecord(fixture);
    const retained = await store.retainMutation(startMutation(record));
    assert.equal(retained.ok, true, JSON.stringify(retained));

    const loaded = await store.load({
      schema_version: "1.0.0",
      workspace_id: "workspace-contract-other-999",
      run_id: fixture.run_id,
    });
    assert.equal(loaded.ok, false, JSON.stringify(loaded));
    assert.ok(!loaded.ok);
    assert.ok(
      loaded.failure.code === "workspace_denied" ||
        loaded.failure.code === "not_found" ||
        loaded.failure.code === "persistence_unavailable",
      `unexpected failure code: ${loaded.failure.code}`,
    );
  });

  test(`[${adapterName}] reports not_found for a run that was never retained`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));

    const loaded = await store.load({
      schema_version: "1.0.0",
      workspace_id: fixture.workspace_id,
      run_id: "run-contract-never-retained",
    });

    assert.equal(loaded.ok, false);
    assert.ok(!loaded.ok);
    assert.equal(loaded.failure.code, "not_found");
  });

  test(`[${adapterName}] rejects an unresolvable mutation kind without throwing`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = startedRecord(fixture);
    const request = startMutation(record);

    const retained = await store.retainMutation({
      ...request,
      command: {
        ...request.command,
        kind: "forged-command-kind" as typeof request.command.kind,
      },
    });

    assert.equal(retained.ok, false);
    assert.ok(!retained.ok);
    assert.equal(retained.failure.code, "invalid_request");
  });
}

function startedRecord(
  fixture: Pick<RunRecordStoreContractFixture, "workspace_id" | "run_id">,
): AgentRunRecord {
  return {
    snapshot: {
      schema_version: "1.0.0",
      run_id: fixture.run_id,
      workspace_id: fixture.workspace_id,
      revision: 1,
      state: "requested",
      objective: "assess-requirement-quality",
      consumed_budgets: { steps: 0, duration_seconds: 0, tool_calls: 0, retries: 0 },
      pending_approval: null,
      checkpoint: null,
      failure_class: null,
      evidence: [],
      updated_at: "2026-08-05T10:00:00.000Z",
    },
    events: [
      {
        schema_version: "1.0.0",
        event_id: `event-run-requested-${fixture.run_id}`,
        run_id: fixture.run_id,
        workspace_id: fixture.workspace_id,
        sequence: 1,
        type: "run_requested",
        occurred_at: "2026-08-05T10:00:00.000Z",
        payload_schema: { id: "agent-run-requested-payload", version: "1.0.0" },
        payload: {},
      },
    ],
    start_request: {
      schema_version: "1.0.0",
      operation_id: `start-${fixture.run_id}`,
      workspace_id: fixture.workspace_id,
      actor_id: "agent-runner-contract-001",
      workspace_context: contractWorkspaceContext(fixture.workspace_id),
      agent: { id: "requirement-review-agent", version: "0.1.0" },
      purpose: "assess requirement quality",
      consequence_class: "advisory",
      input: {},
      policy_version: "runtime-policy-1.0.0",
      budgets: { max_steps: 10, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      deadline: "2026-08-05T10:05:00.000Z",
      idempotency_key: `start-${fixture.run_id}`,
    },
    started_at: "2026-08-05T10:00:00.000Z",
    start_fingerprint: `fingerprint-${fixture.run_id}`,
    result: null,
  };
}

function cancelledRecord(
  fixture: Pick<RunRecordStoreContractFixture, "workspace_id" | "run_id">,
): AgentRunRecord {
  const started = startedRecord(fixture);
  return {
    ...started,
    snapshot: {
      ...started.snapshot,
      revision: 2,
      state: "cancelled",
      failure_class: null,
      updated_at: "2026-08-05T10:00:01.000Z",
    },
    events: [
      ...started.events,
      {
        schema_version: "1.0.0",
        event_id: `event-run-cancelled-${fixture.run_id}`,
        run_id: fixture.run_id,
        workspace_id: fixture.workspace_id,
        sequence: 2,
        type: "run_cancelled",
        occurred_at: "2026-08-05T10:00:01.000Z",
        payload_schema: { id: "agent-run-cancelled-payload", version: "1.0.0" },
        payload: { reason: "contract test cancellation" },
      },
    ],
  };
}

function contractWorkspaceContext(workspaceId: string) {
  return {
    schema_version: "1.0.0" as const,
    workspace_id: workspaceId,
    actor_id: "agent-runner-contract-001",
    actor_type: "service" as const,
    roles: ["agent-runner"],
    permissions: ["agent:start"],
    policy_version: "runtime-policy-1.0.0",
    request_id: "request-contract-001",
    correlation_id: "correlation-contract-001",
    audience: ["qa-intelligence-runtime"],
    environment: "test",
    issued_at: "2026-08-05T09:00:00.000Z",
    expires_at: "2026-08-05T11:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "fixture-proof",
  };
}

function startMutation(record: AgentRunRecord): RetainAgentRunMutationRequest {
  return {
    record,
    expected_revision: null,
    command: {
      kind: "start",
      idempotency_key: `start-${record.snapshot.run_id}`,
      request_digest: `sha256:start-${record.snapshot.run_id}`,
    },
  };
}

function cancelMutation(record: AgentRunRecord): RetainAgentRunMutationRequest {
  return {
    record,
    expected_revision: 1,
    command: {
      kind: "cancel",
      idempotency_key: `cancel-${record.snapshot.run_id}`,
      request_digest: `sha256:cancel-${record.snapshot.run_id}`,
    },
  };
}
