import assert from "node:assert/strict";
import test from "node:test";

import type { Defect } from "../../src/bug-analysis/public.js";
import {
  buildProfessionalQaAnalysis,
  buildVariantCoverage,
} from "../../src/reporting/qa-professional-analysis.js";
import { summarizeQaRunTestCases, type QaRunTestCaseResult } from "../../src/reporting/qa-run-report.js";

function tc(overrides: Partial<QaRunTestCaseResult> = {}): QaRunTestCaseResult {
  return {
    test_case_id: "tc-1",
    purpose: "purpose",
    variant: "positive",
    outcome: "passed",
    evidence: [],
    ...overrides,
  };
}

function defect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "DEF-DRAFT:tc-1",
    version: "0.1.0",
    status: "draft",
    summary: "fail",
    observed_behavior: "observed",
    expected_behavior: "expected",
    expected_behavior_authority: "REQ-1",
    workspace_scope: "ws",
    environment_ref: "env",
    reproduction_conditions: ["step"],
    evidence: ["e1"],
    severity: "high",
    severity_rationale: "rationale",
    priority: "p1",
    classification: "product_defect",
    owner: "unassigned",
    ...overrides,
  };
}

test("buildVariantCoverage aggregates per variant", () => {
  const rows = buildVariantCoverage([
    tc({ variant: "positive", outcome: "passed" }),
    tc({ test_case_id: "tc-2", variant: "positive", outcome: "failed" }),
    tc({ test_case_id: "tc-3", variant: "adversarial", outcome: "failed" }),
  ]);

  assert.deepEqual(rows, [
    { variant: "adversarial", generated: 1, passed: 0, failed: 1, flaky: 0, not_executed: 0 },
    { variant: "positive", generated: 2, passed: 1, failed: 1, flaky: 0, not_executed: 0 },
  ]);
});

test("buildProfessionalQaAnalysis recommends do_not_release on security draft defects", () => {
  const testCases = [tc({ outcome: "failed", variant: "adversarial" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [],
    draft_defects: [defect({ classification: "security_incident", severity: "critical", priority: "p0" })],
    summary: summarizeQaRunTestCases(testCases),
  });

  assert.equal(analysis.release_recommendation, "do_not_release");
  assert.ok(analysis.residual_risks.some((r) => r.id === "residual-security"));
});

test("buildProfessionalQaAnalysis recommends changes_required on hard fails without security class", () => {
  const testCases = [tc({ outcome: "failed", variant: "positive" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [],
    draft_defects: [defect()],
    summary: summarizeQaRunTestCases(testCases),
  });

  assert.equal(analysis.release_recommendation, "changes_required");
});

test("buildProfessionalQaAnalysis recommends pass_with_gaps when passes but unbound AC remain", () => {
  const testCases = [tc({ outcome: "passed" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [
      { id: "finding-1", category: "unbindable_criterion", message: "AC-2 unbound", evidence: [] },
    ],
    draft_defects: [],
    summary: summarizeQaRunTestCases(testCases),
  });

  assert.equal(analysis.release_recommendation, "pass_with_gaps");
  assert.ok(analysis.residual_risks.some((r) => r.id === "residual-unbindable-ac"));
});

test("buildProfessionalQaAnalysis recommends recommend_release on a clean executed run", () => {
  const testCases = [tc({ outcome: "passed" }), tc({ test_case_id: "tc-2", variant: "negative", outcome: "passed" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [],
    draft_defects: [],
    summary: summarizeQaRunTestCases(testCases),
  });

  assert.equal(analysis.release_recommendation, "recommend_release");
  assert.ok(analysis.residual_risks.some((r) => r.id === "residual-scope-limit"));
});

test("buildProfessionalQaAnalysis recommends investigate_flakes when only flakes remain", () => {
  const testCases = [tc({ outcome: "flaky" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [],
    draft_defects: [defect({ classification: "automation_defect", severity: "medium", priority: "p2" })],
    summary: summarizeQaRunTestCases(testCases),
  });

  assert.equal(analysis.release_recommendation, "investigate_flakes");
});

test("buildProfessionalQaAnalysis recommends changes_required on critical a11y naming findings", () => {
  const testCases = [tc({ outcome: "passed" })];
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings: [],
    draft_defects: [],
    summary: summarizeQaRunTestCases(testCases),
    accessibility_smoke: {
      schema_version: "1.0.0",
      element_count: 2,
      findings: [
        {
          id: "a11y-missing:f1",
          category: "unlabeled_editable_field",
          severity: "critical",
          message: "unlabeled",
          evidence: [],
          element_ids: ["f1"],
        },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      limitations: [],
    },
  });

  assert.equal(analysis.release_recommendation, "changes_required");
  assert.ok(analysis.residual_risks.some((r) => r.id === "residual-a11y-naming"));
});
