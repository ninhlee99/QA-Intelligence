import assert from "node:assert/strict";
import test from "node:test";
import { assessFlakeGovernance } from "../../src/continuous-qa/flake-governance.js";

test("repeated flakes quarantine ordinary tests but block critical journeys", () => {
  assert.equal(assessFlakeGovernance({ case_id: "TC-1", critical: false, recent_outcomes: ["flaky", "passed", "flaky"], owner: "qa" }).action, "quarantine");
  assert.equal(assessFlakeGovernance({ case_id: "TC-C", critical: true, recent_outcomes: ["flaky", "flaky"], owner: "qa" }).action, "block_release");
});

test("quarantine requires an owner and expires", () => {
  const result = assessFlakeGovernance({ case_id: "TC-1", critical: false, recent_outcomes: ["flaky", "flaky"], owner: "" });
  assert.equal(result.action, "block_release");
  assert.equal(assessFlakeGovernance({ case_id: "TC-1", critical: false, recent_outcomes: ["flaky", "flaky"], owner: "qa", quarantine_expires_at: "2026-08-01T00:00:00Z", now: "2026-08-13T00:00:00Z" }).action, "block_release");
});
