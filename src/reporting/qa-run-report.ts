/**
 * Distinct from `Report` (`public.ts`, SPEC-212's recurring metrics
 * dashboard) — this describes the output of ONE discover -> generate ->
 * execute pipeline run, which has no "update_cadence" or owner to report.
 *
 * `renderQaRunReportHtml` is pure (no I/O); writing its output to a file is
 * `RunAutoQaPipelineRuntimeExecutor`'s concern.
 */
import type { TestCaseGenerationFinding } from "../test-design/public.js";

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
  schema_version: "1.0.0";
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

/** Renders a self-contained HTML report — no external stylesheet/script, safe to open directly from disk. */
export function renderQaRunReportHtml(report: QaRunReport): string {
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
  .summary { display: flex; gap: 1.5rem; margin: 1rem 0; }
  .stat { padding: 0.75rem 1rem; border-radius: 6px; background: #f5f5f5; min-width: 6rem; }
  .stat .n { font-size: 1.5rem; font-weight: 700; display: block; }
  .outcome-passed { color: #0a7d2c; font-weight: 600; }
  .outcome-failed { color: #c0392b; font-weight: 600; }
  .outcome-cancelled { color: #c0392b; font-weight: 600; }
  .outcome-not_executed { color: #8a6d00; font-weight: 600; }
  .outcome-flaky { color: #b8860b; font-weight: 600; }
  .meta { color: #555; font-size: 0.9rem; }
  code { background: #f0f0f0; padding: 0.1rem 0.3rem; border-radius: 3px; }
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
<div class="summary">
  <div class="stat"><span class="n">${report.summary.generated}</span>generated</div>
  <div class="stat"><span class="n">${report.summary.executed}</span>executed</div>
  <div class="stat"><span class="n">${report.summary.passed}</span>passed</div>
  <div class="stat"><span class="n">${report.summary.failed}</span>failed</div>
  <div class="stat"><span class="n">${report.summary.flaky}</span>flaky</div>
  <div class="stat"><span class="n">${report.summary.not_executed}</span>not executed</div>
</div>
<h2>Test cases</h2>
<table>
  <thead><tr><th>Test case</th><th>Variant</th><th>Purpose</th><th>Outcome</th><th>Evidence</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
${findings}
</body>
</html>
`;
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

/** Pure string formatting only — never reads the referenced file, so this stays true even when the path no longer exists on disk. */
function evidenceCell(entry: string): string {
  if (isScreenshotPath(entry)) {
    return `<img src="file://${encodeURI(entry)}" alt="failure screenshot" style="max-width:320px;display:block;margin:0.25rem 0;">`;
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
