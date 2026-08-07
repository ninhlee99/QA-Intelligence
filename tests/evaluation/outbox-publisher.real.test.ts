import assert from "node:assert/strict";
import test from "node:test";

import { PgTransactionManager } from "../../src/evaluation/pg-transaction-manager.js";
import { PostgresOutboxPublisher } from "../../src/evaluation/postgres-outbox-publisher.js";
import { PostgresEvaluationCampaignRecordStore } from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";
import { InMemoryEvaluationCampaignRepository } from "../../src/evaluation/evaluation-campaign-repository.js";
import type { RetainEvaluationCampaignMutationRequest } from "../../src/evaluation/evaluation-campaign-record-store.js";

/**
 * Exercises the ADR-012 §7 / SPEC-505 §7 outbox worker against a real
 * PostgreSQL 18 server: producer commit through
 * PostgresEvaluationCampaignRecordStore (application role, RLS-scoped),
 * then claim/publish/dead-letter through PostgresOutboxPublisher running
 * under the dedicated qa_intelligence_outbox_worker role (platform-level,
 * table-wide access per migration 0003_outbox_dead_letter). Requires
 * QA_INTELLIGENCE_TEST_POSTGRES_URL (application role) and
 * QA_INTELLIGENCE_TEST_POSTGRES_OUTBOX_WORKER_URL (worker role) with
 * migrations 0001-0003 already applied; skips when either is unset so
 * `npm test` remains database-free by default.
 */
const APP_CONNECTION_STRING = process.env["QA_INTELLIGENCE_TEST_POSTGRES_URL"];
const WORKER_CONNECTION_STRING =
  process.env["QA_INTELLIGENCE_TEST_POSTGRES_OUTBOX_WORKER_URL"];

