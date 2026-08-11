/**
 * Expert Tester checklist derived from a QA run — host Skills MUST honor
 * `claim_pass_allowed` and call `validate_expert_claim` before pass language.
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { ReleaseRecommendation } from "./qa-professional-analysis.js";
import type { QaRunReport, QaRunTestCaseResult } from "./qa-run-report.js";

export type DomainPackGateInput = Readonly<{
  /** INDEX.md (or pack) exists under product root. */
  present: boolean;
  /** money|permission|legacy|pii still marked TODO / draft without human confirm. */
  high_risk_unconfirmed: boolean;
  /** Host explicitly accepts testing without a pack (records as gap, not pass). */
  acknowledged_absent?: boolean;
  /** Host confirms high-risk TODOs reviewed for this claim. */
  high_risk_confirmed?: boolean;
  pack_path?: string;
  notes?: readonly string[];
}>;

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
  domain_pack?: DomainPackGateInput;
  context: "run_auto_qa" | "run_regression_suite" | "run_expert_qa";
}>;

/** Prefixes that always refuse claim_pass_allowed. */
const PASS_BLOCKING_PREFIXES = [
  "gate:",
  "failed_",
  "flaky_",
  "not_executed_",
  "draft_defects:",
  "coverage_gaps_empty",
  "domain_pack_absent",
  "domain_high_risk_unconfirmed",
  "suite_missing",
] as const;

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

  const domain = input.domain_pack;
  if (domain === undefined) {
    blockers.push("domain_pack_absent:status_unknown");
  } else if (!domain.present) {
    if (domain.acknowledged_absent === true) {
      satisfied.push("domain_pack_absent_acknowledged");
      blockers.push("domain_pack_absent:acknowledged_not_pass");
    } else {
      blockers.push("domain_pack_absent");
    }
  } else {
    satisfied.push("domain_pack_present");
    if (domain.high_risk_unconfirmed && domain.high_risk_confirmed !== true) {
      blockers.push("domain_high_risk_unconfirmed");
    } else if (domain.high_risk_unconfirmed && domain.high_risk_confirmed === true) {
      satisfied.push("domain_high_risk_confirmed_by_host");
    } else {
      satisfied.push("domain_high_risk_clear_or_none");
    }
  }

  if (
    (input.context === "run_auto_qa" || input.context === "run_expert_qa") &&
    input.suite_id_present !== true
  ) {
    blockers.push("suite_missing");
  } else if (input.suite_id_present === true) {
    satisfied.push("suite_id_present");
  }

  const host_actions: string[] = [
    "State release_recommendation as the first verdict — never lead with pass-count.",
    "Paste coverage_gaps (and domain risks not tested) into the user-facing result.",
    "Follow smart_retest_suggestion for targeted retest after fixes (suite_id when present).",
    "Before any pass/ready/ship wording: call validate_expert_claim with this checklist.",
    "On next session G0: call list_failure_avoidance_hints (and list_learning_candidates).",
    "Human still required for release sign-off, pen-test, and novel domain judgment.",
  ];

  if (blockers.some((b) => b.startsWith("domain_pack_absent"))) {
    host_actions.unshift(
      "Bootstrap domain pack via run_expert_qa(product_root) or bootstrap_domain_pack — or set acknowledge_domain_pack_absent only to record a gap (still not pass).",
    );
  }
  if (blockers.includes("domain_high_risk_unconfirmed")) {
    host_actions.unshift(
      "Confirm money/permission/legacy/pii TODOs with human; re-run with domain_high_risk_confirmed=true only after confirm.",
    );
  }
  if (blockers.includes("suite_missing")) {
    host_actions.unshift(
      "Suite was not auto-registered — re-run with registry or register_regression_suite before claiming complete Expert loop.",
    );
  }
  if (input.smart_retest_action === "targeted_retest") {
    host_actions.unshift(
      "Do NOT re-run the full suite — use case_ids / related_defect_ids from smart_retest_suggestion.",
    );
  }

  const hasPassBlockingBlocker = blockers.some((b) =>
    PASS_BLOCKING_PREFIXES.some((prefix) => b === prefix || b.startsWith(prefix)),
  );

  const claim_pass_allowed =
    input.release_recommendation === "recommend_release" &&
    input.summary.failed === 0 &&
    input.summary.flaky === 0 &&
    input.summary.not_executed === 0 &&
    input.draft_defect_count === 0 &&
    input.coverage_gap_count > 0 &&
    !hasPassBlockingBlocker;

  return {
    schema_version: "1.1.0",
    context: input.context,
    claim_pass_allowed,
    claim_pass_allowed_meaning:
      "Host may say 'pass/ready/ship' only when true AND validate_expert_claim allows. If false, report incomplete or blocked — never green-wash. Human release_signoff still required even when true.",
    blockers,
    satisfied,
    host_actions,
    gate: {
      release_recommendation: input.release_recommendation,
      rationale: input.release_recommendation_rationale,
    },
    domain_pack: domain
      ? {
          present: domain.present,
          high_risk_unconfirmed: domain.high_risk_unconfirmed,
          acknowledged_absent: domain.acknowledged_absent === true,
          high_risk_confirmed: domain.high_risk_confirmed === true,
          ...(domain.pack_path !== undefined ? { pack_path: domain.pack_path } : {}),
          ...(domain.notes !== undefined ? { notes: [...domain.notes] } : {}),
        }
      : { present: false, high_risk_unconfirmed: false, status: "unknown" },
    human_still_required: ["release_signoff", "pen_test", "novel_domain_judgment"],
  };
}

