/**
 * Senior Expert Tester session close-out — deterministic narrative voice.
 * Sounds like a human Expert closing a test session: gate first, then critical,
 * gaps, next actions. Never invents product intent or confirmed root cause.
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { DomainPackGateInput } from "./expert-checklist.js";
import type { ExpertMandateBlocker, ExpertRiskSignals, ExpertHookCoverage } from "./expert-risk-signals.js";
import type { QaRunReport } from "./qa-run-report.js";
import type { FlakeTaxonomy } from "./flake-taxonomy.js";

export type ExpertSessionReportInput = Readonly<{
  report: QaRunReport;
  claim_pass_allowed: boolean;
  blockers: readonly string[];
  coverage_gaps: readonly JsonObject[];
  risk_signals: ExpertRiskSignals;
  hook_coverage: ExpertHookCoverage;
  mandate_blockers: readonly ExpertMandateBlocker[];
  domain_pack?: DomainPackGateInput;
  flake_taxonomy?: FlakeTaxonomy;
  suite_id?: string;
}>;

export type ExpertSessionReport = Readonly<{
  schema_version: "1.0.0";
  voice: "senior_expert_tester";
  headline: string;
  verdict_paragraph: string;
  critical_findings: readonly string[];
  what_was_tested: readonly string[];
  what_was_not_tested: readonly string[];
  next_actions: readonly string[];
  human_must: readonly string[];
  markdown: string;
}>;

export function draftExpertSessionReport(input: ExpertSessionReportInput): ExpertSessionReport {
  const { report } = input;
  const gate = report.release_recommendation;
  const failed = report.test_cases.filter((t) => t.outcome === "failed");
  const flaky = report.test_cases.filter((t) => t.outcome === "flaky");
  const notExec = report.test_cases.filter((t) => t.outcome === "not_executed");

  const headline = input.claim_pass_allowed
    ? `Gate ${gate} — automation green with gaps recorded (human sign-off still required)`
    : `Gate ${gate} — NOT ready to claim pass (${input.blockers.length} blocker(s))`;

  const verdict_paragraph = input.claim_pass_allowed
    ? `As a Senior Expert Tester I would say: the scoped UI/AC automation gate is green (${report.summary.passed} passed, 0 fail/flaky/not_executed). I still would not personally sign a release without human product owner confirmation — novel domain, pen-test, and business judgment are outside this run.`
    : `As a Senior Expert Tester I would refuse a pass claim. Gate is "${gate}". Blockers: ${input.blockers.slice(0, 8).join("; ")}${input.blockers.length > 8 ? "…" : ""}. Lead with this gate — never with a pass-count.`;

  const critical_findings: string[] = [];
  for (const defect of report.draft_defects.slice(0, 8)) {
    critical_findings.push(
      `${defect.severity.toUpperCase()} ${defect.id}: ${defect.summary} — suspected (not confirmed): ${defect.suspected_cause ?? "n/a"}`,
    );
  }
  for (const blocker of input.mandate_blockers) {
    critical_findings.push(`MANDATE OPEN: ${blocker.message}`);
  }
  if (flaky.length > 0) {
    critical_findings.push(
      `Flaky ${flaky.length} case(s): ${flaky.map((t) => t.test_case_id).join(", ")} — treat as investigate_flakes, not ignore.`,
    );
  }
  if (failed.length > 0) {
    critical_findings.push(
      `Failed ${failed.length} case(s): ${failed.map((t) => `${t.test_case_id}[${t.variant}]`).join(", ")}.`,
    );
  }
  if (critical_findings.length === 0) {
    critical_findings.push("No draft defects or E2 mandate blockers in this pass — residual scope limits still apply.");
  }

  const what_was_tested: string[] = [
    `Target ${report.target_url} against ${report.requirement_ref}.`,
    `Generated ${report.summary.generated} cases; executed ${report.summary.executed} (passed ${report.summary.passed} / failed ${report.summary.failed} / flaky ${report.summary.flaky}).`,
    `Accessibility naming smoke: ${report.accessibility_smoke.findings.length} finding(s) on ${report.accessibility_smoke.element_count} element(s).`,
  ];
  if (input.hook_coverage.role_compare_ran) {
    what_was_tested.push("Dual-role UI surface compare ran (named controls only — not a full authz model).");
  }
  if (input.hook_coverage.openapi_cases_added) {
    what_was_tested.push("OpenAPI-derived API smoke cases registered into the regression suite.");
  }
  if (input.hook_coverage.journey_cases_added) {
    what_was_tested.push("Workflow journey cases registered into the suite (execution deferred to targeted retest / suite run).");
  }
  if (input.hook_coverage.any_expected_network_on_ac) {
    what_was_tested.push("At least one AC carried expected_network (UI→API coupling).");
  }
  if (input.suite_id) {
    what_was_tested.push(`Durable suite registered: ${input.suite_id}.`);
  }
  if (input.flake_taxonomy && input.flake_taxonomy.flaky_count > 0) {
    what_was_tested.push(
      `Flake taxonomy: ${Object.entries(input.flake_taxonomy.by_category)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}=${n}`)
        .join(", ")}.`,
    );
  }

  const what_was_not_tested: string[] = [];
  for (const gap of input.coverage_gaps) {
    const message = typeof gap["message"] === "string" ? gap["message"] : String(gap["gap"] ?? "gap");
    what_was_not_tested.push(message);
  }
  if (input.domain_pack && !input.domain_pack.present) {
    what_was_not_tested.push("Domain pack absent — money/permission/legacy risks may be invisible to automation.");
  } else if (input.domain_pack?.high_risk_unconfirmed) {
    what_was_not_tested.push("Domain pack high-risk stubs still unconfirmed by a human.");
  }
  if (input.risk_signals.signals.length > 0) {
    what_was_not_tested.push(`G0 smells noted: ${input.risk_signals.signals.join("; ")}.`);
  }
  if (notExec.length > 0) {
    what_was_not_tested.push(`${notExec.length} case(s) not executed — do not silently treat as pass.`);
  }

  const next_actions: string[] = [];
  if (failed.length + flaky.length > 0) {
    next_actions.push(
      "Targeted retest only the failed/flaky case_ids (or related_defect_ids) after fix — do not re-burn the full suite.",
    );
  }
  for (const blocker of input.mandate_blockers) {
    next_actions.push(`Close mandate: ${blocker.code} — ${blocker.message}`);
  }
  if (input.domain_pack?.high_risk_unconfirmed) {
    next_actions.push("Walk money/permission TODOs with a human; then re-run with domain_high_risk_confirmed=true.");
  }
  if (!input.claim_pass_allowed) {
    next_actions.push("Call validate_expert_claim before any pass/ready/ship wording — expect refuse until blockers clear.");
  } else {
    next_actions.push("Automation gate green — still request human release_signoff before ship language.");
  }
  if (next_actions.length === 0) {
    next_actions.push("No urgent automation follow-ups; keep suite_id for future regression.");
  }

  const human_must = [
    "release_signoff",
    "pen_test_if_security_sensitive",
    "novel_domain_judgment",
    "confirm_or_waive_money_permission_todos",
  ];

  const markdown = [
    `# Expert Tester session — ${report.target_url}`,
    "",
    `## Verdict`,
    "",
    `**${headline}**`,
    "",
    verdict_paragraph,
    "",
    `## Critical findings`,
    "",
    ...critical_findings.map((line) => `- ${line}`),
    "",
    `## What was tested`,
    "",
    ...what_was_tested.map((line) => `- ${line}`),
    "",
    `## What was NOT tested`,
    "",
    ...what_was_not_tested.map((line) => `- ${line}`),
    "",
    `## Next actions`,
    "",
    ...next_actions.map((line) => `- ${line}`),
    "",
    `## Human still required`,
    "",
    ...human_must.map((line) => `- ${line}`),
    "",
    `_Generated deterministically from MCP evidence — not a substitute for human Expert accountability._`,
  ].join("\n");

  return {
    schema_version: "1.0.0",
    voice: "senior_expert_tester",
    headline,
    verdict_paragraph,
    critical_findings,
    what_was_tested,
    what_was_not_tested,
    next_actions,
    human_must,
    markdown,
  };
}

export function expertSessionReportJson(report: ExpertSessionReport): JsonObject {
  return {
    schema_version: report.schema_version,
    voice: report.voice,
    headline: report.headline,
    verdict_paragraph: report.verdict_paragraph,
    critical_findings: [...report.critical_findings],
    what_was_tested: [...report.what_was_tested],
    what_was_not_tested: [...report.what_was_not_tested],
    next_actions: [...report.next_actions],
    human_must: [...report.human_must],
    markdown: report.markdown,
  };
}
