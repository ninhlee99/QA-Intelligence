import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileQaOperationsMonitor } from "../../src/operations/file-qa-operations-monitor.js";

test("operations monitor persists redacted events and evaluates its failure-rate SLO", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "qa-ops-")), "events.jsonl");
  const monitor = new FileQaOperationsMonitor({ path, max_failure_rate: 0.4 });
  await monitor.record({ event: "run_passed", occurred_at: "2026-08-13T00:00:00.000Z", workspace_id: "ws", detail: "password=hunter2" });
  await monitor.record({ event: "run_failed", occurred_at: "2026-08-13T00:01:00.000Z", workspace_id: "ws", detail: "timeout" });
  const health = await monitor.health();
  assert.equal(health.healthy, false);
  assert.equal(health.failure_rate, 0.5);
  assert.doesNotMatch(await readFile(path, "utf8"), /hunter2/);
});
