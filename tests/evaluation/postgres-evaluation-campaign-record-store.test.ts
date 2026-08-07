import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  InMemoryEvaluationCampaignRepository,
  type EvaluationCampaignRecord,
} from "../../src/evaluation/evaluation-campaign-repository.js";
import {
  PostgresEvaluationCampaignRecordStore,
  type PostgresQuery,
  type PostgresQueryResult,
  type PostgresTransaction,
  type PostgresTransactionManager,
} from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";
import type {
  RetainEvaluationCampaignMutationRequest,
} from "../../src/evaluation/evaluation-campaign-record-store.js";

const NOW = "2026-08-03T16:00:00.000Z";

test("atomically retains a created campaign, domain event, command, and outbox intent", async () => {
  const record = await createdRecord();
  const database = new RecordingTransactionManager({
    campaign_command_load: result([]),
    campaign_create: result([{ record }]),
    campaign_event_append: result([{}]),
    campaign_command_retain: result([{}]),
    campaign_outbox_append: result([{}]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const retained = await store.retainMutation(mutationRequest(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.deepEqual(retained.value, record);
  assert.equal(database.transactions, 1);
  assert.deepEqual(database.committedQueries, [
    "workspace_scope_set",
    "campaign_command_load",
    "campaign_create",
    "campaign_event_append",
    "campaign_command_retain",
    "campaign_outbox_append",
  ]);
  const outbox = database.committedStatements.find(
    (query) => query.name === "campaign_outbox_append",
  );
  assert.ok(outbox);
  const payload = String(outbox.values[12]);
  assert.equal(outbox.values[14], "sha256");
  assert.equal(
    outbox.values[15],
    `sha256:${createHash("sha256").update(payload).digest("hex")}`,
  );
  assert.notEqual(outbox.values[15], "caller-supplied-integrity");
});

test("replays a retained command result without duplicating state or outbox", async () => {
  const record = await createdRecord();
  const database = new RecordingTransactionManager({
    campaign_command_load: result([
      {
        request_digest: "sha256:create-request-001",
        result: record,
      },
    ]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const replayed = await store.retainMutation(mutationRequest(record));

  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.ok(replayed.ok);
  assert.deepEqual(replayed.value, record);
  assert.deepEqual(database.committedQueries, [
    "workspace_scope_set",
    "campaign_command_load",
  ]);
});

test("retains only the next optimistic campaign revision", async () => {
  const record = await transitionedRecord();
  const database = new RecordingTransactionManager({
    campaign_command_load: result([]),
    campaign_update: result([{ record }]),
    campaign_event_append: result([{}]),
    campaign_command_retain: result([{}]),
    campaign_outbox_append: result([{}]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const retained = await store.retainMutation(transitionMutationRequest(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.equal(retained.value.snapshot.revision, 2);
  assert.equal(retained.value.snapshot.state, "validating");
  assert.ok(database.committedQueries.includes("campaign_update"));
  assert.equal(database.committedQueries.includes("campaign_create"), false);
});

test("resolves a concurrent same-command winner as an idempotent replay", async () => {
  const record = await createdRecord();
  const database = new ConcurrentWinnerTransactionManager(record);
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const retained = await store.retainMutation(mutationRequest(record));

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.ok(retained.ok);
  assert.deepEqual(retained.value, record);
  assert.equal(database.commandLoads, 2);
  assert.equal(database.outboxWrites, 0);
});

test("loads a retained campaign only through its Workspace transaction scope", async () => {
  const record = await createdRecord();
  const database = new RecordingTransactionManager({
    campaign_load: result([{ record }]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const loaded = await store.load({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
  });

  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.value, record);
  assert.deepEqual(database.committedQueries, [
    "workspace_scope_set",
    "campaign_load",
  ]);
});

test("fails closed when retained JSONB does not match campaign identity and shape", async () => {
  const database = new RecordingTransactionManager({
    campaign_load: result([
      {
        record: {
          snapshot: {
            workspace_id: "workspace-evaluation-002",
            campaign_id: "campaign-retained-001",
            revision: "one",
          },
          events: [],
        },
      },
    ]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const loaded = await store.load({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
  });

  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok);
  assert.equal(loaded.failure.code, "persistence_corrupt");
});

test("fails closed when a retained event kind is outside the governed contract", async () => {
  const record = await createdRecord();
  const corrupted = JSON.parse(JSON.stringify(record)) as EvaluationCampaignRecord;
  (corrupted.events[0] as { kind: string }).kind = "forged_campaign_event";
  const database = new RecordingTransactionManager({
    campaign_load: result([{ record: corrupted }]),
  });
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const loaded = await store.load({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
  });

  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok);
  assert.equal(loaded.failure.code, "persistence_corrupt");
});

test("reports unavailable and rolls back when outbox retention fails", async () => {
  const record = await createdRecord();
  const database = new OutboxFailureTransactionManager();
  const store = new PostgresEvaluationCampaignRecordStore({ database });

  const retained = await store.retainMutation(mutationRequest(record));

  assert.equal(retained.ok, false);
  assert.ok(!retained.ok);
  assert.equal(retained.failure.code, "persistence_unavailable");
  assert.equal(database.committed, false);
  assert.equal(database.rolledBack, true);
});

test("rejects a command kind that does not match the retained domain event", async () => {
  const record = await createdRecord();
  const database = new RecordingTransactionManager({});
  const store = new PostgresEvaluationCampaignRecordStore({ database });
  const request = mutationRequest(record);

  const retained = await store.retainMutation({
    ...request,
    command: { ...request.command, kind: "transition" },
  });

  assert.equal(retained.ok, false);
  assert.ok(!retained.ok);
  assert.equal(retained.failure.code, "invalid_request");
  assert.equal(database.transactions, 0);
});

test("normalizes an unknown runtime command kind without throwing", async () => {
  const record = await createdRecord();
  const database = new RecordingTransactionManager({});
  const store = new PostgresEvaluationCampaignRecordStore({ database });
  const request = mutationRequest(record);

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
  committedStatements: PostgresQuery[] = [];

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
    this.committedStatements.push(...pending);
    this.committedQueries.push(...pending.map((query) => query.name));
    return value;
  }
}

class ConcurrentWinnerTransactionManager implements PostgresTransactionManager {
  readonly #record: EvaluationCampaignRecord;
  commandLoads = 0;
  outboxWrites = 0;

  constructor(record: EvaluationCampaignRecord) {
    this.#record = record;
  }

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    return operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
        if (query.name === "campaign_command_load") {
          this.commandLoads += 1;
          return result(
            this.commandLoads === 1
              ? []
              : [{
                  request_digest: "sha256:create-request-001",
                  result: this.#record,
                }],
          ) as PostgresQueryResult<Row>;
        }
        if (query.name === "campaign_create") {
          return result([]) as PostgresQueryResult<Row>;
        }
        if (query.name === "campaign_outbox_append") this.outboxWrites += 1;
        return result([{}]) as PostgresQueryResult<Row>;
      },
    });
  }
}

class OutboxFailureTransactionManager implements PostgresTransactionManager {
  committed = false;
  rolledBack = false;

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    try {
      const value = await operation({
        query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
          if (query.name === "campaign_command_load") {
            return result([]) as PostgresQueryResult<Row>;
          }
          if (query.name === "campaign_outbox_append") {
            throw new Error("simulated outbox write failure");
          }
          return result([{}]) as PostgresQueryResult<Row>;
        },
      });
      this.committed = true;
      return value;
    } catch (error) {
      this.rolledBack = true;
      throw error;
    }
  }
}

function result<Row>(rows: readonly Row[]): PostgresQueryResult<Row> {
  return { row_count: rows.length, rows };
}

async function createdRecord(): Promise<EvaluationCampaignRecord> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    idempotency_key: "create-campaign-retained-001",
    definition: {
      subject: {
        type: "skill",
        id: "assess-requirement-quality",
        version: "0.1.0",
      },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        {
          case_id: "positive-rule-only",
          trial_id: "trial-001",
          attempt_id: "attempt-001",
        },
      ],
    },
  });
  assert.ok(created.ok);
  return created.value;
}

async function transitionedRecord(): Promise<EvaluationCampaignRecord> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create(campaignCreateRequest());
  assert.ok(created.ok);
  const transitioned = await repository.transition({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "transition-validating-001",
    to_state: "validating",
    reason: "definition validation started",
    evidence: ["evidence://definition/validation-started"],
  });
  assert.ok(transitioned.ok);
  return transitioned.value;
}

function mutationRequest(
  record: EvaluationCampaignRecord,
): RetainEvaluationCampaignMutationRequest {
  return {
    record,
    expected_revision: null,
    command: {
      kind: "create",
      idempotency_key: "create-campaign-retained-001",
      request_digest: "sha256:create-request-001",
    },
    outbox: {
      event_id: "event-campaign-created-001",
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence",
      producer_version: "0.1.0",
      correlation_id: "campaign-retained-001",
      causation_id: "create-campaign-retained-001",
      classification: "internal",
    },
  };
}

function transitionMutationRequest(
  record: EvaluationCampaignRecord,
): RetainEvaluationCampaignMutationRequest {
  return {
    record,
    expected_revision: 1,
    command: {
      kind: "transition",
      idempotency_key: "transition-validating-001",
      request_digest: "sha256:transition-validating-001",
    },
    outbox: {
      event_id: "event-campaign-validating-001",
      event_type: "evaluation.campaign.transitioned",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence",
      producer_version: "0.1.0",
      correlation_id: "campaign-retained-001",
      causation_id: "transition-validating-001",
      classification: "internal",
    },
  };
}

function campaignCreateRequest() {
  return {
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    idempotency_key: "create-campaign-retained-001",
    definition: {
      subject: {
        type: "skill" as const,
        id: "assess-requirement-quality",
        version: "0.1.0",
      },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        {
          case_id: "positive-rule-only",
          trial_id: "trial-001",
          attempt_id: "attempt-001",
        },
      ],
    },
  };
}
