/**
 * Expert Tester checklist derived from a QA run — host Skills MUST honor
 * `claim_pass_allowed` and `host_actions` (never green-wash).
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { ReleaseRecommendation } from "./qa-professional-analysis.js";
import type { QaRunReport, QaRunTestCaseResult } from "./qa-run-report.js";

export type ExpertChecklistInput = Readonly<{
  release_recommendation: ReleaseRecommendation;
  release_recommendation_rationale: string;
  test_cases: readonly QaRunTestCaseResult[];
  summary: Readonly<{
    failed: number;
    flaky: number;
    not_executed: number;
    passed: number;
  }>;
  draft_defect_count: number;
  coverage_gap_count: number;
  smart_retest_action: string;
  /** True when this response already carries a durable suite id (regression path). */
  suite_id_present?: boolean;
  context: "run_auto_qa" | "run_regression_suite";
}>;

export function deriveExpertChecklist(input: ExpertChecklistInput): JsonObject {
  const blockers: string[] = [];
  const satisfied: string[] = [];

  satisfied.push("release_recommendation_present");
  if (input.coverage_gap_count > 0) {
    satisfied.push("coverage_gaps_present");
  } else {
    blockers.push("coverage_gaps_empty_unexpected");
  }
  satisfied.push("smart_retest_suggestion_present");

  if (input.summary.failed > 0) {
    blockers.push(`failed_cases:${input.summary.failed}`);
  }
  if (input.summary.flaky > 0) {
    blockers.push(`flaky_cases:${input.summary.flaky}`);
  }
  if (input.summary.not_executed > 0) {
    blockers.push(`not_executed_cases:${input.summary.not_executed}`);
  }
  if (input.draft_defect_count > 0) {
    blockers.push(`draft_defects:${input.draft_defect_count}`);
  }

  const gateBlocksPass =
    input.release_recommendation === "do_not_release" ||
    input.release_recommendation === "changes_required" ||
    input.release_recommendation === "investigate_flakes";

  if (gateBlocksPass) {
    blockers.push(`gate:${input.release_recommendation}`);
  }

  const host_actions: string[] = [
    "State release_recommendation as the first verdict — never lead with pass-count.",
    "Paste coverage_gaps (and domain risks not tested) into the user-facing result.",
    "Follow smart_retest_suggestion for targeted retest after fixes.",
    "On next session G0: call list_failure_avoidance_hints (and list_learning_candidates).",
    "If product repo lacks domain-knowledge/: bootstrap from hosts/templates/domain-knowledge/ using this request (do not ask user to cp).",
    "If domain-knowledge/ exists: read and additively update from this request before G4.",
    "Human still required for release sign-off, pen-test, and novel domain without a pack.",
  ];

  if (input.context === "run_auto_qa" && input.suite_id_present !== true) {
    host_actions.unshift(
      "After this run: register_regression_suite so case/screen retest is possible (required for serious Expert runs).",
    );
  }

  if (input.smart_retest_action === "targeted_retest") {
    host_actions.unshift("Do NOT re-run the full suite — use case_ids / related_defect_ids from smart_retest_suggestion.");
  }

  const claim_pass_allowed =
    input.release_recommendation === "recommend_release" &&
    input.summary.failed === 0 &&
    input.summary.flaky === 0 &&
    input.draft_defect_count === 0 &&
    !blockers.some((b) => b.startsWith("gate:") || b.startsWith("failed_") || b.startsWith("flaky_"));

  return {
    schema_version: "1.0.0",
    context: input.context,
    claim_pass_allowed,
    claim_pass_allowed_meaning:
      "Host may say 'pass/ready' only when true. If false, report incomplete or blocked — never green-wash.",
    blockers,
    satisfied,
    host_actions,
    gate: {
      release_recommendation: input.release_recommendation,
      rationale: input.release_recommendation_rationale,
    },
    human_still_required: ["release_signoff", "pen_test", "novel_domain_without_pack"],
  };
}

export function expertChecklistFromQaRunReport(
  report: QaRunReport,
  coverageGapCount: number,
  smartRetestAction: string,
): JsonObject {
  return deriveExpertChecklist({
    release_recommendation: report.release_recommendation,
    release_recommendation_rationale: report.release_recommendation_rationale,
    test_cases: report.test_cases,
    summary: report.summary,
    draft_defect_count: report.draft_defects.length,
    coverage_gap_count: coverageGapCount,
    smart_retest_action: smartRetestAction,
    context: "run_auto_qa",
  });
}

export function expertChecklistHtml(checklist: JsonObject): string {
  const allowed = checklist["claim_pass_allowed"] === true;
  const blockers = Array.isArray(checklist["blockers"]) ? (checklist["blockers"] as string[]) : [];
  const actions = Array.isArray(checklist["host_actions"]) ? (checklist["host_actions"] as string[]) : [];
  const gate = checklist["gate"] as JsonObject | undefined;
  const rec = gate?.["release_recommendation"];
  return `<h2>Expert checklist</h2>
<div class="gate ${allowed ? "gate-recommend_release" : "gate-changes_required"}">
  <div class="label">claim_pass_allowed: ${allowed ? "true" : "false"}</div>
  <p>Gate: <code>${escapeHtml(String(rec ?? ""))}</code> — Host MUST NOT green-wash if claim_pass_allowed is false.</p>
</div>
${blockers.length > 0 ? `<p class="meta"><strong>Blockers:</strong> ${blockers.map((b) => escapeHtml(String(b))).join("; ")}</p>` : ""}
<ul>${actions.map((a) => `<li>${escapeHtml(String(a))}</li>`).join("\n")}</ul>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
