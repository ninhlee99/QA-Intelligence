import { PostgresEvaluationCampaignRecordStore } from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";

import { FakePostgresTransactionManager } from "./fake-postgres-transaction-manager.js";
import { runEvaluationCampaignRecordStoreContract } from "./record-store-contract.js";

runEvaluationCampaignRecordStoreContract("postgres", {
  workspace_id: "workspace-contract-postgres-001",
  campaign_id: "campaign-contract-postgres-001",
  makeStore: () =>
    new PostgresEvaluationCampaignRecordStore({
      database: new FakePostgresTransactionManager(),
    }),
});
