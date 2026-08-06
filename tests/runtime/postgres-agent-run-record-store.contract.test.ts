import { PostgresAgentRunRecordStore } from "../../src/runtime/postgres-agent-run-record-store.js";

import { FakePostgresTransactionManager } from "./fake-postgres-transaction-manager.js";
import { runAgentRunRecordStoreContract } from "./agent-run-record-store-contract.js";

runAgentRunRecordStoreContract("postgres", {
  workspace_id: "workspace-contract-run-postgres-001",
  run_id: "run-contract-postgres-001",
  makeStore: () =>
    new PostgresAgentRunRecordStore({
      database: new FakePostgresTransactionManager(),
    }),
});
