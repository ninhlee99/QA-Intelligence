import assert from "node:assert/strict";
import test from "node:test";
import { QaExecutionKillSwitch, QaOperationsMonitor, assessQaProductionReadiness } from "../../src/observability/qa-operations.js";

test("kill switch fails closed and monitor exposes operational counters", () => {
  assert.equal(new QaExecutionKillSwitch(() => "incident-42").state().disabled, true);
  assert.equal(new QaExecutionKillSwitch(() => "false").state().disabled, false);
  const monitor = new QaOperationsMonitor(); monitor.record("run_failed"); monitor.record("retry");
  assert.equal(monitor.snapshot().failure_rate, 1);
});

test("production readiness requires every explicit gate", () => {
  const base = { security: true, evidence_lifecycle: true, resumable_recovery: true, chaos_benchmark: true, browser_parity: true, monitoring: true, kill_switch: true, rollback: true, incident_owner: true, token_budget: true };
  assert.equal(assessQaProductionReadiness(base).ready, true);
  assert.deepEqual(assessQaProductionReadiness({ ...base, rollback: false }).blockers, ["rollback"]);
});
