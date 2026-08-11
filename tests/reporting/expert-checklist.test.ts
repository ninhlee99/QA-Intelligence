import assert from "node:assert/strict";
import test from "node:test";

import { deriveExpertChecklist, validateExpertClaim } from "../../src/reporting/expert-checklist.js";

const cleanBase = {
  release_recommendation: "recommend_release" as const,
  release_recommendation_rationale: "clean",
  test_cases: [],
  summary: { failed: 0, flaky: 0, not_executed: 0, passed: 3 },
  draft_defect_count: 0,
  coverage_gap_count: 1,
  smart_retest_action: "no_retest_needed",
  suite_id_present: true,
  domain_pack: { present: true, high_risk_unconfirmed: false },
  context: "run_regression_suite" as const,
};

test("claim_pass_allowed false when gate is changes_required", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    release_recommendation: "changes_required",
    release_recommendation_rationale: "failures present",
    summary: { failed: 1, flaky: 0, not_executed: 0, passed: 0 },
    draft_defect_count: 1,
    coverage_gap_count: 2,
    smart_retest_action: "targeted_retest",
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).some((b) => b.includes("failed") || b.includes("gate")));
});

test("claim_pass_allowed true only for clean recommend_release with pack+suite", () => {
  const checklist = deriveExpertChecklist(cleanBase);
  assert.equal(checklist["claim_pass_allowed"], true);
});

test("claim_pass_allowed false when not_executed > 0", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    summary: { failed: 0, flaky: 0, not_executed: 2, passed: 1 },
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).some((b) => b.startsWith("not_executed_")));
});

test("claim_pass_allowed false when coverage_gaps empty", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    coverage_gap_count: 0,
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).includes("coverage_gaps_empty_unexpected"));
});

test("claim_pass_allowed false when domain pack absent", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    domain_pack: { present: false, high_risk_unconfirmed: false },
    context: "run_expert_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).some((b) => b.startsWith("domain_pack_absent")));
});

test("claim_pass_allowed false when high-risk domain unconfirmed", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    domain_pack: { present: true, high_risk_unconfirmed: true },
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).includes("domain_high_risk_unconfirmed"));
});

test("claim_pass_allowed true when high-risk confirmed by host", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    domain_pack: { present: true, high_risk_unconfirmed: true, high_risk_confirmed: true },
  });
  assert.equal(checklist["claim_pass_allowed"], true);
});

test("claim_pass_allowed false when suite missing on run_auto_qa", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    suite_id_present: false,
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).includes("suite_missing"));
});

test("validateExpertClaim refuses pass-like wording when checklist false", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    release_recommendation: "changes_required",
    summary: { failed: 1, flaky: 0, not_executed: 0, passed: 0 },
    draft_defect_count: 1,
  });
  const result = validateExpertClaim({
    proposed_claim: "Looks good — ready to ship",
    expert_checklist: checklist,
  });
  assert.equal(result.allowed, false);
  assert.match(result.refuse_reason ?? "", /REFUSE/);
});

test("validateExpertClaim allows negated blocked wording", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    release_recommendation: "changes_required",
    summary: { failed: 1, flaky: 0, not_executed: 0, passed: 0 },
    draft_defect_count: 1,
  });
  const result = validateExpertClaim({
    proposed_claim: "Do not pass — failures remain.",
    expert_checklist: checklist,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.normalized_claim_kind, "blocked_or_other");
});

test("e2 mandate blockers refuse claim_pass", () => {
  const checklist = deriveExpertChecklist({
    ...cleanBase,
    e2_mandate_blockers: ["e2_roles_not_exercised"],
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok((checklist["blockers"] as string[]).some((b) => b.startsWith("e2_")));
});
