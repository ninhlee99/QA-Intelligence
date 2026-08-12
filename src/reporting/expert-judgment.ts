/**
 * Senior Expert Tester judgment layer — charter, oracle strength,
 * confidence calibration, stopping rule, structured waive, next charter.
 * Deterministic heuristics. Never invents product intent or release authority.
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { ExpertRiskSignals, ExpertHookCoverage, ExpertMandateBlocker } from "./expert-risk-signals.js";
import type { ExpertRiskMatrix } from "./expert-risk-matrix.js";
import type { AcQualityReview } from "./ac-quality-review.js";
import type { DomainPackGateInput } from "./expert-checklist.js";
import type { QaRunReport } from "./qa-run-report.js";
import type { GitBlastRadius } from "../discovery/git-blast-radius.js";

export type OracleStrength = "strong" | "medium" | "weak" | "none";

export type AcOracleStrengthRow = Readonly<{
  ac_id: string;
  strength: OracleStrength;
  reasons: readonly string[];
}>;

export type ExpertConfidenceBand = "high" | "medium" | "low" | "very_low";

export type ExpertStoppingDecision = Readonly<{
  stop_automation_loop: boolean;
  reason: string;
  diminishing_returns: boolean;
  continue_with: readonly string[];
}>;

export type StructuredWaive = Readonly<{
  id: string;
  risk_id: string;
  reason_code: string;
  rationale: string;
  accepted_by: "host_declared" | "none";
}>;

export type ExpertSessionCharter = Readonly<{
  schema_version: "1.0.0";
  mission: string;
  in_scope: readonly string[];
  out_of_scope: readonly string[];
  success_signals: readonly string[];
  stop_when: readonly string[];
  time_box_mindset_minutes: number;
}>;

export type NextExploratoryCharter = Readonly<{
  schema_version: "1.0.0";
  title: string;
  objective: string;
  time_box_minutes: number;
  focus_areas: readonly string[];
  risks_to_probe: readonly string[];
  oracles: readonly string[];
  out_of_scope: readonly string[];
  trigger: string;
}>;

export type ExpertJudgment = Readonly<{
  schema_version: "1.0.0";
  voice: "senior_expert_tester";
  charter: ExpertSessionCharter;
  oracle_strength: Readonly<{
    rows: readonly AcOracleStrengthRow[];
    weak_or_none_count: number;
    strong_count: number;
  }>;
  confidence: Readonly<{
    band: ExpertConfidenceBand;
    score_0_to_100: number;
    reasons: readonly string[];
  }>;
  stopping: ExpertStoppingDecision;
  waives: readonly StructuredWaive[];
  next_exploratory_charter: NextExploratoryCharter | null;
  senior_verdict_line: string;
  note: string;
}>;

export type BuildExpertJudgmentInput = Readonly<{
  report: QaRunReport;
  risk_signals: ExpertRiskSignals;
  hook_coverage: ExpertHookCoverage;
  mandate_blockers: readonly ExpertMandateBlocker[];
  risk_matrix: ExpertRiskMatrix;
  ac_quality: AcQualityReview;
  acceptance_criteria: readonly JsonObject[];
  domain_pack?: DomainPackGateInput;
  git_blast_radius?: GitBlastRadius;
  claim_pass_allowed: boolean;
  extension_execution?: Readonly<{
    api_ran: boolean;
    journey_ran: boolean;
    api_attempted: number;
    journey_attempted: number;
  }>;
  declared_waives?: readonly Readonly<{
    risk_id: string;
    reason_code: string;
    rationale: string;
  }>[];
}>;

const ORACLE_KEYS = [
  "expected_network",
  "expected_text",
  "expected_url_includes",
  "expected_title_includes",
  "expected_result_count",
] as const;

export function assessAcOracleStrength(acceptanceCriteria: readonly JsonObject[]): readonly AcOracleStrengthRow[] {
  return acceptanceCriteria.map((ac, i) => {
    const ac_id = typeof ac["id"] === "string" && ac["id"].trim() ? ac["id"].trim() : `ac-${i + 1}`;
    const reasons: string[] = [];
    let score = 0;

    const hasText = typeof ac["expected_text"] === "string" && String(ac["expected_text"]).trim().length > 0;
    const hasUrl = typeof ac["expected_url_includes"] === "string" && String(ac["expected_url_includes"]).trim().length > 0;
    const hasTitle =
      typeof ac["expected_title_includes"] === "string" && String(ac["expected_title_includes"]).trim().length > 0;
    const net = ac["expected_network"];
    const hasNet = typeof net === "object" && net !== null && !Array.isArray(net);

    if (hasText) {
      score += 2;
      reasons.push("expected_text present");
    }
    if (hasUrl) {
      score += 2;
      reasons.push("expected_url_includes present");
    }
    if (hasTitle) {
      score += 1;
      reasons.push("expected_title_includes present");
    }
    if (hasNet) {
      score += 3;
      reasons.push("expected_network (UI→API) present — strong coupling oracle");
    }

    const statement = typeof ac["statement"] === "string" ? ac["statement"].trim() : "";
    if (statement.length >= 40) {
      score += 1;
      reasons.push("statement detailed enough to guide observation");
    } else if (statement.length > 0) {
      reasons.push("statement short — Expert prefers observable SHALL language");
    } else {
      reasons.push("empty statement");
    }

    const anyOracle = ORACLE_KEYS.some((k) => {
      const v = ac[k];
      return typeof v === "string" ? v.trim().length > 0 : typeof v === "object" && v !== null;
    });
    if (!anyOracle) {
      return { ac_id, strength: "none" as const, reasons: [...reasons, "no executable oracle"] };
    }
    if (score >= 6) return { ac_id, strength: "strong" as const, reasons };
    if (score >= 3) return { ac_id, strength: "medium" as const, reasons };
    return { ac_id, strength: "weak" as const, reasons };
  });
}

export function buildExpertJudgment(input: BuildExpertJudgmentInput): ExpertJudgment {
  const oracleRows = assessAcOracleStrength(input.acceptance_criteria);
  const weakOrNone = oracleRows.filter((r) => r.strength === "weak" || r.strength === "none");
  const strong = oracleRows.filter((r) => r.strength === "strong");

  const charter = buildCharter(input);
  const confidence = calibrateConfidence(input, oracleRows);
  const stopping = decideStopping(input, confidence.band);
  const waives = normalizeWaives(input.declared_waives);
  const nextCharter = suggestNextExploratory(input);

  const senior_verdict_line = input.claim_pass_allowed
    ? `Scoped automation gate green (confidence ${confidence.band}/${confidence.score_0_to_100}). Human release_signoff still required — I would not personally ship on automation alone.`
    : `I refuse a pass claim (confidence ${confidence.band}/${confidence.score_0_to_100}). Gate ${input.report.release_recommendation}. Lead with blockers, not pass-count.`;

  return {
    schema_version: "1.0.0",
    voice: "senior_expert_tester",
    charter,
    oracle_strength: {
      rows: oracleRows,
      weak_or_none_count: weakOrNone.length,
      strong_count: strong.length,
    },
    confidence,
    stopping,
    waives,
    next_exploratory_charter: nextCharter,
    senior_verdict_line,
    note: "Judgment heuristics mirror how a Senior Expert closes a session — not a substitute for human accountability.",
  };
}

export function expertJudgmentJson(judgment: ExpertJudgment): JsonObject {
  return {
    schema_version: judgment.schema_version,
    voice: judgment.voice,
    senior_verdict_line: judgment.senior_verdict_line,
    note: judgment.note,
    charter: {
      schema_version: judgment.charter.schema_version,
      mission: judgment.charter.mission,
      in_scope: [...judgment.charter.in_scope],
      out_of_scope: [...judgment.charter.out_of_scope],
      success_signals: [...judgment.charter.success_signals],
      stop_when: [...judgment.charter.stop_when],
      time_box_mindset_minutes: judgment.charter.time_box_mindset_minutes,
    },
    oracle_strength: {
      weak_or_none_count: judgment.oracle_strength.weak_or_none_count,
      strong_count: judgment.oracle_strength.strong_count,
      rows: judgment.oracle_strength.rows.map((r) => ({
        ac_id: r.ac_id,
        strength: r.strength,
        reasons: [...r.reasons],
      })),
    },
    confidence: {
      band: judgment.confidence.band,
      score_0_to_100: judgment.confidence.score_0_to_100,
      reasons: [...judgment.confidence.reasons],
    },
    stopping: {
      stop_automation_loop: judgment.stopping.stop_automation_loop,
      reason: judgment.stopping.reason,
      diminishing_returns: judgment.stopping.diminishing_returns,
      continue_with: [...judgment.stopping.continue_with],
    },
    waives: judgment.waives.map((w) => ({ ...w })),
    next_exploratory_charter: judgment.next_exploratory_charter
      ? {
          schema_version: judgment.next_exploratory_charter.schema_version,
          title: judgment.next_exploratory_charter.title,
          objective: judgment.next_exploratory_charter.objective,
          time_box_minutes: judgment.next_exploratory_charter.time_box_minutes,
          focus_areas: [...judgment.next_exploratory_charter.focus_areas],
          risks_to_probe: [...judgment.next_exploratory_charter.risks_to_probe],
          oracles: [...judgment.next_exploratory_charter.oracles],
          out_of_scope: [...judgment.next_exploratory_charter.out_of_scope],
          trigger: judgment.next_exploratory_charter.trigger,
        }
      : null,
  };
}

/** No executable oracle blocks pass — weak oracles are advisory in judgment. */
export function oracleStrengthPassBlockers(
  judgment: Pick<ExpertJudgment, "oracle_strength">,
): readonly string[] {
  return judgment.oracle_strength.rows
    .filter((r) => r.strength === "none")
    .map((r) => `oracle_weak:none:${r.ac_id}`);
}

