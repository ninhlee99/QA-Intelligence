/**
 * Senior-QA facing analysis layered on top of a raw QA run: variant coverage
 * matrix, residual-risk notes, and a release recommendation. Deterministic —
 * no Reasoning Provider. Never invents product intent; only aggregates what
 * the run already observed (SPEC-206 §6 residual risk articulation,
 * SPEC-212 §6 critical failures stay visible).
 */
import type { Defect } from "../bug-analysis/public.js";
import type { AccessibilitySmokeReport } from "../discovery/assess-ui-accessibility-smoke.js";
import type { TestCaseGenerationFinding } from "../test-design/public.js";
import type { QaRunReport, QaRunTestCaseResult } from "./qa-run-report.js";

export type VariantCoverageRow = Readonly<{
  variant: string;
  generated: number;
  passed: number;
  failed: number;
  flaky: number;
  not_executed: number;
}>;

export type ResidualRiskNote = Readonly<{
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  message: string;
  evidence: readonly string[];
}>;

/**
 * Mirrors a Senior QA gate call, not a product ship decision — host/human
 * still owns the real release. `do_not_release` is reserved for security
 * or critical drafts; `changes_required` for any hard fail / critical a11y.
 */
export type ReleaseRecommendation =
  | "recommend_release"
  | "pass_with_gaps"
  | "investigate_flakes"
  | "changes_required"
  | "do_not_release";

export type ProfessionalQaAnalysis = Readonly<{
  variant_coverage: readonly VariantCoverageRow[];
  residual_risks: readonly ResidualRiskNote[];
  release_recommendation: ReleaseRecommendation;
  release_recommendation_rationale: string;
}>;

export function buildProfessionalQaAnalysis(input: Readonly<{
  test_cases: readonly QaRunTestCaseResult[];
  generation_findings: readonly TestCaseGenerationFinding[];
  draft_defects: readonly Defect[];
  summary: QaRunReport["summary"];
  accessibility_smoke?: AccessibilitySmokeReport;
}>): ProfessionalQaAnalysis {
  const variant_coverage = buildVariantCoverage(input.test_cases);
  const residual_risks = buildResidualRisks(input);
  const gate = assessReleaseReadiness(input, residual_risks);
  return {
    variant_coverage,
    residual_risks,
    release_recommendation: gate.recommendation,
    release_recommendation_rationale: gate.rationale,
  };
}

export function buildVariantCoverage(
  testCases: readonly QaRunTestCaseResult[],
): readonly VariantCoverageRow[] {
  const byVariant = new Map<string, VariantCoverageRow>();
  for (const result of testCases) {
    const existing = byVariant.get(result.variant) ?? {
      variant: result.variant,
      generated: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      not_executed: 0,
    };
    const next = { ...existing, generated: existing.generated + 1 };
    if (result.outcome === "passed") next.passed++;
    else if (result.outcome === "failed" || result.outcome === "cancelled") next.failed++;
    else if (result.outcome === "flaky") next.flaky++;
    else next.not_executed++;
    byVariant.set(result.variant, next);
  }
  return [...byVariant.values()].sort((a, b) => a.variant.localeCompare(b.variant));
}

