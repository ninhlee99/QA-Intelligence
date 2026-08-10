import assert from "node:assert/strict";
import test from "node:test";

import {
  renderQaRunReportHtml,
  summarizeQaRunTestCases,
  type QaRunReport,
  type QaRunTestCaseResult,
} from "../../src/reporting/qa-run-report.js";
import { buildProfessionalQaAnalysis } from "../../src/reporting/qa-professional-analysis.js";

function testCase(overrides: Partial<QaRunTestCaseResult> = {}): QaRunTestCaseResult {
  return {
    test_case_id: "test-case-1",
    purpose: "Validate sign in.",
    variant: "positive",
    outcome: "passed",
    evidence: ["capture:abc"],
    ...overrides,
  };
}

function emptyA11y() {
  return {
    schema_version: "1.0.0" as const,
    element_count: 4,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    limitations: ["smoke only"],
  };
}

function report(testCases: readonly QaRunTestCaseResult[], extras: Partial<QaRunReport> = {}): QaRunReport {
  const summary = summarizeQaRunTestCases(testCases);
  const generation_findings = extras.generation_findings ?? [];
  const draft_defects = extras.draft_defects ?? [];
  const accessibility_smoke = extras.accessibility_smoke ?? emptyA11y();
  const analysis = buildProfessionalQaAnalysis({
    test_cases: testCases,
    generation_findings,
    draft_defects,
    summary,
    accessibility_smoke,
  });
  return {
    schema_version: "1.1.0",
    workspace_id: "workspace-001",
    target_url: "https://example.com/login",
    generated_at: "2026-08-07T09:00:00.000Z",
    requirement_ref: "REQ-001@1.0.0",
    discovery_capture_id: "capture:discovery:001",
    discovery_element_count: 4,
    test_cases: testCases,
    generation_findings,
    summary,
    draft_defects,
    accessibility_smoke,
    variant_coverage: analysis.variant_coverage,
    residual_risks: analysis.residual_risks,
    release_recommendation: analysis.release_recommendation,
    release_recommendation_rationale: analysis.release_recommendation_rationale,
    ...extras,
  };
}

test("summarizeQaRunTestCases counts each outcome bucket correctly, treating cancelled as a failure and everything else as not_executed", () => {
  const summary = summarizeQaRunTestCases([
    testCase({ outcome: "passed" }),
    testCase({ outcome: "passed" }),
    testCase({ outcome: "failed" }),
    testCase({ outcome: "cancelled" }),
    testCase({ outcome: "not_executed", skip_reason: "no generated assertion" }),
  ]);

  assert.deepEqual(summary, { generated: 5, executed: 4, passed: 2, failed: 2, flaky: 0, not_executed: 1 });
});

test("summarizeQaRunTestCases counts flaky separately from both passed and failed", () => {
  const summary = summarizeQaRunTestCases([
    testCase({ outcome: "passed" }),
    testCase({ outcome: "flaky" }),
    testCase({ outcome: "flaky" }),
    testCase({ outcome: "failed" }),
  ]);

  assert.deepEqual(summary, { generated: 4, executed: 4, passed: 1, failed: 1, flaky: 2, not_executed: 0 });
});

test("summarizeQaRunTestCases on an empty result set reports all-zero counts, not a fabricated pass", () => {
  assert.deepEqual(summarizeQaRunTestCases([]), { generated: 0, executed: 0, passed: 0, failed: 0, flaky: 0, not_executed: 0 });
});

test("renderQaRunReportHtml produces a self-contained document carrying the report's summary counts, target, and every test case row", () => {
  const value = report([
    testCase({ test_case_id: "tc-1", variant: "positive", outcome: "passed" }),
    testCase({ test_case_id: "tc-2", variant: "negative", outcome: "failed", evidence: ["capture:def"] }),
    testCase({ test_case_id: "tc-3", variant: "boundary", outcome: "not_executed", skip_reason: "no generated assertion", evidence: [] }),
  ]);

  const html = renderQaRunReportHtml(value);

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("QA run report"));
  assert.ok(html.includes("https://example.com/login"));
  assert.ok(html.includes("REQ-001@1.0.0"));
  assert.ok(html.includes("capture:discovery:001"));
  assert.ok(html.includes("tc-1"));
  assert.ok(html.includes("tc-2"));
  assert.ok(html.includes("tc-3"));
  assert.ok(html.includes("no generated assertion"));
  // summary bar: 3 generated, 2 executed, 1 passed, 1 failed, 1 not executed.
  assert.ok(html.includes('<span class="n">3</span>generated'));
  assert.ok(html.includes('<span class="n">2</span>executed'));
  assert.ok(html.includes('<span class="n">1</span>passed'));
  assert.ok(html.includes('<span class="n">1</span>failed'));
  assert.ok(html.includes('<span class="n">1</span>not executed'));
});

