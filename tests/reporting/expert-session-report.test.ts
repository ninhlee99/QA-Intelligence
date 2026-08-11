import assert from "node:assert/strict";
import test from "node:test";

import { draftExpertSessionReport } from "../../src/reporting/expert-session-report.js";
import type { QaRunReport } from "../../src/reporting/qa-run-report.js";

function sampleReport(overrides?: Partial<QaRunReport>): QaRunReport {
  return {
    schema_version: "1.1.0",
    workspace_id: "ws",
    target_url: "https://app.example/pay",
    generated_at: "2026-08-11T00:00:00.000Z",
    requirement_ref: "REQ@1",
    discovery_capture_id: "cap",
    discovery_element_count: 3,
    test_cases: [
      {
        test_case_id: "tc-1",
        purpose: "Pay invoice",
        variant: "positive",
        outcome: "failed",
        evidence: ["shot.png"],
      },
    ],
    generation_findings: [],
    summary: { generated: 1, executed: 1, passed: 0, failed: 1, flaky: 0, not_executed: 0 },
    draft_defects: [
      {
        id: "DEF-DRAFT:tc-1",
        version: "0.1.0",
        status: "draft",
        summary: "[failed] positive: Pay invoice",
        observed_behavior: "failed",
        expected_behavior: "pass",
        expected_behavior_authority: "REQ@1",
        workspace_scope: "ws",
        environment_ref: "env",
        reproduction_conditions: ["open"],
        evidence: ["shot.png"],
        severity: "high",
        severity_rationale: "happy path",
        priority: "p1",
        classification: "product_defect",
        suspected_cause: "regression",
        owner: "unassigned",
      },
    ],
    accessibility_smoke: {
      schema_version: "1.0.0",
      element_count: 3,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      limitations: [],
    },
    variant_coverage: [],
    residual_risks: [],
    release_recommendation: "changes_required",
    release_recommendation_rationale: "failures",
    ...overrides,
  };
}

test("draftExpertSessionReport leads with refuse when claim_pass false", () => {
  const report = sampleReport();
  const session = draftExpertSessionReport({
    report,
    claim_pass_allowed: false,
    blockers: ["failed_cases:1", "gate:changes_required"],
    coverage_gaps: [{ gap: "scope_limits", message: "no pen-test" }],
    risk_signals: {
      needs_roles: false,
      needs_api_authz: false,
      needs_money_oracles: true,
      needs_journeys: false,
      needs_session_login: false,
      signals: ["money/payment language in request/AC"],
    },
    hook_coverage: {
      role_compare_ran: false,
      openapi_cases_added: false,
      journey_cases_added: false,
      any_expected_network_on_ac: false,
    },
    mandate_blockers: [
      {
        code: "e2_money_oracle_weak",
        message: "Money without expected_network",
      },
    ],
  });
  assert.match(session.headline, /NOT ready/i);
  assert.match(session.verdict_paragraph, /refuse/i);
  assert.ok(session.markdown.includes("## Verdict"));
  assert.ok(session.critical_findings.some((f) => f.includes("MANDATE")));
  assert.ok(session.what_was_not_tested.some((t) => /money/i.test(t) || /pen-test/i.test(t) || /G0/i.test(t)));
});
