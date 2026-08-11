import assert from "node:assert/strict";
import test from "node:test";

import { reviewAcceptanceCriteriaQuality, acQualityPassBlockers } from "../../src/reporting/ac-quality-review.js";
import { buildExpertRiskMatrix, riskMatrixPassBlockers } from "../../src/reporting/expert-risk-matrix.js";
import { detectExpertRiskSignals } from "../../src/reporting/expert-risk-signals.js";
import { deriveExpertChecklist } from "../../src/reporting/expert-checklist.js";
import {
  assessAcOracleStrength,
  buildExpertJudgment,
  oracleStrengthPassBlockers,
} from "../../src/reporting/expert-judgment.js";
import type { QaRunReport } from "../../src/reporting/qa-run-report.js";

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

test("oracle strength rates network coupling as strong", () => {
  const rows = assessAcOracleStrength([
    {
      id: "ac-strong",
      statement: "After submit the user lands on dashboard and API records the save",
      expected_text: "Dashboard",
      expected_network: { url_includes: "/save", method: "POST", status: 200 },
    },
    { id: "ac-none", statement: "works somehow" },
  ]);
  assert.equal(rows.find((r) => r.ac_id === "ac-strong")?.strength, "strong");
  assert.equal(rows.find((r) => r.ac_id === "ac-none")?.strength, "none");
  assert.ok(
    oracleStrengthPassBlockers({ oracle_strength: { rows, weak_or_none_count: 1, strong_count: 1 } }).some((b) =>
      b.includes("ac-none"),
    ),
  );
});

test("expert judgment emits charter, confidence, stopping, next exploratory", () => {
  const report = {
    schema_version: "1.1.0",
    workspace_id: "ws",
    target_url: "https://example.test/app",
    generated_at: new Date().toISOString(),
    requirement_ref: "req:1",
    discovery_capture_id: "cap-1",
    discovery_element_count: 4,
    test_cases: [],
    generation_findings: [],
    summary: { generated: 2, executed: 2, passed: 2, failed: 0, flaky: 0, not_executed: 0 },
    draft_defects: [],
    accessibility_smoke: {
      schema_version: "1.0.0",
      element_count: 4,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      limitations: [],
    },
    variant_coverage: [],
    residual_risks: [],
    release_recommendation: "recommend_release",
    release_recommendation_rationale: "clean",
  } as unknown as QaRunReport;

  const signals = detectExpertRiskSignals({
    requirement_title: "Checkout journey with payment",
    acceptance_criteria: [
      {
        id: "ac-1",
        statement: "User completes checkout journey and payment confirms",
        expected_text: "Paid",
        expected_network: { url_includes: "/pay", status: 200 },
      },
    ],
  });
  const matrix = buildExpertRiskMatrix({
    signals,
    hook_coverage: {
      role_compare_ran: false,
      openapi_cases_added: false,
      journey_cases_added: false,
      any_expected_network_on_ac: true,
    },
  });
  const ac = reviewAcceptanceCriteriaQuality([
    {
      id: "ac-1",
      statement: "User completes checkout journey and payment confirms",
      expected_text: "Paid",
      expected_network: { url_includes: "/pay", status: 200 },
    },
  ]);
  const judgment = buildExpertJudgment({
    report,
    risk_signals: signals,
    hook_coverage: {
      role_compare_ran: false,
      openapi_cases_added: false,
      journey_cases_added: false,
      any_expected_network_on_ac: true,
    },
    mandate_blockers: [],
    risk_matrix: matrix,
    ac_quality: ac,
    acceptance_criteria: [
      {
        id: "ac-1",
        statement: "User completes checkout journey and payment confirms",
        expected_text: "Paid",
        expected_network: { url_includes: "/pay", status: 200 },
      },
    ],
    domain_pack: { present: true, high_risk_unconfirmed: false },
    claim_pass_allowed: true,
  });
  assert.ok(judgment.charter.mission.includes("Senior Expert"));
  assert.ok(judgment.confidence.score_0_to_100 <= 85);
  assert.equal(judgment.stopping.stop_automation_loop, true);
  assert.ok(judgment.next_exploratory_charter !== null);
  assert.match(judgment.senior_verdict_line, /Human release_signoff/i);
});
