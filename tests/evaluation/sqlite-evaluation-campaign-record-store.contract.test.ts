import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEvaluationCampaignRecordStore } from "../../src/evaluation/sqlite-evaluation-campaign-record-store.js";

import { runEvaluationCampaignRecordStoreContract } from "./record-store-contract.js";

const WORKSPACE_ID = "workspace-contract-sqlite-001";
let sequence = 0;

runEvaluationCampaignRecordStoreContract("sqlite", {
  workspace_id: WORKSPACE_ID,
  campaign_id: "campaign-contract-sqlite-001",
  async makeStore(workspaceId) {
    sequence += 1;
    const root = await mkdtemp(join(tmpdir(), "qa-intelligence-sqlite-contract-"));
    const databasePath = join(root, `${workspaceId}-${sequence}`, "qa-intelligence.sqlite");
    return new SqliteEvaluationCampaignRecordStore({
      database_path: databasePath,
      workspace_id: WORKSPACE_ID,
    });
  },
  closeStore(store) {
    (store as SqliteEvaluationCampaignRecordStore).close();
  },
});
