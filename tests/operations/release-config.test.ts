import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadReleaseConfig } from "../../src/operations/release-config.js";

test("production config loads explicit operational ownership and evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-release-config-"));
  const path = join(root, "release.json");
  await writeFile(path, JSON.stringify({ schema_version: "1.0.0", environment: "production", monitoring: { sink: "file", target: ".qa-operations/events.jsonl", max_failure_rate: 0.05 }, kill_switch: { environment_key: "QA_INTELLIGENCE_EXECUTION_DISABLED" }, incident_owner: "qa-oncall", rollback_plan_ref: "runbook:rollback@1.0.0", security_approval_ref: "security-review:2026-08", canary_percent: 10 }), "utf8");
  const result = await loadReleaseConfig(path);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.canary_percent, 10);
});

test("production config fails closed on absent attestations or inline secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-release-config-"));
  const path = join(root, "invalid.json");
  await writeFile(path, JSON.stringify({ schema_version: "1.0.0", environment: "production", monitoring: { sink: "https", target: "https://token:secret@example.test" } }), "utf8");
  const result = await loadReleaseConfig(path);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.failure.reasons.includes("monitoring.target must not contain inline credentials"));
});
