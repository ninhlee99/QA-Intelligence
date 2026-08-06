import assert from "node:assert/strict";
import test from "node:test";

import {
  PostgresAgentRunRecordStore,
} from "../../src/runtime/postgres-agent-run-record-store.js";
import type {
  PostgresQuery,
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionManager,
} from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";
import type {
  AgentRunRecord,
  RetainAgentRunMutationRequest,
} from "../../src/runtime/agent-run-record-store.js";

const WORKSPACE_ID = "workspace-run-001";
const RUN_ID = "run-retained-001";

test("atomically retains a started run, its domain event, and command", async () => {
  const record = startedRecord();
  const database = new RecordingTransactionManager({
    run_command_load: result([]),
    run_create: result([{ record }]),
    run_event_append: result([{}]),
    run_command_retain: result([{}]),
  });
  const store = new PostgresAgentRunRecordStore({ database });

  const retained = await store.retainMutation(startMutation(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.deepEqual(retained.value, record);
  assert.equal(database.transactions, 1);
  assert.deepEqual(database.committedQueries, [
    "workspace_scope_set",
    "run_command_load",
    "run_create",
    "run_event_append",
    "run_command_retain",
  ]);
});

test("replays a retained command result without duplicating state", async () => {
  const record = startedRecord();
  const database = new RecordingTransactionManager({
    run_command_load: result([
      { request_digest: "sha256:start-run-retained-001", result: record },
    ]),
  });
  const store = new PostgresAgentRunRecordStore({ database });

  const replayed = await store.retainMutation(startMutation(record));

  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.ok(replayed.ok);
  assert.deepEqual(replayed.value, record);
  assert.deepEqual(database.committedQueries, ["workspace_scope_set", "run_command_load"]);
});

test("retains only the next optimistic run revision", async () => {
  const record = cancelledRecord();
  const database = new RecordingTransactionManager({
    run_command_load: result([]),
    run_update: result([{ record }]),
    run_event_append: result([{}]),
    run_command_retain: result([{}]),
  });
  const store = new PostgresAgentRunRecordStore({ database });

  const retained = await store.retainMutation(cancelMutation(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.equal(retained.value.snapshot.revision, 2);
  assert.equal(retained.value.snapshot.state, "cancelled");
  assert.ok(database.committedQueries.includes("run_update"));
  assert.equal(database.committedQueries.includes("run_create"), false);
});

test("resolves a concurrent same-command winner as an idempotent replay", async () => {
  const record = startedRecord();
  const database = new ConcurrentWinnerTransactionManager(record);
  const store = new PostgresAgentRunRecordStore({ database });

  const retained = await store.retainMutation(startMutation(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.deepEqual(retained.value, record);
  assert.equal(database.commandLoads, 2);
});

test("loads a retained run only through its Workspace transaction scope", async () => {
  const record = startedRecord();
  const database = new RecordingTransactionManager({
    run_load: result([{ record }]),
  });
  const store = new PostgresAgentRunRecordStore({ database });

  const loaded = await store.load({
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
  });

  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.value, record);
  assert.deepEqual(database.committedQueries, ["workspace_scope_set", "run_load"]);
});

test("fails closed when retained JSONB does not match run identity and shape", async () => {
  const database = new RecordingTransactionManager({
    run_load: result([
      {
        record: {
          snapshot: { workspace_id: WORKSPACE_ID, run_id: RUN_ID, revision: "one" },
          events: [],
        },
      },
    ]),
  });
  const store = new PostgresAgentRunRecordStore({ database });

  const loaded = await store.load({
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    run_id: RUN_ID,
  });

  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok);
  assert.equal(loaded.failure.code, "persistence_corrupt");
});

test("reports unavailable and rolls back when command retention fails", async () => {
  const record = startedRecord();
  const database = new CommandRetentionFailureTransactionManager();
  const store = new PostgresAgentRunRecordStore({ database });

  const retained = await store.retainMutation(startMutation(record));

  assert.equal(retained.ok, false);
  assert.ok(!retained.ok);
  assert.equal(retained.failure.code, "persistence_unavailable");
});

test("rejects an unresolvable mutation kind without throwing", async () => {
  const record = startedRecord();
  const database = new RecordingTransactionManager({});
  const store = new PostgresAgentRunRecordStore({ database });
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
  assert.equal(database.transactions, 0);
});

class RecordingTransactionManager implements PostgresTransactionManager {
  readonly #results: Readonly<Record<string, PostgresQueryResult<unknown>>>;
  transactions = 0;
  committedQueries: string[] = [];

  constructor(results: Readonly<Record<string, PostgresQueryResult<unknown>>>) {
    this.#results = results;
  }

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    this.transactions += 1;
    const pending: PostgresQuery[] = [];
    const value = await operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
        pending.push(query);
        const scripted = this.#results[query.name] ?? result([{}]);
        return scripted as PostgresQueryResult<Row>;
      },
    });
    this.committedQueries.push(...pending.map((query) => query.name));
    return value;
  }
}