function buildCharter(input: BuildExpertJudgmentInput): ExpertSessionCharter {
  const in_scope: string[] = [
    `UI/AC automation on ${input.report.target_url}`,
    "Naming a11y smoke on discovery capture",
    "Variant design (pos/neg/boundary/adversarial) where oracles bind",
  ];
  if (input.hook_coverage.role_compare_ran) in_scope.push("Dual-role named-control compare");
  if (input.extension_execution?.api_attempted) in_scope.push("Capped OpenAPI/API smoke subset");
  if (input.extension_execution?.journey_attempted) in_scope.push("Capped multi-page journey subset");
  if (input.git_blast_radius?.available) in_scope.push("Git blast-radius hint scan (filenames only)");

  const out_of_scope = [
    "Human release sign-off / legal accountability",
    "Full WCAG/axe certification",
    "Load/performance certification",
    "True penetration / adversarial security engagement",
    "Complete API authz matrix across all principals",
    "Durable create→use→cleanup data lifecycle oracles",
    "Novel domain product truth beyond domain-pack stubs",
  ];

  const success_signals = [
    "release_recommendation stated first; claim_pass_allowed honored",
    "Every not_executed / fail / flake surfaced — never silent pass",
    "coverage_gaps + risk matrix open rows visible to the user",
    "Targeted retest plan when anything failed/flaky",
  ];

  const stop_when = [
    "Blockers cleared or explicitly waived with structured reason_code",
    "Diminishing returns: remaining work is pen-test / novel domain / human judgment",
    "Evidence quality insufficient — push back on AC rather than invent oracles",
  ];

  const interactiveProxy =
    input.report.summary.generated +
    input.report.accessibility_smoke.element_count / 4 +
    (input.mandate_blockers.length + input.risk_matrix.p0_open) * 5;
  const time_box_mindset_minutes = interactiveProxy <= 8 ? 25 : interactiveProxy <= 20 ? 45 : 75;

  return {
    schema_version: "1.0.0",
    mission: `Senior Expert session: evidence whether ${input.report.requirement_ref} holds on ${input.report.target_url} without green-washing gaps.`,
    in_scope,
    out_of_scope,
    success_signals,
    stop_when,
    time_box_mindset_minutes,
  };
}