function buildResidualRisks(input: Readonly<{
  test_cases: readonly QaRunTestCaseResult[];
  generation_findings: readonly TestCaseGenerationFinding[];
  draft_defects: readonly Defect[];
  summary: QaRunReport["summary"];
  accessibility_smoke?: AccessibilitySmokeReport;
}>): readonly ResidualRiskNote[] {
  const notes: ResidualRiskNote[] = [];
  const a11y = input.accessibility_smoke;

  const securityDefects = input.draft_defects.filter((d) => d.classification === "security_incident");
  if (securityDefects.length > 0) {
    notes.push({
      id: "residual-security",
      severity: "critical",
      message: `${securityDefects.length} adversarial/security draft defect(s) remain open — do not treat the screen as release-ready until triaged.`,
      evidence: securityDefects.map((d) => d.id),
    });
  }

  const productFails = input.draft_defects.filter(
    (d) => d.classification === "product_defect" && d.status === "draft",
  );
  if (productFails.length > 0) {
    notes.push({
      id: "residual-product-fails",
      severity: "high",
      message: `${productFails.length} product-facing failure(s) drafted as defects; acceptance criteria not fully evidenced.`,
      evidence: productFails.map((d) => d.id),
    });
  }

  if (a11y !== undefined && (a11y.summary.critical > 0 || a11y.summary.high > 0)) {
    notes.push({
      id: "residual-a11y-naming",
      severity: a11y.summary.critical > 0 ? "critical" : "high",
      message: `Accessibility naming smoke: ${a11y.summary.critical} critical, ${a11y.summary.high} high finding(s) (unlabeled/missing names). Not a WCAG pass.`,
      evidence: a11y.findings.filter((f) => f.severity === "critical" || f.severity === "high").map((f) => f.id),
    });
  }

  if (input.generation_findings.length > 0) {
    notes.push({
      id: "residual-unbindable-ac",
      severity: "high",
      message: `${input.generation_findings.length} acceptance criterion finding(s) could not bind to discovered UI — coverage gap, not a silent pass.`,
      evidence: input.generation_findings.map((f) => f.id),
    });
  }

  if (input.summary.flaky > 0) {
    notes.push({
      id: "residual-flaky",
      severity: "medium",
      message: `${input.summary.flaky} flaky outcome(s) — reliability unknown until stabilized or reclassified.`,
      evidence: input.test_cases.filter((t) => t.outcome === "flaky").map((t) => t.test_case_id),
    });
  }

  if (input.summary.not_executed > 0) {
    notes.push({
      id: "residual-not-executed",
      severity: "medium",
      message: `${input.summary.not_executed} case(s) not executed — no pass/fail verdict; do not count toward coverage.`,
      evidence: input.test_cases
        .filter((t) => t.outcome === "not_executed")
        .map((t) => t.test_case_id),
    });
  }

  const a11yClean = a11y === undefined || (a11y.summary.critical === 0 && a11y.summary.high === 0);
  if (
    input.summary.failed === 0 &&
    input.summary.flaky === 0 &&
    input.generation_findings.length === 0 &&
    input.summary.executed > 0 &&
    a11yClean
  ) {
    notes.push({
      id: "residual-scope-limit",
      severity: "low",
      message:
        "This run covers supplied acceptance criteria + naming a11y smoke on one surface — API, full WCAG/axe, performance, multi-page workflows, and executed exploratory sessions remain out of scope.",
      evidence: [`executed:${input.summary.executed}`],
    });
  }

  return notes;
}

function assessReleaseReadiness(
  input: Readonly<{
    draft_defects: readonly Defect[];
    generation_findings: readonly TestCaseGenerationFinding[];
    summary: QaRunReport["summary"];
    accessibility_smoke?: AccessibilitySmokeReport;
  }>,
  residualRisks: readonly ResidualRiskNote[],
): Readonly<{ recommendation: ReleaseRecommendation; rationale: string }> {
  const hasCriticalSecurity = input.draft_defects.some(
    (d) => d.classification === "security_incident" || d.severity === "critical",
  );
  if (hasCriticalSecurity) {
    return {
      recommendation: "do_not_release",
      rationale:
        "Critical or security-classified draft defect(s) from this run. Senior QA gate: block release until triage confirms or rejects each draft.",
    };
  }

  const a11yCritical = (input.accessibility_smoke?.summary.critical ?? 0) > 0;
  if (a11yCritical) {
    return {
      recommendation: "changes_required",
      rationale:
        "Critical accessibility naming findings (e.g. unlabeled editable fields). Fix labels/names before treating the surface as release-ready — naming smoke is not WCAG certification.",
    };
  }

  if (input.summary.failed > 0) {
    return {
      recommendation: "changes_required",
      rationale: `${input.summary.failed} failed case(s) produced product-facing draft defects. Fix or explicitly waive with recorded residual risk before release.`,
    };
  }

  if (input.summary.flaky > 0 && input.summary.failed === 0) {
    return {
      recommendation: "investigate_flakes",
      rationale: `${input.summary.flaky} flaky case(s) and no hard fails — stabilize or reclassify before treating the run as a green gate.`,
    };
  }

  if (input.generation_findings.length > 0 || (input.accessibility_smoke?.summary.high ?? 0) > 0) {
    return {
      recommendation: "pass_with_gaps",
      rationale:
        input.generation_findings.length > 0
          ? `Executed cases passed, but ${input.generation_findings.length} acceptance criterion finding(s) and/or a11y high findings remain — coverage incomplete.`
          : "Executed cases passed, but high-severity accessibility naming findings remain visible.",
    };
  }

  if (input.summary.executed === 0) {
    return {
      recommendation: "changes_required",
      rationale: "No case produced an executable pass/fail verdict — nothing evidenced; not a release signal.",
    };
  }

  const criticalResidual = residualRisks.filter((r) => r.severity === "critical" || r.severity === "high");
  if (criticalResidual.length > 0) {
    return {
      recommendation: "pass_with_gaps",
      rationale: `All executed cases passed, but ${criticalResidual.length} high/critical residual-risk note(s) remain visible.`,
    };
  }

  return {
    recommendation: "recommend_release",
    rationale:
      "All executed cases passed, naming a11y smoke clean of critical/high, no unbound acceptance criteria. Scope limits still apply (single surface; not full portfolio testing).",
  };
}
