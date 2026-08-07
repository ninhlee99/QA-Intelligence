import assert from "node:assert/strict";
import test from "node:test";

import { PgTransactionManager } from "../../src/evaluation/pg-transaction-manager.js";
import { PostgresAgentRunRecordStore } from "../../src/runtime/postgres-agent-run-record-store.js";
import type { AgentRunRecordStore } from "../../src/runtime/agent-run-record-store.js";

import { runAgentRunRecordStoreContract } from "./agent-run-record-store-contract.js";

/**
 * Exercises the ADR-017/SPEC-410 §5 PostgreSQL Agent Run adapter against a
 * real PostgreSQL 18 server instead of the in-process
 * FakePostgresTransactionManager used by
 * postgres-agent-run-record-store.contract.test.ts. Requires
 * QA_INTELLIGENCE_TEST_POSTGRES_URL to point at a database with migration
 * 0002_agent_run_store.up.sql already applied; skips (does not fail) when
 * unset so `npm test` remains database-free by default. Mirrors
 * tests/evaluation/pg-transaction-manager.real.test.ts for the Agent Run
 * aggregate.
 */
const CONNECTION_STRING = process.env["QA_INTELLIGENCE_TEST_POSTGRES_URL"];

if (CONNECTION_STRING === undefined || CONNECTION_STRING.trim().length === 0) {
  test(
    "[agent-run-postgres-real] skipped: QA_INTELLIGENCE_TEST_POSTGRES_URL is not set",
    { skip: true },
    () => {},
  );
} else {
  const connectionString = CONNECTION_STRING;
  let manager: PgTransactionManager;

  runAgentRunRecordStoreContract("postgres-real", {
    workspace_id: "workspace-contract-run-postgres-real-001",
    run_id: `run-contract-postgres-real-${Date.now()}`,
    async makeStore(): Promise<AgentRunRecordStore> {
      manager = new PgTransactionManager({ connection_string: connectionString });
      return new PostgresAgentRunRecordStore({ database: manager });
    },
    async closeStore(): Promise<void> {
      await manager.close();
    },
  });

  test("[agent-run-postgres-real] a concurrent writer cannot silently overwrite a revision", async () => {
    const runId = `run-concurrency-${Date.now()}`;
    const workspaceId = "workspace-contract-run-postgres-real-001";
    const managerA = new PgTransactionManager({ connection_string: connectionString });
    const managerB = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeA = new PostgresAgentRunRecordStore({ database: managerA });
      const storeB = new PostgresAgentRunRecordStore({ database: managerB });

      const started = await storeA.retainMutation(startMutation(workspaceId, runId));
      assert.equal(started.ok, true, JSON.stringify(started));

      // Two independent connections race to cancel the same revision. Real
      // Postgres row-level `UPDATE ... WHERE revision = $n` guarantees only
      // one commits; the other observes zero affected rows and the adapter
      // reports stale_revision instead of a silent overwrite.
      const [first, second] = await Promise.all([
        storeA.retainMutation(cancelMutation(workspaceId, runId, "cancel-a")),
        storeB.retainMutation(cancelMutation(workspaceId, runId, "cancel-b")),
      ]);

      const outcomes = [first, second];
      const succeededCount = outcomes.filter((outcome) => outcome.ok).length;
      const staleCount = outcomes.filter(
        (outcome) => !outcome.ok && outcome.failure.code === "stale_revision",
      ).length;
      assert.equal(succeededCount, 1, JSON.stringify(outcomes));
      assert.equal(staleCount, 1, JSON.stringify(outcomes));
    } finally {
      await managerA.close();
      await managerB.close();
    }
  });

  test("[agent-run-postgres-real] Row-Level Security denies a query issued without a Workspace scope", async () => {
    const runId = `run-rls-${Date.now()}`;
    const workspaceId = "workspace-contract-run-postgres-real-001";
    const manager2 = new PgTransactionManager({ connection_string: connectionString });
    try {
      const store = new PostgresAgentRunRecordStore({ database: manager2 });
      const started = await store.retainMutation(startMutation(workspaceId, runId));
      assert.equal(started.ok, true, JSON.stringify(started));

      // Bypass the adapter's own set_config('qa.workspace_id', ...) call and
      // query the table directly within a fresh transaction that never sets
      // the RLS session variable. PostgreSQL superusers always bypass RLS
      // regardless of FORCE ROW LEVEL SECURITY, so this test — like
      // production — SHALL run as a non-superuser application role for the
      // policy to have any effect; the unscoped read returns zero rows
      // rather than every Workspace's data.
      const unscoped = await manager2.transaction(async (transaction) =>
        transaction.query<{ run_id: string }>({
          name: "rls_probe",
          text: "SELECT run_id FROM qa_agent_runs WHERE run_id = $1",
          values: [runId],
        }),
      );
      assert.equal(unscoped.row_count, 0, JSON.stringify(unscoped));
    } finally {
      await manager2.close();
    }
  });

  test("[agent-run-postgres-real] state survives a fresh transaction manager (process-restart equivalent)", async () => {
    const runId = `run-restart-${Date.now()}`;
    const workspaceId = "workspace-contract-run-postgres-real-001";
    const before = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeBefore = new PostgresAgentRunRecordStore({ database: before });
      const started = await storeBefore.retainMutation(startMutation(workspaceId, runId));
      assert.equal(started.ok, true, JSON.stringify(started));
    } finally {
      await before.close();
    }

    // A new PgTransactionManager with its own connection pool stands in for
    // the parent runtime reconstructing state after a restart (ADR-017 §3):
    // nothing in the prior process's memory is available, only the database.
    const after = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeAfter = new PostgresAgentRunRecordStore({ database: after });
      const loaded = await storeAfter.load({
        schema_version: "1.0.0",
        workspace_id: workspaceId,
        run_id: runId,
      });
      assert.equal(loaded.ok, true, JSON.stringify(loaded));
      assert.ok(loaded.ok);
      assert.equal(loaded.value.snapshot.run_id, runId);
      assert.equal(loaded.value.snapshot.revision, 1);
    } finally {
      await after.close();
    }
  });
}