function calibrateConfidence(
  input: BuildExpertJudgmentInput,
  oracleRows: readonly AcOracleStrengthRow[],
): ExpertJudgment["confidence"] {
  let score = 55;
  const reasons: string[] = [];

  if (input.report.summary.failed === 0 && input.report.summary.flaky === 0) {
    score += 10;
    reasons.push("No fail/flaky in executed set");
  } else {
    score -= 20;
    reasons.push("Fail/flaky present — confidence in green gate drops");
  }
  if (input.report.summary.not_executed > 0) {
    score -= Math.min(15, input.report.summary.not_executed * 3);
    reasons.push(`${input.report.summary.not_executed} not_executed — unverifiable`);
  }

  const strong = oracleRows.filter((r) => r.strength === "strong").length;
  const weak = oracleRows.filter((r) => r.strength === "weak" || r.strength === "none").length;
  score += Math.min(15, strong * 4);
  score -= Math.min(20, weak * 5);
  if (strong > 0) reasons.push(`${strong} strong oracle AC(s)`);
  if (weak > 0) reasons.push(`${weak} weak/none oracle AC(s)`);

  if (input.mandate_blockers.length > 0) {
    score -= Math.min(25, input.mandate_blockers.length * 8);
    reasons.push(`${input.mandate_blockers.length} E2 mandate(s) open`);
  }
  if (input.risk_matrix.p0_open > 0) {
    score -= Math.min(20, input.risk_matrix.p0_open * 10);
    reasons.push(`${input.risk_matrix.p0_open} open P0 risk row(s)`);
  }
  if (input.domain_pack?.present) {
    score += 5;
    reasons.push("Domain pack present");
    if (input.domain_pack.high_risk_unconfirmed) {
      score -= 12;
      reasons.push("Domain high-risk stubs unconfirmed");
    }
  } else {
    score -= 10;
    reasons.push("Domain pack absent/unknown");
  }
  if (input.hook_coverage.role_compare_ran) {
    score += 4;
    reasons.push("Role compare exercised");
  }
  if (input.extension_execution?.api_ran) {
    score += 4;
    reasons.push("API smoke subset executed");
  }
  if (input.extension_execution?.journey_ran) {
    score += 3;
    reasons.push("Journey subset executed");
  }
  if (input.ac_quality.findings.some((f) => f.severity === "high")) {
    score -= 8;
    reasons.push("High AC quality findings");
  }
  if (input.git_blast_radius?.hotspots && input.git_blast_radius.hotspots.length > 0) {
    score -= 3;
    reasons.push("Git hotspots present — retest aim still human-mapped");
  }

  score = Math.max(5, Math.min(92, score));
  if (score > 85) score = 85;

  let band: ExpertConfidenceBand = "medium";
  if (score >= 72) band = "high";
  else if (score >= 50) band = "medium";
  else if (score >= 30) band = "low";
  else band = "very_low";

  if (band === "high") {
    reasons.push("High only for scoped automation gate — never equals human release certainty");
  }

  return { band, score_0_to_100: score, reasons };
}