class ConcurrentWinnerTransactionManager implements PostgresTransactionManager {
  readonly #record: AgentRunRecord;
  commandLoads = 0;

  constructor(record: AgentRunRecord) {
    this.#record = record;
  }

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    return operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
        if (query.name === "run_command_load") {
          this.commandLoads += 1;
          return result(
            this.commandLoads === 1
              ? []
              : [{ request_digest: "sha256:start-run-retained-001", result: this.#record }],
          ) as PostgresQueryResult<Row>;
        }
        if (query.name === "run_create") return result([]) as PostgresQueryResult<Row>;
        return result([{}]) as PostgresQueryResult<Row>;
      },
    });
  }
}

class CommandRetentionFailureTransactionManager implements PostgresTransactionManager {
  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    return operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
        if (query.name === "run_command_load") return result([]) as PostgresQueryResult<Row>;
        if (query.name === "run_command_retain") {
          throw new Error("simulated command retention failure");
        }
        return result([{}]) as PostgresQueryResult<Row>;
      },
    });
  }
}

function result<Row>(rows: readonly Row[]): PostgresQueryResult<Row> {
  return { row_count: rows.length, rows };
}

function startedRecord(): AgentRunRecord {
  return {
    snapshot: {
      schema_version: "1.0.0",
      run_id: RUN_ID,
      workspace_id: WORKSPACE_ID,
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
        event_id: `event-run-requested-${RUN_ID}`,
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        sequence: 1,
        type: "run_requested",
        occurred_at: "2026-08-05T10:00:00.000Z",
        payload_schema: { id: "agent-run-requested-payload", version: "1.0.0" },
        payload: {},
      },
    ],
    start_request: {
      schema_version: "1.0.0",
      operation_id: `start-${RUN_ID}`,
      workspace_id: WORKSPACE_ID,
      actor_id: "agent-runner-001",
      workspace_context: {
        schema_version: "1.0.0",
        workspace_id: WORKSPACE_ID,
        actor_id: "agent-runner-001",
        actor_type: "service",
        roles: ["agent-runner"],
        permissions: ["agent:start"],
        policy_version: "runtime-policy-1.0.0",
        request_id: "request-001",
        correlation_id: "correlation-001",
        audience: ["qa-intelligence-runtime"],
        environment: "test",
        issued_at: "2026-08-05T09:00:00.000Z",
        expires_at: "2026-08-05T11:00:00.000Z",
        issuer: "https://identity.test.invalid",
        integrity_proof: "fixture-proof",
      },
      agent: { id: "requirement-review-agent", version: "0.1.0" },
      purpose: "assess requirement quality",
      consequence_class: "advisory",
      input: {},
      policy_version: "runtime-policy-1.0.0",
      budgets: { max_steps: 10, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      deadline: "2026-08-05T10:05:00.000Z",
      idempotency_key: `start-${RUN_ID}`,
    },
    started_at: "2026-08-05T10:00:00.000Z",
    start_fingerprint: `fingerprint-${RUN_ID}`,
    result: null,
  };
}

function cancelledRecord(): AgentRunRecord {
  const started = startedRecord();
  return {
    ...started,
    snapshot: {
      ...started.snapshot,
      revision: 2,
      state: "cancelled",
      updated_at: "2026-08-05T10:00:01.000Z",
    },
    events: [
      ...started.events,
      {
        schema_version: "1.0.0",
        event_id: `event-run-cancelled-${RUN_ID}`,
        run_id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        sequence: 2,
        type: "run_cancelled",
        occurred_at: "2026-08-05T10:00:01.000Z",
        payload_schema: { id: "agent-run-cancelled-payload", version: "1.0.0" },
        payload: { reason: "unit test cancellation" },
      },
    ],
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