function startMutation(workspaceId: string, runId: string) {
  return {
    record: {
      snapshot: {
        schema_version: "1.0.0" as const,
        run_id: runId,
        workspace_id: workspaceId,
        revision: 1,
        state: "requested" as const,
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
          schema_version: "1.0.0" as const,
          event_id: `event-run-requested-${runId}`,
          run_id: runId,
          workspace_id: workspaceId,
          sequence: 1,
          type: "run_requested" as const,
          occurred_at: "2026-08-05T10:00:00.000Z",
          payload_schema: { id: "agent-run-requested-payload", version: "1.0.0" },
          payload: {},
        },
      ],
      start_request: {
        schema_version: "1.0.0" as const,
        operation_id: `start-${runId}`,
        workspace_id: workspaceId,
        actor_id: "agent-runner-contract-001",
        workspace_context: {
          schema_version: "1.0.0" as const,
          workspace_id: workspaceId,
          actor_id: "agent-runner-contract-001",
          actor_type: "service" as const,
          roles: ["agent-runner"],
          permissions: ["agent:start"],
          policy_version: "runtime-policy-1.0.0",
          request_id: "request-real-001",
          correlation_id: "correlation-real-001",
          audience: ["qa-intelligence-runtime"],
          environment: "test",
          issued_at: "2026-08-05T09:00:00.000Z",
          expires_at: "2026-08-05T11:00:00.000Z",
          issuer: "https://identity.test.invalid",
          integrity_proof: "fixture-proof",
        },
        agent: { id: "requirement-review-agent", version: "0.1.0" },
        purpose: "assess requirement quality",
        consequence_class: "advisory" as const,
        input: {},
        policy_version: "runtime-policy-1.0.0",
        budgets: { max_steps: 10, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
        deadline: "2026-08-05T10:05:00.000Z",
        idempotency_key: `start-${runId}`,
      },
      started_at: "2026-08-05T10:00:00.000Z",
      start_fingerprint: `fingerprint-${runId}`,
      result: null,
    },
    expected_revision: null,
    command: {
      kind: "start" as const,
      idempotency_key: `start-${runId}`,
      request_digest: `sha256:start-${runId}`,
    },
  };
}

function cancelMutation(workspaceId: string, runId: string, idempotencyKey: string) {
  return {
    record: {
      snapshot: {
        schema_version: "1.0.0" as const,
        run_id: runId,
        workspace_id: workspaceId,
        revision: 2,
        state: "cancelled" as const,
        objective: "assess-requirement-quality",
        consumed_budgets: { steps: 0, duration_seconds: 0, tool_calls: 0, retries: 0 },
        pending_approval: null,
        checkpoint: null,
        failure_class: null,
        evidence: [],
        updated_at: "2026-08-05T10:00:01.000Z",
      },
      events: [
        {
          schema_version: "1.0.0" as const,
          event_id: `event-run-requested-${runId}`,
          run_id: runId,
          workspace_id: workspaceId,
          sequence: 1,
          type: "run_requested" as const,
          occurred_at: "2026-08-05T10:00:00.000Z",
          payload_schema: { id: "agent-run-requested-payload", version: "1.0.0" },
          payload: {},
        },
        {
          schema_version: "1.0.0" as const,
          event_id: `event-run-cancelled-${runId}-${idempotencyKey}`,
          run_id: runId,
          workspace_id: workspaceId,
          sequence: 2,
          type: "run_cancelled" as const,
          occurred_at: "2026-08-05T10:00:01.000Z",
          payload_schema: { id: "agent-run-cancelled-payload", version: "1.0.0" },
          payload: { reason: "real integration test cancellation" },
        },
      ],
      start_request: {
        schema_version: "1.0.0" as const,
        operation_id: `start-${runId}`,
        workspace_id: workspaceId,
        actor_id: "agent-runner-contract-001",
        workspace_context: {
          schema_version: "1.0.0" as const,
          workspace_id: workspaceId,
          actor_id: "agent-runner-contract-001",
          actor_type: "service" as const,
          roles: ["agent-runner"],
          permissions: ["agent:start"],
          policy_version: "runtime-policy-1.0.0",
          request_id: "request-real-001",
          correlation_id: "correlation-real-001",
          audience: ["qa-intelligence-runtime"],
          environment: "test",
          issued_at: "2026-08-05T09:00:00.000Z",
          expires_at: "2026-08-05T11:00:00.000Z",
          issuer: "https://identity.test.invalid",
          integrity_proof: "fixture-proof",
        },
        agent: { id: "requirement-review-agent", version: "0.1.0" },
        purpose: "assess requirement quality",
        consequence_class: "advisory" as const,
        input: {},
        policy_version: "runtime-policy-1.0.0",
        budgets: { max_steps: 10, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
        deadline: "2026-08-05T10:05:00.000Z",
        idempotency_key: `start-${runId}`,
      },
      started_at: "2026-08-05T10:00:00.000Z",
      start_fingerprint: `fingerprint-${runId}`,
      result: null,
    },
    expected_revision: 1,
    command: {
      kind: "cancel" as const,
      idempotency_key: `${idempotencyKey}-${runId}`,
      request_digest: `sha256:${idempotencyKey}-${runId}`,
    },
  };
}