function decideStopping(
  input: BuildExpertJudgmentInput,
  band: ExpertConfidenceBand,
): ExpertStoppingDecision {
  const continue_with: string[] = [];
  for (const b of input.mandate_blockers) continue_with.push(`Close ${b.code}`);
  for (const row of input.risk_matrix.rows.filter((r) => !r.exercised && (r.priority === "P0" || r.priority === "P1"))) {
    if (row.id === "risk-scope-pen" || row.id === "risk-stateful-data") continue;
    continue_with.push(`Mitigate ${row.id}: ${row.mitigation}`);
  }
  if (input.report.summary.failed + input.report.summary.flaky > 0) {
    continue_with.push("Targeted retest failed/flaky case_ids after fix");
  }
  if (input.ac_quality.findings.some((f) => f.severity === "high")) {
    continue_with.push("Push back on high-severity AC quality findings");
  }

  const residualOnly =
    continue_with.length === 0 &&
    (band === "high" || band === "medium") &&
    input.mandate_blockers.length === 0;

  if (residualOnly) {
    return {
      stop_automation_loop: true,
      diminishing_returns: true,
      reason:
        "Automation loop hit diminishing returns — remaining work is human judgment (release_signoff, pen-test, novel domain, stateful lifecycle).",
      continue_with: [
        "Request human release_signoff",
        "Optional: run generate_exploratory_charter / run_depth_smokes if surface is sensitive",
        "Optional: confirm money/permission TODOs if pack still stubby",
      ],
    };
  }

  if (input.report.summary.failed > 0 || input.report.summary.flaky > 0) {
    return {
      stop_automation_loop: true,
      diminishing_returns: false,
      reason: "Stop full-suite burn — fix then targeted retest only.",
      continue_with: continue_with.slice(0, 8),
    };
  }

  return {
    stop_automation_loop: false,
    diminishing_returns: false,
    reason: "Open Expert work remains before a responsible session close.",
    continue_with: continue_with.slice(0, 8),
  };
}

