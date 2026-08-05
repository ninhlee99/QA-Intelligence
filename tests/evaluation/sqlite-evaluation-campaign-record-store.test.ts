import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  RetainEvaluationCampaignMutationRequest,
} from "../../src/evaluation/evaluation-campaign-record-store.js";
import {
  InMemoryEvaluationCampaignRepository,
  type EvaluationCampaignRecord,
} from "../../src/evaluation/evaluation-campaign-repository.js";
import {
  SqliteEvaluationCampaignRecordStore,
} from "../../src/evaluation/sqlite-evaluation-campaign-record-store.js";

const NOW = "2026-08-03T18:00:00.000Z";
const WORKSPACE_ID = "workspace-local-001";

test("retains and loads a campaign from a user-owned local SQLite file", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "qa-intelligence-sqlite-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, WORKSPACE_ID, "qa-intelligence.sqlite");
  const record = await createdRecord("campaign-local-001");
  const store = new SqliteEvaluationCampaignRecordStore({
    database_path: databasePath,
    workspace_id: WORKSPACE_ID,
  });
  context.after(() => store.close());

  const retained = await store.retainMutation(createMutation(record));
  const loaded = await store.load({
    workspace_id: WORKSPACE_ID,
    campaign_id: "campaign-local-001",
  });

  assert.equal(retained.ok, true, JSON.stringify(retained));
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.ok(loaded.ok);
  assert.deepEqual(loaded.value, record);
  assert.equal((await stat(databasePath)).isFile(), true);
});

async function createdRecord(campaignId: string): Promise<EvaluationCampaignRecord> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create({
    workspace_id: WORKSPACE_ID,
    campaign_id: campaignId,
    actor_id: "evaluation-runner-local-001",
    idempotency_key: `create-${campaignId}`,
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
          trial_id: `trial-${campaignId}`,
          attempt_id: `attempt-${campaignId}`,
        },
      ],
    },
  });
  assert.ok(created.ok);
  return created.value;
}

function createMutation(
  record: EvaluationCampaignRecord,
): RetainEvaluationCampaignMutationRequest {
  return {
    record,
    expected_revision: null,
    command: {
      kind: "create",
      idempotency_key: `create-${record.snapshot.campaign_id}`,
      request_digest: `sha256:create-${record.snapshot.campaign_id}`,
    },
    outbox: {
      event_id: `event-create-${record.snapshot.campaign_id}`,
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence-local",
      producer_version: "0.1.0",
      correlation_id: record.snapshot.campaign_id,
      causation_id: `create-${record.snapshot.campaign_id}`,
      classification: "internal",
    },
  };
}
