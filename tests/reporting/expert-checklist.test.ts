import assert from "node:assert/strict";
import test from "node:test";

import { deriveExpertChecklist } from "../../src/reporting/expert-checklist.js";

test("claim_pass_allowed false when gate is changes_required", () => {
  const checklist = deriveExpertChecklist({
    release_recommendation: "changes_required",
    release_recommendation_rationale: "failures present",
    test_cases: [],
    summary: { failed: 1, flaky: 0, not_executed: 0, passed: 0 },
    draft_defect_count: 1,
    coverage_gap_count: 2,
    smart_retest_action: "targeted_retest",
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok(Array.isArray(checklist["blockers"]));
  assert.ok((checklist["blockers"] as string[]).some((b) => b.includes("failed") || b.includes("gate")));
});

test("claim_pass_allowed true only for clean recommend_release", () => {
  const checklist = deriveExpertChecklist({
    release_recommendation: "recommend_release",
    release_recommendation_rationale: "clean",
    test_cases: [],
    summary: { failed: 0, flaky: 0, not_executed: 0, passed: 3 },
    draft_defect_count: 0,
    coverage_gap_count: 1,
    smart_retest_action: "no_retest_needed",
    suite_id_present: true,
    context: "run_regression_suite",
  });
  assert.equal(checklist["claim_pass_allowed"], true);
});