export type ExpertChecklistFromReportOptions = Readonly<{
  suiteIdPresent?: boolean;
  domainPack?: DomainPackGateInput;
  context?: ExpertChecklistInput["context"];
}>;

export function expertChecklistFromQaRunReport(
  report: QaRunReport,
  coverageGapCount: number,
  smartRetestAction: string,
  suiteIdPresentOrOptions: boolean | ExpertChecklistFromReportOptions = false,
): JsonObject {
  const options: ExpertChecklistFromReportOptions =
    typeof suiteIdPresentOrOptions === "boolean"
      ? { suiteIdPresent: suiteIdPresentOrOptions }
      : suiteIdPresentOrOptions;
  return deriveExpertChecklist({
    release_recommendation: report.release_recommendation,
    release_recommendation_rationale: report.release_recommendation_rationale,
    test_cases: report.test_cases,
    summary: report.summary,
    draft_defect_count: report.draft_defects.length,
    coverage_gap_count: coverageGapCount,
    smart_retest_action: smartRetestAction,
    suite_id_present: options.suiteIdPresent === true,
    ...(options.domainPack !== undefined ? { domain_pack: options.domainPack } : {}),
    context: options.context ?? "run_auto_qa",
  });
}

const PASS_CLAIM_PATTERN =
  /\b(pass|passed|ready\s+to\s+(ship|release|merge)|ship\s+it|all\s+good|lgtm|safe\s+to\s+(merge|release)|recommend\s+release)\b/i;

export type ValidateExpertClaimInput = Readonly<{
  proposed_claim: string;
  expert_checklist: JsonObject;
}>;

export type ValidateExpertClaimResult = Readonly<{
  allowed: boolean;
  claim_pass_allowed: boolean;
  refuse_reason: string | null;
  normalized_claim_kind: "pass_like" | "blocked_or_other";
  host_must: readonly string[];
}>;

/**
 * Hard refuse for pass-like host language when checklist.claim_pass_allowed is false.
 * Always reminds human_still_required even when allowed.
 */
export function validateExpertClaim(input: ValidateExpertClaimInput): ValidateExpertClaimResult {
  const checklist = input.expert_checklist;
  const claimPassAllowed = checklist["claim_pass_allowed"] === true;
  const claim = input.proposed_claim.trim();
  const passLike = PASS_CLAIM_PATTERN.test(claim);
  const blockers = Array.isArray(checklist["blockers"])
    ? (checklist["blockers"] as unknown[]).map(String)
    : [];
  const humanStill = Array.isArray(checklist["human_still_required"])
    ? (checklist["human_still_required"] as unknown[]).map(String)
    : ["release_signoff"];

  if (passLike && !claimPassAllowed) {
    return {
      allowed: false,
      claim_pass_allowed: false,
      refuse_reason: `REFUSE pass-like claim while claim_pass_allowed=false. Blockers: ${blockers.join("; ") || "(none listed)"}.`,
      normalized_claim_kind: "pass_like",
      host_must: [
        "Do not tell the user the build is ready/pass/ship.",
        "Report blocked/incomplete with blockers + coverage_gaps.",
        ...humanStill.map((h) => `Human still required: ${h}`),
      ],
    };
  }

  if (passLike && claimPassAllowed) {
    return {
      allowed: true,
      claim_pass_allowed: true,
      refuse_reason: null,
      normalized_claim_kind: "pass_like",
      host_must: [
        "May say automation gate is green — still require human release_signoff.",
        ...humanStill.map((h) => `Human still required: ${h}`),
      ],
    };
  }

  return {
    allowed: true,
    claim_pass_allowed: claimPassAllowed,
    refuse_reason: null,
    normalized_claim_kind: "blocked_or_other",
    host_must: passLike
      ? humanStill.map((h) => `Human still required: ${h}`)
      : ["Keep gate-first wording; do not invent pass."],
  };
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
  <p>Gate: <code>${escapeHtml(String(rec ?? ""))}</code> — Host MUST NOT green-wash if claim_pass_allowed is false. Call <code>validate_expert_claim</code> before pass language.</p>
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
