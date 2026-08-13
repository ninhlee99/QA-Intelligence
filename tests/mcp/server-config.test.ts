import assert from "node:assert/strict";
import test from "node:test";

import { loadServerConfig } from "../../src/mcp/server-config.js";

test("production config requires an explicit safe workspace id", () => {
  assert.throws(() => loadServerConfig({}), /QA_INTELLIGENCE_WORKSPACE_ID is required/);
  assert.throws(() => loadServerConfig({ QA_INTELLIGENCE_WORKSPACE_ID: "../unsafe" }), /safe identifier/);
});

test("production config defaults to compact expert profile and state outside the repository", () => {
  const config = loadServerConfig({ QA_INTELLIGENCE_WORKSPACE_ID: "billing-web" });
  assert.equal(config.toolProfile, "expert");
  assert.equal(config.deadlineSeconds, 180);
  assert.match(config.dataDir, /qa-intelligence\/billing-web$/);
});

test("production config rejects relative storage and unbounded deadlines", () => {
  assert.throws(
    () => loadServerConfig({ QA_INTELLIGENCE_WORKSPACE_ID: "billing-web", QA_INTELLIGENCE_DATA_DIR: ".qa" }),
    /absolute path/,
  );
  assert.throws(
    () => loadServerConfig({ QA_INTELLIGENCE_WORKSPACE_ID: "billing-web", QA_INTELLIGENCE_DEADLINE_SECONDS: "3601" }),
    /<= 3600/,
  );
});
