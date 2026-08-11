import assert from "node:assert/strict";
import test from "node:test";

import { reviewAcceptanceCriteriaQuality, acQualityPassBlockers } from "../../src/reporting/ac-quality-review.js";
import { buildExpertRiskMatrix, riskMatrixPassBlockers } from "../../src/reporting/expert-risk-matrix.js";
import { detectExpertRiskSignals } from "../../src/reporting/expert-risk-signals.js";
import { deriveExpertChecklist } from "../../src/reporting/expert-checklist.js";

test("AC quality flags missing oracle and vague statement", () => {
  const review = reviewAcceptanceCriteriaQuality([
    { id: "ac-1", statement: "works" },
    { id: "ac-2", statement: "User sees Welcome on the dashboard", expected_text: "Welcome" },
  ]);
  assert.ok(review.finding_count >= 2);
  assert.ok(review.findings.some((f) => f.category === "vague_statement"));
  assert.ok(review.findings.some((f) => f.category === "missing_oracle" && f.id.startsWith("ac-1")));
  assert.ok(acQualityPassBlockers(review).some((b) => b.startsWith("ac_quality:")));
});

test("risk matrix marks API authz exercised only when openapi + api_ran", () => {
  const signals = detectExpertRiskSignals({
    request_context: "API OpenAPI authz for roles",
    requirement_title: "API gate",
    acceptance_criteria: [{ id: "ac-1", statement: "GET /items returns 200 for authorized role" }],
    has_login_fields: true,
  });
  const open = buildExpertRiskMatrix({
    signals,
    hook_coverage: {
      role_compare_ran: false,
      openapi_cases_added: true,
      journey_cases_added: false,
      any_expected_network_on_ac: false,
    },
    extension_executed: { api_ran: false, journey_ran: false },
  });
  const apiRow = open.rows.find((r) => r.id === "risk-api-authz");
  assert.ok(apiRow);
  assert.equal(apiRow!.exercised, false);
  assert.ok(riskMatrixPassBlockers(open).some((b) => b.includes("risk-api-authz")));

  const closed = buildExpertRiskMatrix({
    signals,
    hook_coverage: {
      role_compare_ran: false,
      openapi_cases_added: true,
      journey_cases_added: false,
      any_expected_network_on_ac: false,
    },
    extension_executed: { api_ran: true, journey_ran: false },
  });
  assert.equal(closed.rows.find((r) => r.id === "risk-api-authz")!.exercised, true);
});

test("checklist blocks on risk_matrix and ac_quality prefixes", () => {
  const checklist = deriveExpertChecklist({
    release_recommendation: "recommend_release",
    release_recommendation_rationale: "clean",
    test_cases: [],
    summary: { failed: 0, flaky: 0, not_executed: 0, passed: 2 },
    draft_defect_count: 0,
    coverage_gap_count: 2,
    smart_retest_action: "no_retest_needed",
    suite_id_present: true,
    domain_pack: { present: true, high_risk_unconfirmed: false },
    extra_pass_blockers: ["risk_matrix_p0_open:risk-api-authz", "ac_quality:missing_oracle:ac-1:no_oracle"],
    context: "run_auto_qa",
  });
  assert.equal(checklist["claim_pass_allowed"], false);
  const blockers = checklist["blockers"] as string[];
  assert.ok(blockers.some((b) => b.startsWith("risk_matrix_")));
  assert.ok(blockers.some((b) => b.startsWith("ac_quality:")));
});
