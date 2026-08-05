import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PersistedEvaluationCampaignRepository } from "../../src/evaluation/persisted-evaluation-campaign-repository.js";
import { SqliteEvaluationCampaignRecordStore } from "../../src/evaluation/sqlite-evaluation-campaign-record-store.js";
import type { EvaluationCampaignRecordStore } from "../../src/evaluation/evaluation-campaign-record-store.js";

import { runEvaluationCampaignRepositoryContract } from "./evaluation-campaign-repository-contract.js";

const NOW = "2026-08-03T14:00:00.000Z";
let sequence = 0;

runEvaluationCampaignRepositoryContract("persisted-sqlite", async () => {
  sequence += 1;
  const root = await mkdtemp(join(tmpdir(), `qa-intelligence-repo-contract-${sequence}-`));

  return new PersistedEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
    producer_id: "qa-intelligence-local",
    producer_version: "0.1.0",
    resolve_store(workspaceId): EvaluationCampaignRecordStore {
      return new SqliteEvaluationCampaignRecordStore({
        database_path: join(root, workspaceId, "qa-intelligence.sqlite"),
        workspace_id: workspaceId,
      });
    },
  });
});