if (
  APP_CONNECTION_STRING === undefined ||
  APP_CONNECTION_STRING.trim().length === 0 ||
  WORKER_CONNECTION_STRING === undefined ||
  WORKER_CONNECTION_STRING.trim().length === 0
) {
  test(
    "[outbox-postgres-real] skipped: QA_INTELLIGENCE_TEST_POSTGRES_URL or " +
      "QA_INTELLIGENCE_TEST_POSTGRES_OUTBOX_WORKER_URL is not set",
    { skip: true },
    () => {},
  );
} else {
  const appConnectionString = APP_CONNECTION_STRING;
  const workerConnectionString = WORKER_CONNECTION_STRING;

  test("[outbox-postgres-real] a committed campaign creation is claimable, then publishable, by the worker role", async () => {
    const workspaceId = "workspace-outbox-real-001";
    const campaignId = `campaign-outbox-real-${Date.now()}`;
    const appManager = new PgTransactionManager({ connection_string: appConnectionString });
    const workerManager = new PgTransactionManager({ connection_string: workerConnectionString });
    try {
      const producer = new PostgresEvaluationCampaignRecordStore({ database: appManager });
      const committed = await producer.retainMutation(
        await createMutation(workspaceId, campaignId),
      );
      assert.equal(committed.ok, true, JSON.stringify(committed));

      // The outbox is a shared, platform-level table: other suites running
      // concurrently against the same test database may leave older
      // unpublished rows ahead of this one in claim order. A real worker
      // drains its queue across many claim rounds rather than assuming its
      // own event is in the very first batch — mirror that here instead of
      // asserting on one bounded claimBatch call, which would be flaky
      // under concurrent test suites sharing this database.
      const worker = new PostgresOutboxPublisher({ database: workerManager });
      let record: { event_id: string } | undefined;
      let leaseToken: string | undefined;
      for (let round = 0; round < 50 && record === undefined; round += 1) {
        const claimed = await worker.claimBatch({
          max_batch_size: 25,
          lease_duration_seconds: 30,
          max_attempts: 5,
        });
        assert.equal(claimed.ok, true, JSON.stringify(claimed));
        assert.ok(claimed.ok);
        if (claimed.value.records.length === 0) break;
        const found = claimed.value.records.find(
          (candidate) => candidate.aggregate_id === campaignId,
        );
        if (found !== undefined) {
          record = found;
          leaseToken = claimed.value.lease_token;
          break;
        }
        // Not our event in this batch — publish it out of the way (a real
        // worker would do the same for any other producer's event) so the
        // next round's claim makes forward progress instead of reclaiming
        // the same already-leased rows.
        for (const other of claimed.value.records) {
          await worker.markPublished({
            lease_token: claimed.value.lease_token,
            event_id: other.event_id,
          });
        }
      }
      assert.ok(
        record !== undefined && leaseToken !== undefined,
        "the committed campaign_created event must be claimable by the worker role",
      );

      const published = await worker.markPublished({
        lease_token: leaseToken,
        event_id: record.event_id,
      });
      assert.equal(published.ok, true, JSON.stringify(published));
      assert.ok(published.ok);
      assert.equal(published.value, "published");
    } finally {
      await appManager.close();
      await workerManager.close();
    }
  });

  test("[outbox-postgres-real] two workers racing to claim the same batch never claim the same event twice", async () => {
    const workspaceId = "workspace-outbox-real-001";
    const campaignId = `campaign-outbox-race-${Date.now()}`;
    const appManager = new PgTransactionManager({ connection_string: appConnectionString });
    const workerManagerA = new PgTransactionManager({ connection_string: workerConnectionString });
    const workerManagerB = new PgTransactionManager({ connection_string: workerConnectionString });
    try {
      const producer = new PostgresEvaluationCampaignRecordStore({ database: appManager });
      const committed = await producer.retainMutation(
        await createMutation(workspaceId, campaignId),
      );
      assert.equal(committed.ok, true, JSON.stringify(committed));

      const workerA = new PostgresOutboxPublisher({ database: workerManagerA });
      const workerB = new PostgresOutboxPublisher({ database: workerManagerB });

      // FOR UPDATE SKIP LOCKED (ADR-012 §7 concurrent work-claim) SHALL let
      // two workers partition a claim batch instead of double-claiming the
      // same row; with only one matching row here, exactly one of the two
      // concurrent claims should see it.
      const [claimA, claimB] = await Promise.all([
        workerA.claimBatch({ max_batch_size: 10, lease_duration_seconds: 30, max_attempts: 5 }),
        workerB.claimBatch({ max_batch_size: 10, lease_duration_seconds: 30, max_attempts: 5 }),
      ]);
      assert.ok(claimA.ok && claimB.ok, JSON.stringify([claimA, claimB]));

      const claimedIds = new Set([
        ...(claimA.ok ? claimA.value.records.map((r) => r.event_id) : []),
        ...(claimB.ok ? claimB.value.records.map((r) => r.event_id) : []),
      ]);
      const totalClaimed =
        (claimA.ok ? claimA.value.records.length : 0) + (claimB.ok ? claimB.value.records.length : 0);
      assert.equal(
        claimedIds.size,
        totalClaimed,
        "no event may appear in both workers' claimed batches",
      );
    } finally {
      await appManager.close();
      await workerManagerA.close();
      await workerManagerB.close();
    }
  });

  test("[outbox-postgres-real] the application role cannot see or claim outbox rows outside its own Workspace query scope", async () => {
    const workspaceId = "workspace-outbox-real-001";
    const campaignId = `campaign-outbox-rls-${Date.now()}`;
    const appManager = new PgTransactionManager({ connection_string: appConnectionString });
    try {
      const producer = new PostgresEvaluationCampaignRecordStore({ database: appManager });
      const committed = await producer.retainMutation(
        await createMutation(workspaceId, campaignId),
      );
      assert.equal(committed.ok, true, JSON.stringify(committed));

      // The application role's transactions always scope to one Workspace
      // (PostgresEvaluationCampaignRecordStore calls set_config before every
      // query); a raw cross-Workspace outbox scan issued under that same
      // role, without ever setting a matching scope, SHALL see nothing —
      // only the dedicated worker role (migration 0003) bypasses this.
      const unscoped = await appManager.transaction(async (transaction) =>
        transaction.query<{ event_id: string }>({
          name: "rls_probe_outbox",
          text: "SELECT event_id FROM qa_platform_outbox WHERE aggregate_id = $1",
          values: [campaignId],
        }),
      );
      assert.equal(unscoped.row_count, 0, JSON.stringify(unscoped));
    } finally {
      await appManager.close();
    }
  });
}

async function createMutation(
  workspaceId: string,
  campaignId: string,
): Promise<RetainEvaluationCampaignMutationRequest> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date() },
  });
  const created = await repository.create({
    workspace_id: workspaceId,
    campaign_id: campaignId,
    actor_id: "evaluation-runner-outbox-real-001",
    idempotency_key: `create-${campaignId}`,
    definition: {
      subject: { type: "skill", id: "assess-requirement-quality", version: "0.1.0" },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        { case_id: "positive-rule-only", trial_id: `trial-${campaignId}`, attempt_id: `attempt-${campaignId}` },
      ],
    },
  });
  assert.ok(created.ok, JSON.stringify(created));
  const record = created.ok ? created.value : (() => { throw new Error("unreachable"); })();
  return {
    record,
    expected_revision: null,
    command: {
      kind: "create",
      idempotency_key: `create-${campaignId}`,
      request_digest: `sha256:create-${campaignId}`,
    },
    outbox: {
      event_id: `event-create-${campaignId}`,
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence-outbox-real",
      producer_version: "0.1.0",
      correlation_id: campaignId,
      causation_id: `create-${campaignId}`,
      classification: "internal",
    },
  };
}
