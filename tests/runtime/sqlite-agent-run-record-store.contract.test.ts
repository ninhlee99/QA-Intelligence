import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteAgentRunRecordStore } from "../../src/runtime/sqlite-agent-run-record-store.js";

import { runAgentRunRecordStoreContract } from "./agent-run-record-store-contract.js";

const WORKSPACE_ID = "workspace-contract-run-sqlite-001";
let sequence = 0;

runAgentRunRecordStoreContract("sqlite", {
  workspace_id: WORKSPACE_ID,
  run_id: "run-contract-sqlite-001",
  async makeStore(workspaceId) {
    sequence += 1;
    const root = await mkdtemp(join(tmpdir(), "qa-intelligence-run-sqlite-contract-"));
    const databasePath = join(root, `${workspaceId}-${sequence}`, "qa-intelligence.sqlite");
    return new SqliteAgentRunRecordStore({
      database_path: databasePath,
      workspace_id: WORKSPACE_ID,
    });
  },
  closeStore(store) {
    (store as SqliteAgentRunRecordStore).close();
  },
});
