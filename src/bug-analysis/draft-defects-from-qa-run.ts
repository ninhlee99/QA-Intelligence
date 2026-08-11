/**
 * SPEC-211 tracer for the execution→bug path: turn failed/flaky QA run
 * outcomes into governed `Defect` drafts. Deterministic only — never sets
 * `confirmed_cause` (SPEC-211 §6: AI MAY suggest hypotheses, SHALL NOT
 * present them as confirmed). Empty evidence from the engine becomes
 * synthetic provenance (`outcome:` / `test-case:`) so drafts still satisfy
 * the Defect Contract's min-evidence rule without inventing product facts.
 */
import type { Defect, DefectClassification, DefectPriority, DefectSeverity } from "./public.js";
import type { QaRunTestCaseResult } from "../reporting/qa-run-report.js";

export type DraftDefectsFromQaRunInput = Readonly<{
  workspace_id: string;
  requirement_ref: string;
  target_url: string;
  environment_ref: string;
  test_cases: readonly QaRunTestCaseResult[];
}>;

type SeverityProfile = Readonly<{
  severity: DefectSeverity;
  priority: DefectPriority;
  classification: DefectClassification;
  severity_rationale: string;
  suspected_cause: string;
}>;

/**
 * Pure: one draft Defect per failed or flaky result. Passed / not_executed /
 * cancelled do not become defects (cancelled is infrastructure noise already
 * counted as fail in the summary bar — a defect draft needs a product-facing
 * observation, which cancelled does not provide).
 */
export function draftDefectsFromQaRun(input: DraftDefectsFromQaRunInput): readonly Defect[] {
  const drafts: Defect[] = [];
  for (const result of input.test_cases) {
    if (result.outcome !== "failed" && result.outcome !== "flaky") continue;
    const profile = profileFor(result);
    const evidence =
      result.evidence.length > 0
        ? [...result.evidence]
        : [`outcome:${result.outcome}`, `test-case:${result.test_case_id}`];

    drafts.push({
      id: `DEF-DRAFT:${result.test_case_id}`,
      version: "0.1.0",
      status: "draft",
      summary: summarize(result),
      observed_behavior: observed(result),
      expected_behavior: expected(result),
      expected_behavior_authority: input.requirement_ref,
      affected_requirement_refs: [input.requirement_ref],
      workspace_scope: input.workspace_id,
      environment_ref: input.environment_ref,
      reproduction_conditions: [
        `Navigate to ${input.target_url}`,
        `Replay test case ${result.test_case_id} (${result.variant} variant)`,
        result.purpose,
      ],
      evidence,
      severity: profile.severity,
      severity_rationale: profile.severity_rationale,
      priority: profile.priority,
      classification: profile.classification,
      suspected_cause: profile.suspected_cause,
      owner: "unassigned",
      related_execution_refs: [`execution:${result.test_case_id}`],
      related_test_refs: [result.test_case_id],
    });
  }
  return drafts;
}

function profileFor(result: QaRunTestCaseResult): SeverityProfile {
  if (result.outcome === "flaky") {
    return {
      severity: "medium",
      priority: "p2",
      classification: "automation_defect",
      severity_rationale:
        "Outcome flipped across flake-detection trials — may be product nondeterminism or automation timing; severity stays medium until classified.",
      suspected_cause:
        "Intermittent assertion or timing race; not confirmed as a product defect until a stable reproduction exists.",
    };
  }

  switch (result.variant) {
    case "adversarial":
      return {
        severity: "critical",
        priority: "p0",
        classification: "security_incident",
        severity_rationale:
          "Adversarial probe (XSS/injection/path/command) failed its safety assertion — possible security exposure.",
        suspected_cause:
          "Input not sanitized or reflected unsafely; confirmed_cause left unset pending security triage.",
      };
    case "boundary":
      return {
        severity: "high",
        priority: "p1",
        classification: "product_defect",
        severity_rationale: "Boundary/oversized input produced a failed assertion (leak or unexpected success path).",
        suspected_cause: "Missing length/validation guard or unhandled overflow path.",
      };
    case "negative":
    case "empty":
    case "whitespace":
    case "type_confusion":
      return {
        severity: "high",
        priority: "p1",
        classification: "product_defect",
        severity_rationale: `Invalid-input variant "${result.variant}" failed — product may accept bad data or skip validation.`,
        suspected_cause: "Validation gap or incorrect error/success signalling on invalid input.",
      };
    case "unicode":
      return {
        severity: "medium",
        priority: "p2",
        classification: "product_defect",
        severity_rationale: "Unicode/encoding input failed — possible i18n or encoding defect.",
        suspected_cause: "Encoding mishandling or overly strict charset validation.",
      };
    case "positive":
    default:
      return {
        severity: "high",
        priority: "p1",
        classification: "product_defect",
        severity_rationale: "Happy-path assertion failed against stated acceptance authority.",
        suspected_cause: "Regression against the acceptance criterion, or environment/data mismatch.",
      };
  }
}

function summarize(result: QaRunTestCaseResult): string {
  if (result.outcome === "flaky") {
    return `[flaky] ${result.variant}: ${truncate(result.purpose, 120)}`;
  }
  return `[failed] ${result.variant}: ${truncate(result.purpose, 120)}`;
}

function observed(result: QaRunTestCaseResult): string {
  if (result.outcome === "flaky") {
    return `Test case ${result.test_case_id} (${result.variant}) produced inconsistent pass/fail across flake-detection trials. Evidence: ${evidenceSummary(result)}.`;
  }
  return `Test case ${result.test_case_id} (${result.variant}) failed. Purpose: ${result.purpose}. Evidence: ${evidenceSummary(result)}.`;
}

function expected(result: QaRunTestCaseResult): string {
  return `Test case ${result.test_case_id} (${result.variant}) SHALL pass under its generated assertion derived from the acceptance-criteria authority. Purpose: ${result.purpose}`;
}

function evidenceSummary(result: QaRunTestCaseResult): string {
  if (result.evidence.length === 0) return "(no engine evidence captured)";
  return result.evidence.slice(0, 3).join("; ");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