function normalizeWaives(
  declared:
    | readonly Readonly<{ risk_id: string; reason_code: string; rationale: string }>[]
    | undefined,
): readonly StructuredWaive[] {
  if (!declared || declared.length === 0) return [];
  return declared
    .filter((w) => w.risk_id.trim() && w.reason_code.trim() && w.rationale.trim().length >= 12)
    .map((w, i) => ({
      id: `waive-${i + 1}`,
      risk_id: w.risk_id.trim(),
      reason_code: w.reason_code.trim(),
      rationale: w.rationale.trim(),
      accepted_by: "host_declared" as const,
    }));
}

function suggestNextExploratory(input: BuildExpertJudgmentInput): NextExploratoryCharter | null {
  const triggers: string[] = [];
  if (input.mandate_blockers.length > 0) triggers.push("open E2 mandates");
  if (input.risk_matrix.p0_open + input.risk_matrix.p1_open > 0) triggers.push("open P0/P1 risks");
  if (input.report.generation_findings.length > 0) triggers.push("unbindable AC");
  if (input.git_blast_radius?.hotspots && input.git_blast_radius.hotspots.length > 0) {
    triggers.push("git hotspots");
  }
  if (input.risk_signals.needs_money_oracles && !input.hook_coverage.any_expected_network_on_ac) {
    triggers.push("money without network oracle");
  }

  if (triggers.length === 0 && input.claim_pass_allowed) {
    return {
      schema_version: "1.0.0",
      title: `Post-gate exploratory — ${input.report.target_url}`,
      objective:
        "Time-box free exploration for surprises automation oracles cannot see (empty states, double-submit, back-button, unclear errors).",
      time_box_minutes: 20,
      focus_areas: [
        "Empty/whitespace/oversized inputs on editable fields",
        "Double-submit and cancel/back on primary actions",
        "Error copy honesty (no stack traces / silent success)",
      ],
      risks_to_probe: ["Silent success", "Validation inconsistency", "Session reload/back quirks"],
      oracles: [
        "Every action yields observable feedback",
        "No raw exception text in UI",
        "Destructive actions confirmed or reversible",
      ],
      out_of_scope: ["Pen-test", "Load test", "Full WCAG audit"],
      trigger: "automation_gate_green_human_still_explores",
    };
  }
  if (triggers.length === 0) return null;

  const focus: string[] = [];
  const risks: string[] = [];
  if (input.risk_signals.needs_roles) {
    focus.push("Wrong-role visibility and privilege escape on named controls");
    risks.push("Authz gap between UI affordance and API enforcement");
  }
  if (input.risk_signals.needs_api_authz) {
    focus.push("Unauthenticated / wrong-role API calls for discovered endpoints");
    risks.push("API authz bypass");
  }
  if (input.risk_signals.needs_money_oracles) {
    focus.push("Money path with UI→API coupling and ledger-visible side effects");
    risks.push("Silent money mutation");
  }
  if (input.risk_signals.needs_journeys) {
    focus.push("Multi-page hop failures and state loss between steps");
    risks.push("Workflow breakage mid-journey");
  }
  for (const hotspot of (input.git_blast_radius?.hotspots ?? []).slice(0, 5)) {
    focus.push(`Blast-radius path: ${hotspot}`);
  }
  if (focus.length === 0) {
    focus.push("Probe unbound AC areas and unclear error feedback");
  }

  return {
    schema_version: "1.0.0",
    title: `Follow-up exploratory — ${input.report.target_url}`,
    objective: `Close Expert gaps (${triggers.join("; ")}) with time-boxed exploration grounded in live UI — do not invent AC.`,
    time_box_minutes: triggers.length >= 3 ? 45 : 30,
    focus_areas: focus.slice(0, 8),
    risks_to_probe: risks.length > 0 ? risks : ["Functional surprise outside scripted variants"],
    oracles: [
      "No stack traces / internal errors in UI",
      "State-changing actions leave observable confirmation",
      "Evidence captured (screenshot/trace) for any anomaly",
    ],
    out_of_scope: [
      "Claiming pen-test coverage",
      "Inventing acceptance criteria",
      "Full-suite re-burn when only subset failed",
    ],
    trigger: triggers.join("|"),
  };
}
