/**
 * Distinct from `Report` (`public.ts`, SPEC-212's recurring metrics
 * dashboard) — this describes the output of ONE discover -> generate ->
 * execute pipeline run, which has no "update_cadence" or owner to report.
 *
 * `renderQaRunReportHtml` is pure (no I/O); writing its output to a file is
 * `RunAutoQaPipelineRuntimeExecutor`'s concern.
 *
 * v1.1 adds Senior-QA surfaces: draft defects (SPEC-211), variant coverage,
 * residual risk notes, and a release recommendation — all derived
 * deterministically from the same run, never inventing product intent.
 */
import type { Defect } from "../bug-analysis/public.js";
import type { AccessibilitySmokeReport } from "../discovery/assess-ui-accessibility-smoke.js";
import type { TestCaseGenerationFinding } from "../test-design/public.js";
import type {
  ProfessionalQaAnalysis,
  ReleaseRecommendation,
  ResidualRiskNote,
  VariantCoverageRow,
} from "./qa-professional-analysis.js";
import { deriveFlakeTaxonomy, type FlakeTaxonomy } from "./flake-taxonomy.js";

export type QaRunTestCaseOutcome = "passed" | "failed" | "cancelled" | "not_executed" | "flaky";

export type QaRunTestCaseResult = Readonly<{
  test_case_id: string;
  purpose: string;
  variant: string;
  outcome: QaRunTestCaseOutcome;
  /** Populated only when outcome is "not_executed" — e.g. no generated assertion to check against (SPEC-207 §6). */
  skip_reason?: string;
  evidence: readonly string[];
}>;

export type QaRunReport = Readonly<{
  schema_version: "1.1.0";
  workspace_id: string;
  /** The URL Discovery observed — the target screen after login when discover_ui_surface_after_login was used. */
  target_url: string;
  generated_at: string;
  requirement_ref: string;
  discovery_capture_id: string;
  discovery_element_count: number;
  test_cases: readonly QaRunTestCaseResult[];
  /** Acceptance criteria the generator could not bind to any discovered field/action — never silently dropped (SPEC-207 §6). */
  generation_findings: readonly TestCaseGenerationFinding[];
  summary: Readonly<{
    generated: number;
    executed: number;
    passed: number;
    failed: number;
    flaky: number;
    not_executed: number;
  }>;
  /** SPEC-211 drafts from failed/flaky outcomes — empty when the run is clean. */
  draft_defects: readonly Defect[];
  /** Naming a11y smoke on the same discovery capture (not WCAG). */
  accessibility_smoke: AccessibilitySmokeReport;
  variant_coverage: readonly VariantCoverageRow[];
  residual_risks: readonly ResidualRiskNote[];
  release_recommendation: ReleaseRecommendation;
  release_recommendation_rationale: string;
}>;

export function summarizeQaRunTestCases(
  results: readonly QaRunTestCaseResult[],
): QaRunReport["summary"] {
  let passed = 0;
  let failed = 0;
  let flaky = 0;
  let notExecuted = 0;
  for (const result of results) {
    if (result.outcome === "passed") passed++;
    else if (result.outcome === "failed" || result.outcome === "cancelled") failed++;
    else if (result.outcome === "flaky") flaky++;
    else notExecuted++;
  }
  return {
    generated: results.length,
    executed: passed + failed + flaky,
    passed,
    failed,
    flaky,
    not_executed: notExecuted,
  };
}

/** Attach professional-analysis fields onto a base report shell. */
export function withProfessionalAnalysis(
  report: Omit<
    QaRunReport,
    | "variant_coverage"
    | "residual_risks"
    | "release_recommendation"
    | "release_recommendation_rationale"
  >,
  analysis: ProfessionalQaAnalysis,
): QaRunReport {
  return {
    ...report,
    variant_coverage: analysis.variant_coverage,
    residual_risks: analysis.residual_risks,
    release_recommendation: analysis.release_recommendation,
    release_recommendation_rationale: analysis.release_recommendation_rationale,
  };
}

import { expertChecklistHtml, expertChecklistFromQaRunReport, type ExpertChecklistFromReportOptions } from "./expert-checklist.js";

