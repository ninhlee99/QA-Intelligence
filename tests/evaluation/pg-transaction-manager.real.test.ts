import assert from "node:assert/strict";
import test from "node:test";

import { PgTransactionManager } from "../../src/evaluation/pg-transaction-manager.js";
import { PostgresEvaluationCampaignRecordStore } from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";
import type { EvaluationCampaignRecordStore } from "../../src/evaluation/evaluation-campaign-record-store.js";

import { runEvaluationCampaignRecordStoreContract } from "./record-store-contract.js";

/**
 * Exercises the ADR-012/ADR-017 PostgreSQL adapter against a real PostgreSQL
 * 18 server instead of the in-process FakePostgresTransactionManager used by
 * postgres-evaluation-campaign-record-store.contract.test.ts. Requires
 * QA_INTELLIGENCE_TEST_POSTGRES_URL to point at a database with migration
 * 0001_evaluation_campaign_store.up.sql already applied; skips (does not
 * fail) when unset so `npm test` remains database-free by default.
 */
const CONNECTION_STRING = process.env["QA_INTELLIGENCE_TEST_POSTGRES_URL"];

if (CONNECTION_STRING === undefined || CONNECTION_STRING.trim().length === 0) {
  test(
    "[postgres-real] skipped: QA_INTELLIGENCE_TEST_POSTGRES_URL is not set",
    { skip: true },
    () => {},
  );
} else {
  const connectionString = CONNECTION_STRING;
  let manager: PgTransactionManager;

  runEvaluationCampaignRecordStoreContract("postgres-real", {
    workspace_id: "workspace-contract-postgres-real-001",
    campaign_id: `campaign-contract-postgres-real-${Date.now()}`,
    async makeStore(): Promise<EvaluationCampaignRecordStore> {
      manager = new PgTransactionManager({ connection_string: connectionString });
      return new PostgresEvaluationCampaignRecordStore({ database: manager });
    },
    async closeStore(): Promise<void> {
      await manager.close();
    },
  });

  test("[postgres-real] a concurrent writer cannot silently overwrite a revision", async () => {
    const campaignId = `campaign-concurrency-${Date.now()}`;
    const workspaceId = "workspace-contract-postgres-real-001";
    const managerA = new PgTransactionManager({ connection_string: connectionString });
    const managerB = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeA = new PostgresEvaluationCampaignRecordStore({ database: managerA });
      const storeB = new PostgresEvaluationCampaignRecordStore({ database: managerB });

      const created = await storeA.retainMutation(createMutation(workspaceId, campaignId));
      assert.equal(created.ok, true, JSON.stringify(created));

      // Two independent connections race to transition the same revision.
      // Real Postgres row-level `UPDATE ... WHERE revision = $n` guarantees
      // only one commits; the other observes zero affected rows and the
      // adapter reports stale_revision instead of a silent overwrite.
      const [first, second] = await Promise.all([
        storeA.retainMutation(
          transitionMutation(workspaceId, campaignId, "transition-a"),
        ),
        storeB.retainMutation(
          transitionMutation(workspaceId, campaignId, "transition-b"),
        ),
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

  test("[postgres-real] Row-Level Security denies a query issued without a Workspace scope", async () => {
    const campaignId = `campaign-rls-${Date.now()}`;
    const workspaceId = "workspace-contract-postgres-real-001";
    const manager2 = new PgTransactionManager({ connection_string: connectionString });
    try {
      const store = new PostgresEvaluationCampaignRecordStore({ database: manager2 });
      const created = await store.retainMutation(createMutation(workspaceId, campaignId));
      assert.equal(created.ok, true, JSON.stringify(created));

      // Bypass the adapter's own set_config('qa.workspace_id', ...) call and
      // query the table directly within a fresh transaction that never sets
      // the RLS session variable. PostgreSQL superusers always bypass RLS
      // regardless of FORCE ROW LEVEL SECURITY, so this test — like
      // production — SHALL run as a non-superuser application role for the
      // policy to have any effect; the unscoped read returns zero rows
      // rather than every Workspace's data.
      const unscoped = await manager2.transaction(async (transaction) =>
        transaction.query<{ campaign_id: string }>({
          name: "rls_probe",
          text: "SELECT campaign_id FROM qa_evaluation_campaigns WHERE campaign_id = $1",
          values: [campaignId],
        }),
      );
      assert.equal(unscoped.row_count, 0, JSON.stringify(unscoped));
    } finally {
      await manager2.close();
    }
  });

  test("[postgres-real] state survives a fresh transaction manager (process-restart equivalent)", async () => {
    const campaignId = `campaign-restart-${Date.now()}`;
    const workspaceId = "workspace-contract-postgres-real-001";
    const before = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeBefore = new PostgresEvaluationCampaignRecordStore({ database: before });
      const created = await storeBefore.retainMutation(createMutation(workspaceId, campaignId));
      assert.equal(created.ok, true, JSON.stringify(created));
    } finally {
      await before.close();
    }

    // A new PgTransactionManager with its own connection pool stands in for
    // the parent runtime reconstructing state after a restart (ADR-017 §3):
    // nothing in the prior process's memory is available, only the database.
    const after = new PgTransactionManager({ connection_string: connectionString });
    try {
      const storeAfter = new PostgresEvaluationCampaignRecordStore({ database: after });
      const loaded = await storeAfter.load({ workspace_id: workspaceId, campaign_id: campaignId });
      assert.equal(loaded.ok, true, JSON.stringify(loaded));
      assert.ok(loaded.ok);
      assert.equal(loaded.value.snapshot.campaign_id, campaignId);
      assert.equal(loaded.value.snapshot.revision, 1);
    } finally {
      await after.close();
    }
  });
}

function createMutation(workspaceId: string, campaignId: string) {
  return {
    record: {
      schema_version: "1.0.0" as const,
      snapshot: {
        schema_version: "1.0.0" as const,
        workspace_id: workspaceId,
        campaign_id: campaignId,
        revision: 1,
        state: "draft" as const,
        created_at: "2026-08-05T10:00:00.000Z",
        updated_at: "2026-08-05T10:00:00.000Z",
        definition: {
          subject: { type: "skill" as const, id: "assess-requirement-quality", version: "0.1.0" },
          suite: { id: "requirement-quality-core", version: "0.1.0" },
          resolved_versions: {
            skill: "assess-requirement-quality@0.1.0",
            suite: "requirement-quality-core@0.1.0",
            adapter: "fixture-evaluation-adapter@1.0.0",
          },
          trials: [
            {
              case_id: "positive-rule-only",
              trial_id: `trial-${campaignId}`,
              attempt_id: `attempt-${campaignId}`,
            },
          ],
        },
        trials: [
          {
            case_id: "positive-rule-only",
            trial_id: `trial-${campaignId}`,
            attempt_id: `attempt-${campaignId}`,
            state: "pending" as const,
            effect_state: "none" as const,
            cleanup_completed: false,
          },
        ],
      },
      events: [
        {
          sequence: 1,
          revision: 1,
          kind: "campaign_created" as const,
          from_state: null,
          to_state: "draft" as const,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: "evaluation-runner-contract-001",
          evidence: [],
          occurred_at: "2026-08-05T10:00:00.000Z",
        },
      ],
    },
    expected_revision: null,
    command: {
      kind: "create" as const,
      idempotency_key: `create-${campaignId}`,
      request_digest: `sha256:create-${campaignId}`,
    },
    outbox: {
      event_id: `event-create-${campaignId}`,
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0" as const,
      producer_id: "qa-intelligence-contract",
      producer_version: "0.1.0",
      correlation_id: campaignId,
      causation_id: `create-${campaignId}`,
      classification: "internal",
    },
  };
}

function transitionMutation(workspaceId: string, campaignId: string, idempotencyKey: string) {
  return {
    record: {
      schema_version: "1.0.0" as const,
      snapshot: {
        schema_version: "1.0.0" as const,
        workspace_id: workspaceId,
        campaign_id: campaignId,
        revision: 2,
        state: "validating" as const,
        created_at: "2026-08-05T10:00:00.000Z",
        updated_at: "2026-08-05T10:00:01.000Z",
        definition: {
          subject: { type: "skill" as const, id: "assess-requirement-quality", version: "0.1.0" },
          suite: { id: "requirement-quality-core", version: "0.1.0" },
          resolved_versions: {
            skill: "assess-requirement-quality@0.1.0",
            suite: "requirement-quality-core@0.1.0",
            adapter: "fixture-evaluation-adapter@1.0.0",
          },
          trials: [
            {
              case_id: "positive-rule-only",
              trial_id: `trial-${campaignId}`,
              attempt_id: `attempt-${campaignId}`,
            },
          ],
        },
        trials: [
          {
            case_id: "positive-rule-only",
            trial_id: `trial-${campaignId}`,
            attempt_id: `attempt-${campaignId}`,
            state: "pending" as const,
            effect_state: "none" as const,
            cleanup_completed: false,
          },
        ],
      },
      events: [
        {
          sequence: 1,
          revision: 1,
          kind: "campaign_created" as const,
          from_state: null,
          to_state: "draft" as const,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: "evaluation-runner-contract-001",
          evidence: [],
          occurred_at: "2026-08-05T10:00:00.000Z",
        },
        {
          sequence: 2,
          revision: 2,
          kind: "campaign_transitioned" as const,
          from_state: "draft" as const,
          to_state: "validating" as const,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: "evaluation-runner-contract-001",
          evidence: ["evidence://definition/validation-started"],
          occurred_at: "2026-08-05T10:00:01.000Z",
        },
      ],
    },
    expected_revision: 1,
    command: {
      kind: "transition" as const,
      idempotency_key: `${idempotencyKey}-${campaignId}`,
      request_digest: `sha256:${idempotencyKey}-${campaignId}`,
    },
    outbox: {
      event_id: `event-${idempotencyKey}-${campaignId}`,
      event_type: "evaluation.campaign.transitioned",
      schema_version: "1.0.0" as const,
      producer_id: "qa-intelligence-contract",
      producer_version: "0.1.0",
      correlation_id: campaignId,
      causation_id: `${idempotencyKey}-${campaignId}`,
      classification: "internal",
    },
  };
}
