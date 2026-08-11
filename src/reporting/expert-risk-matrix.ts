/**
 * Lightweight Expert risk strategy matrix — impact × likelihood from
 * G0 smells + domain pack tags. Deterministic heuristic, not a full
 * product risk model. Senior Expert uses this to prioritize, not to ship.
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { ExpertRiskSignals } from "./expert-risk-signals.js";
import type { DomainPackGateInput } from "./expert-checklist.js";

export type RiskImpact = "critical" | "high" | "medium" | "low";
export type RiskLikelihood = "high" | "medium" | "low";
export type RiskPriority = "P0" | "P1" | "P2" | "P3";

export type ExpertRiskMatrixRow = Readonly<{
  id: string;
  title: string;
  impact: RiskImpact;
  likelihood: RiskLikelihood;
  priority: RiskPriority;
  rationale: string;
  mitigation: string;
  exercised: boolean;
}>;

export type ExpertRiskMatrix = Readonly<{
  schema_version: "1.0.0";
  rows: readonly ExpertRiskMatrixRow[];
  p0_open: number;
  p1_open: number;
  note: string;
}>;

export function buildExpertRiskMatrix(input: {
  signals: ExpertRiskSignals;
  domain_pack?: DomainPackGateInput;
  hook_coverage: Readonly<{
    role_compare_ran: boolean;
    openapi_cases_added: boolean;
    journey_cases_added: boolean;
    any_expected_network_on_ac: boolean;
  }>;
  extension_executed?: Readonly<{
    api_ran: boolean;
    journey_ran: boolean;
  }>;
}): ExpertRiskMatrix {
  const rows: ExpertRiskMatrixRow[] = [];

  if (input.signals.needs_roles) {
    rows.push(
      row(
        "risk-authz",
        "Role / authorization divergence",
        "high",
        "high",
        "Multi-role language in AC/request — wrong visibility or privilege is common escape.",
        "Run role_b compare + API authz negatives; confirm matrix with human.",
        input.hook_coverage.role_compare_ran,
      ),
    );
  }
  if (input.signals.needs_api_authz) {
    rows.push(
      row(
        "risk-api-authz",
        "API authz / unauthenticated access",
        "critical",
        "medium",
        "API/OpenAPI in scope — authz gaps often miss UI-only testing.",
        "Supply openapi + include_authz_negatives; execute smoke in Expert pass.",
        input.hook_coverage.openapi_cases_added && input.extension_executed?.api_ran === true,
      ),
    );
  }
  if (input.signals.needs_money_oracles) {
    rows.push(
      row(
        "risk-money",
        "Money / ledger oracle integrity",
        "critical",
        "medium",
        "Payment/billing language without UI→API oracle risks silent money bugs.",
        "Add expected_network on AC; confirm money-flows.md with human.",
        input.hook_coverage.any_expected_network_on_ac,
      ),
    );
  }
  if (input.signals.needs_journeys) {
    rows.push(
      row(
        "risk-journey",
        "Multi-page workflow breakage",
        "high",
        "medium",
        "Journey/workflow language — single-screen AC misses hop failures.",
        "include_workflow_journeys + execute journey subset this pass.",
        input.hook_coverage.journey_cases_added && input.extension_executed?.journey_ran === true,
      ),
    );
  }
  if (input.signals.needs_session_login) {
    rows.push(
      row(
        "risk-session",
        "Session / auth gate regression",
        "high",
        "medium",
        "Session-gated screen — cookie/expiry/role mix-ups are frequent.",
        "Keep login_* stable via secret_ref; retest after auth changes.",
        true,
      ),
    );
  }
  if (input.domain_pack?.high_risk_unconfirmed) {
    rows.push(
      row(
        "risk-domain-stub",
        "Unconfirmed domain high-risk stubs",
        "high",
        "high",
        "Domain pack still has money/permission/legacy TODOs.",
        "Human confirm → domain_high_risk_confirmed=true.",
        false,
      ),
    );
  }

  // Always residual rows Expert would keep on the board
  rows.push(
    row(
      "risk-scope-pen",
      "Security / pen-test residual",
      "critical",
      "low",
      "Automation adversarial probes ≠ pen-test engagement.",
      "Human security review when surface is sensitive.",
      false,
    ),
    row(
      "risk-stateful-data",
      "Stateful data / cleanup lifecycle",
      "medium",
      "medium",
      "No durable fixture create→use→cleanup oracle in this loop.",
      "Document data setup/teardown or waive with reason in gaps.",
      false,
    ),
  );

  const open = rows.filter((r) => !r.exercised);
  return {
    schema_version: "1.0.0",
    rows,
    p0_open: open.filter((r) => r.priority === "P0").length,
    p1_open: open.filter((r) => r.priority === "P1").length,
    note: "Heuristic Expert prioritization — not a substitute for a product risk workshop.",
  };
}

export function expertRiskMatrixJson(matrix: ExpertRiskMatrix): JsonObject {
  return {
    schema_version: matrix.schema_version,
    p0_open: matrix.p0_open,
    p1_open: matrix.p1_open,
    note: matrix.note,
    rows: matrix.rows.map((r) => ({ ...r })),
  };
}

/** Open P0 rows block Expert claim_pass (same spirit as e2 mandates). */
export function riskMatrixPassBlockers(matrix: ExpertRiskMatrix): readonly string[] {
  return matrix.rows
    .filter((r) => !r.exercised && (r.priority === "P0" || r.priority === "P1"))
    .filter((r) => r.id !== "risk-scope-pen" && r.id !== "risk-stateful-data")
    .map((r) => `risk_matrix_${r.priority.toLowerCase()}_open:${r.id}`);
}

function row(
  id: string,
  title: string,
  impact: RiskImpact,
  likelihood: RiskLikelihood,
  rationale: string,
  mitigation: string,
  exercised: boolean,
): ExpertRiskMatrixRow {
  return {
    id,
    title,
    impact,
    likelihood,
    priority: prioritize(impact, likelihood),
    rationale,
    mitigation,
    exercised,
  };
}

function prioritize(impact: RiskImpact, likelihood: RiskLikelihood): RiskPriority {
  const score =
    ({ critical: 4, high: 3, medium: 2, low: 1 }[impact] ?? 1) *
    ({ high: 3, medium: 2, low: 1 }[likelihood] ?? 1);
  if (score >= 12) return "P0";
  if (score >= 8) return "P1";
  if (score >= 4) return "P2";
  return "P3";
}
