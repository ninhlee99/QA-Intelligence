import assert from "node:assert/strict";
import test from "node:test";
import { assessCanaryRecovery, assessReleaseCandidate } from "../../src/operations/release-candidate-gate.js";

test("canary gate requires rollback when failure threshold is exceeded", () => {
  assert.equal(assessCanaryRecovery({ observation: { total: 10, failed: 2, rollback_triggered: false, restoration_seconds: null, semantic_verification_passed: true }, max_failure_rate: 0.05, max_restoration_seconds: 300 }).passed, false);
  assert.equal(assessCanaryRecovery({ observation: { total: 10, failed: 2, rollback_triggered: true, restoration_seconds: 120, semantic_verification_passed: true }, max_failure_rate: 0.05, max_restoration_seconds: 300 }).passed, true);
});

test("release candidate requires every machine and human-evidence gate", () => {
  const all = { regression: true, resilience: true, browser_parity: true, production_config: true, monitoring_healthy: true, attestations: true, canary_recovery: true };
  assert.equal(assessReleaseCandidate(all).ready, true);
  assert.deepEqual(assessReleaseCandidate({ ...all, attestations: false }).blockers, ["attestations"]);
});