function flakeTaxonomyHtml(taxonomy: FlakeTaxonomy): string {
  if (taxonomy.flaky_count === 0) {
    return `<h2>Flake taxonomy</h2><p class="meta">${escapeHtml(taxonomy.note)}</p>`;
  }
  const rows = taxonomy.cases
    .map(
      (entry) => `    <tr>
      <td><code>${escapeHtml(entry.test_case_id)}</code></td>
      <td>${escapeHtml(entry.category)}</td>
      <td>${escapeHtml(entry.confidence)}</td>
      <td>${escapeHtml(entry.signals.join("; "))}</td>
      <td>${escapeHtml(entry.host_hint)}</td>
    </tr>`,
    )
    .join("\n");
  return `<h2>Flake taxonomy</h2>
<p class="meta">${escapeHtml(taxonomy.note)}</p>
<table>
  <thead><tr><th>Case</th><th>Category</th><th>Confidence</th><th>Signals</th><th>Host hint</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/** Derives an explicit coverage gap summary for the HTML report. */
function coverageGapsHtml(report: QaRunReport): string {
  const items: string[] = [];

  const notExecuted = report.test_cases.filter((tc) => tc.outcome === "not_executed");
  if (notExecuted.length > 0) {
    items.push(
      `<li class="risk-high"><strong>Not executed:</strong> ${notExecuted.length} test case(s) skipped — AC may be unbound or execution was skipped (${notExecuted.map((tc) => escapeHtml(tc.test_case_id)).join(", ")})</li>`,
    );
  }

  if (report.generation_findings.length > 0) {
    items.push(
      `<li class="risk-high"><strong>Unbindable AC:</strong> ${report.generation_findings.length} acceptance criterion/criteria not bound to any discovered element — these were NOT tested</li>`,
    );
  }

  const criticalA11y = report.accessibility_smoke.findings.filter((f) => f.severity === "critical");
  if (criticalA11y.length > 0) {
    items.push(
      `<li class="risk-high"><strong>Unlabeled fields:</strong> ${criticalA11y.length} field(s) without accessible name — test cases for these controls may be unreliable</li>`,
    );
  }

  items.push(
    `<li class="risk-low"><strong>Scope limits (always):</strong> full WCAG audit, load testing, penetration testing, API authorization matrix, cross-browser parity were NOT performed in this run</li>`,
  );

  return `<h2>Coverage gaps</h2>
<p class="meta">Expert QA rule: never claim pass by silence. Gaps surfaced proactively.</p>
<ul>${items.join("\n")}</ul>`;
}

function expertChecklistSection(report: QaRunReport, options?: ExpertChecklistFromReportOptions): string {
  let gapCount = 1; // scope limits always
  if (report.test_cases.some((tc) => tc.outcome === "not_executed")) gapCount += 1;
  if (report.generation_findings.length > 0) gapCount += 1;
  if (report.accessibility_smoke.findings.some((f) => f.severity === "critical")) gapCount += 1;
  const hasFail = report.test_cases.some((tc) => tc.outcome === "failed" || tc.outcome === "cancelled");
  const hasFlaky = report.test_cases.some((tc) => tc.outcome === "flaky");
  const retestAction = hasFail || hasFlaky ? "targeted_retest" : "no_retest_needed";
  const checklist = expertChecklistFromQaRunReport(report, gapCount, retestAction, options ?? {});
  return expertChecklistHtml(checklist);
}

/** Renders a self-contained HTML report — no external stylesheet/script, safe to open directly from disk. */
export function renderQaRunReportHtml(
  report: QaRunReport,
  flakeTaxonomy?: FlakeTaxonomy,
  checklistOptions?: ExpertChecklistFromReportOptions,
): string {
  const taxonomy = flakeTaxonomy ?? deriveFlakeTaxonomy(report);
  const rows = report.test_cases.map(testCaseRow).join("\n");
  const findings =
    report.generation_findings.length > 0
      ? `<h2>Unbindable acceptance criteria</h2><ul>${report.generation_findings
          .map(
            (finding) =>
              `<li><strong>${escapeHtml(finding.category)}</strong>: ${escapeHtml(finding.message)}</li>`,
          )
          .join("\n")}</ul>`
      : "";
  const coverage =
    report.variant_coverage.length > 0
      ? `<h2>Variant coverage</h2>
<table>
  <thead><tr><th>Variant</th><th>Generated</th><th>Passed</th><th>Failed</th><th>Flaky</th><th>Not executed</th></tr></thead>
  <tbody>
${report.variant_coverage.map(coverageRow).join("\n")}
  </tbody>
</table>`
      : "";
  const defects =
    report.draft_defects.length > 0
      ? `<h2>Draft defects (SPEC-211)</h2>
<p class="meta">Suspected causes only — <code>confirmed_cause</code> is never set by this pipeline. Human triage required before filing.</p>
<table>
  <thead><tr><th>ID</th><th>Severity</th><th>Priority</th><th>Classification</th><th>Summary</th><th>Evidence</th></tr></thead>
  <tbody>
${report.draft_defects.map(defectRow).join("\n")}
  </tbody>
</table>`
      : "";
  const residual =
    report.residual_risks.length > 0
      ? `<h2>Residual risks</h2><ul>${report.residual_risks
          .map(
            (risk) =>
              `<li class="risk-${risk.severity}"><strong>${escapeHtml(risk.severity)}</strong>: ${escapeHtml(risk.message)}</li>`,
          )
          .join("\n")}</ul>`
      : "";
  const a11y =
    report.accessibility_smoke.findings.length > 0
      ? `<h2>Accessibility naming smoke</h2>
<p class="meta">Not a WCAG audit — missing/duplicate accessible names only.</p>
<ul>${report.accessibility_smoke.findings
          .map(
            (finding) =>
              `<li class="risk-${finding.severity}"><strong>${escapeHtml(finding.severity)}</strong> [${escapeHtml(finding.category)}]: ${escapeHtml(finding.message)}</li>`,
          )
          .join("\n")}</ul>`
      : `<h2>Accessibility naming smoke</h2><p class="meta">No naming issues on ${report.accessibility_smoke.element_count} discovered element(s). Still not a full WCAG/axe audit.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>QA run report — ${escapeHtml(report.target_url)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; vertical-align: top; }
  th { background: #f5f5f5; }
  .summary { display: flex; gap: 1.5rem; margin: 1rem 0; flex-wrap: wrap; }
  .stat { padding: 0.75rem 1rem; border-radius: 6px; background: #f5f5f5; min-width: 6rem; }
  .stat .n { font-size: 1.5rem; font-weight: 700; display: block; }
  .outcome-passed { color: #0a7d2c; font-weight: 600; }
  .outcome-failed { color: #c0392b; font-weight: 600; }
  .outcome-cancelled { color: #c0392b; font-weight: 600; }
  .outcome-not_executed { color: #8a6d00; font-weight: 600; }
  .outcome-flaky { color: #b8860b; font-weight: 600; }
  .meta { color: #555; font-size: 0.9rem; }
  code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; }
  .gate { padding: 1rem 1.25rem; border-radius: 8px; margin: 1rem 0; border: 1px solid #ddd; }
  .gate-recommend_release { background: #eaf7ee; border-color: #0a7d2c; }
  .gate-pass_with_gaps { background: #fff8e6; border-color: #b8860b; }
  .gate-investigate_flakes { background: #fff8e6; border-color: #b8860b; }
  .gate-changes_required { background: #fdecea; border-color: #c0392b; }
  .gate-do_not_release { background: #fdecea; border-color: #7b1e1e; }
  .gate .label { font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.85rem; }
  .risk-critical, .sev-critical { color: #7b1e1e; font-weight: 600; }
  .risk-high, .sev-high { color: #c0392b; font-weight: 600; }
  .risk-medium, .sev-medium { color: #b8860b; font-weight: 600; }
  .risk-low, .sev-low { color: #555; }
</style>
</head>
<body>
<h1>QA run report</h1>
<p class="meta">
  Target: <code>${escapeHtml(report.target_url)}</code><br>
  Workspace: <code>${escapeHtml(report.workspace_id)}</code><br>
  Requirement: <code>${escapeHtml(report.requirement_ref)}</code><br>
  Generated at: ${escapeHtml(report.generated_at)}<br>
  Discovery capture: <code>${escapeHtml(report.discovery_capture_id)}</code> (${report.discovery_element_count} elements)
</p>
<div class="gate gate-${report.release_recommendation}">
  <div class="label">Release gate: ${escapeHtml(report.release_recommendation.replace(/_/g, " "))}</div>
  <p>${escapeHtml(report.release_recommendation_rationale)}</p>
</div>
<div class="summary">
  <div class="stat"><span class="n">${report.summary.generated}</span>generated</div>
  <div class="stat"><span class="n">${report.summary.executed}</span>executed</div>
  <div class="stat"><span class="n">${report.summary.passed}</span>passed</div>
  <div class="stat"><span class="n">${report.summary.failed}</span>failed</div>
  <div class="stat"><span class="n">${report.summary.flaky}</span>flaky</div>
  <div class="stat"><span class="n">${report.summary.not_executed}</span>not executed</div>
  <div class="stat"><span class="n">${report.draft_defects.length}</span>draft defects</div>
  <div class="stat"><span class="n">${report.accessibility_smoke.findings.length}</span>a11y findings</div>
</div>
${coverage}
${coverageGapsHtml(report)}
${flakeTaxonomyHtml(taxonomy)}
${expertChecklistSection(report, checklistOptions)}
<h2>Test cases</h2>
<table>
  <thead><tr><th>Test case</th><th>Variant</th><th>Purpose</th><th>Outcome</th><th>Evidence</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
${defects}
${a11y}
${residual}
${findings}
</body>
</html>
`;
}

function coverageRow(row: VariantCoverageRow): string {
  return `    <tr>
      <td>${escapeHtml(row.variant)}</td>
      <td>${row.generated}</td>
      <td>${row.passed}</td>
      <td>${row.failed}</td>
      <td>${row.flaky}</td>
      <td>${row.not_executed}</td>
    </tr>`;
}

function defectRow(defect: Defect): string {
  return `    <tr>
      <td><code>${escapeHtml(defect.id)}</code></td>
      <td class="sev-${defect.severity}">${escapeHtml(defect.severity)}</td>
      <td>${escapeHtml(defect.priority)}</td>
      <td>${escapeHtml(defect.classification)}</td>
      <td>${escapeHtml(defect.summary)}</td>
      <td>${defect.evidence.map(evidenceCell).join("<br>")}</td>
    </tr>`;
}

function testCaseRow(result: QaRunTestCaseResult): string {
  const outcomeLabel = result.outcome === "not_executed" && result.skip_reason
    ? `not executed — ${escapeHtml(result.skip_reason)}`
    : result.outcome.replace("_", " ");
  return `    <tr>
      <td><code>${escapeHtml(result.test_case_id)}</code></td>
      <td>${escapeHtml(result.variant)}</td>
      <td>${escapeHtml(result.purpose)}</td>
      <td class="outcome-${result.outcome}">${outcomeLabel}</td>
      <td>${result.evidence.map(evidenceCell).join("<br>")}</td>
    </tr>`;
}

/** Written exclusively by `PlaywrightExecutionEngine#captureFailureScreenshot` with a fixed `.png` suffix — no other evidence producer uses this extension today. */
function isScreenshotPath(entry: string): boolean {
  return entry.endsWith(".png");
}

/** Playwright trace zip written by `PlaywrightExecutionEngine#captureFailureTrace` — fail-only. */
function isTracePath(entry: string): boolean {
  return entry.endsWith(".zip") || entry.includes(".qa-traces/");
}

/** Pure string formatting only — never reads the referenced file, so this stays true even when the path no longer exists on disk. */
function evidenceCell(entry: string): string {
  if (isScreenshotPath(entry)) {
    return `<img src="file://${encodeURI(entry)}" alt="failure screenshot" style="max-width:320px;display:block;margin:0.25rem 0;">`;
  }
  if (isTracePath(entry)) {
    return `<span style="display:block;margin:0.25rem 0">🎬 <a href="file://${encodeURI(entry)}" title="Open trace zip"><code>${escapeHtml(entry)}</code></a> <small style="color:#666">(npx playwright show-trace)</small></span>`;
  }
  return `<code>${escapeHtml(entry)}</code>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