test("renderQaRunReportHtml escapes HTML-significant characters in test case content instead of injecting raw markup", () => {
  const value = report([
    testCase({
      test_case_id: "tc-xss",
      purpose: 'Validate <script>alert(1)</script> & "quotes"',
      evidence: ["<img src=x onerror=alert(1)>"],
    }),
  ]);

  const html = renderQaRunReportHtml(value);

  assert.ok(!html.includes("<script>alert(1)</script>"), "raw script tag SHALL NOT appear unescaped in the report");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"), "raw evidence markup SHALL NOT appear unescaped");
  assert.ok(html.includes("&lt;img"));
});

test("renderQaRunReportHtml renders unbindable acceptance-criteria findings as their own section, never silently dropped", () => {
  const value: QaRunReport = {
    ...report([testCase()]),
    generation_findings: [
      {
        id: "finding-1",
        category: "unbindable_criterion",
        message: 'Criterion "AC-2" mentions no discovered field or action.',
        evidence: [],
      },
    ],
  };

  const html = renderQaRunReportHtml(value);

  assert.ok(html.includes("Unbindable acceptance criteria"));
  assert.ok(html.includes("unbindable_criterion"));
  assert.ok(html.includes("AC-2"));
});

test("renderQaRunReportHtml omits the findings section entirely when there are no generation findings", () => {
  const html = renderQaRunReportHtml(report([testCase()]));
  assert.ok(!html.includes("Unbindable acceptance criteria"));
});

test("renderQaRunReportHtml embeds a .png evidence entry as a file:// <img>, while a non-screenshot entry still renders as <code>", () => {
  const value = report([
    testCase({
      test_case_id: "tc-screenshot",
      outcome: "failed",
      evidence: ["capture:abc", "/tmp/qa-screenshots/op-1/exec-1_attempt-1_1699999999999.png"],
    }),
  ]);

  const html = renderQaRunReportHtml(value);

  assert.ok(html.includes('<img src="file:///tmp/qa-screenshots/op-1/exec-1_attempt-1_1699999999999.png"'));
  assert.ok(html.includes("<code>capture:abc</code>"));
});

test("renderQaRunReportHtml never reads the screenshot file off disk — a path that does not exist still renders identically", () => {
  const value = report([
    testCase({ test_case_id: "tc-missing", outcome: "failed", evidence: ["/does/not/exist/on/disk.png"] }),
  ]);

  const html = renderQaRunReportHtml(value);

  assert.ok(html.includes('<img src="file:///does/not/exist/on/disk.png"'));
});

test("renderQaRunReportHtml surfaces a flaky outcome with its own CSS class and label", () => {
  const value = report([testCase({ test_case_id: "tc-flaky", outcome: "flaky" })]);

  const html = renderQaRunReportHtml(value);

  assert.ok(html.includes('class="outcome-flaky"'));
  assert.ok(html.includes('<span class="n">1</span>flaky'));
});

test("renderQaRunReportHtml shows the release gate banner and variant coverage table", () => {
  const html = renderQaRunReportHtml(
    report([
      testCase({ test_case_id: "tc-1", variant: "positive", outcome: "passed" }),
      testCase({ test_case_id: "tc-2", variant: "negative", outcome: "passed" }),
    ]),
  );

  assert.ok(html.includes("Release gate:"));
  assert.ok(html.includes("recommend release") || html.includes("recommend_release") || html.includes("gate-recommend_release"));
  assert.ok(html.includes("Variant coverage"));
  assert.ok(html.includes("<td>positive</td>") || html.includes(">positive<"));
});

test("renderQaRunReportHtml renders draft defects when present and never claims confirmed_cause", () => {
  const value = report([testCase({ test_case_id: "tc-fail", outcome: "failed", variant: "adversarial" })], {
    draft_defects: [
      {
        id: "DEF-DRAFT:tc-fail",
        version: "0.1.0",
        status: "draft",
        summary: "[failed] adversarial: xss",
        observed_behavior: "observed",
        expected_behavior: "expected",
        expected_behavior_authority: "REQ-001@1.0.0",
        workspace_scope: "workspace-001",
        environment_ref: "environment:op-1",
        reproduction_conditions: ["Navigate to https://example.com/login"],
        evidence: ["capture:abc"],
        severity: "critical",
        severity_rationale: "adversarial fail",
        priority: "p0",
        classification: "security_incident",
        suspected_cause: "possible XSS",
        owner: "unassigned",
      },
    ],
  });

  const html = renderQaRunReportHtml(value);

  assert.ok(html.includes("Draft defects (SPEC-211)"));
  assert.ok(html.includes("DEF-DRAFT:tc-fail"));
  assert.ok(html.includes("security_incident"));
  assert.ok(html.includes("confirmed_cause"));
  assert.ok(html.includes("never set"));
});
