/**
 * Expert-Tester risk smell detection — mirrors what a senior tester asks in G0
 * and what they refuse to call "done" without exercising.
 */
import type { JsonObject, JsonValue } from "../requirement-review/public.js";

export type ExpertRiskSignals = Readonly<{
  needs_roles: boolean;
  needs_api_authz: boolean;
  needs_money_oracles: boolean;
  needs_journeys: boolean;
  needs_session_login: boolean;
  signals: readonly string[];
}>;

export type ExpertHookCoverage = Readonly<{
  role_compare_ran: boolean;
  openapi_cases_added: boolean;
  journey_cases_added: boolean;
  any_expected_network_on_ac: boolean;
}>;

export type ExpertMandateBlocker = Readonly<{
  code: string;
  message: string;
}>;

const ROLE_RE = /\b(role|roles|admin|rbac|permission|authz|authorization|multi-?user|as\s+user|as\s+admin)\b/i;
const API_RE = /\b(api|openapi|swagger|endpoint|rest|graphql|http\s*status|bearer|jwt)\b/i;
const MONEY_RE = /\b(pay|payment|money|charge|billing|invoice|refund|price|checkout|wallet|ledger)\b/i;
const JOURNEY_RE = /\b(workflow|multi-?page|journey|checkout\s+flow|end-?to-?end|across\s+pages)\b/i;

export function detectExpertRiskSignals(input: {
  request_context?: string;
  requirement_title?: string;
  acceptance_criteria?: readonly JsonObject[];
  has_login_fields?: boolean;
}): ExpertRiskSignals {
  const parts: string[] = [];
  if (input.request_context) parts.push(input.request_context);
  if (input.requirement_title) parts.push(input.requirement_title);
  for (const ac of input.acceptance_criteria ?? []) {
    for (const key of ["statement", "id", "expected_text", "expected_url_includes"] as const) {
      const value = ac[key];
      if (typeof value === "string") parts.push(value);
    }
  }
  const blob = parts.join("\n");
  const signals: string[] = [];

  const needs_roles = ROLE_RE.test(blob);
  if (needs_roles) signals.push("roles/authz language in request/AC");
  const needs_api_authz = API_RE.test(blob);
  if (needs_api_authz) signals.push("API/OpenAPI language in request/AC");
  const needs_money_oracles = MONEY_RE.test(blob);
  if (needs_money_oracles) signals.push("money/payment language in request/AC");
  const needs_journeys = JOURNEY_RE.test(blob);
  if (needs_journeys) signals.push("multi-page/journey language in request/AC");
  const needs_session_login = input.has_login_fields === true;
  if (needs_session_login) signals.push("session login fields supplied");

  return {
    needs_roles,
    needs_api_authz,
    needs_money_oracles,
    needs_journeys,
    needs_session_login,
    signals,
  };
}

export function hookCoverageFromExtensions(
  extensions: JsonObject | undefined,
  acceptanceCriteria: readonly JsonObject[],
): ExpertHookCoverage {
  const role = extensions?.["role_compare_hook"];
  const openapi = extensions?.["openapi_hook"];
  const journey = extensions?.["journey_hook"];
  const roleOk =
    typeof role === "object" && role !== null && !Array.isArray(role) && (role as JsonObject)["ok"] === true;
  const openapiOk =
    typeof openapi === "object" &&
    openapi !== null &&
    !Array.isArray(openapi) &&
    (openapi as JsonObject)["ok"] === true &&
    typeof (openapi as JsonObject)["case_count"] === "number" &&
    ((openapi as JsonObject)["case_count"] as number) > 0;
  const journeyOk =
    typeof journey === "object" &&
    journey !== null &&
    !Array.isArray(journey) &&
    (journey as JsonObject)["ok"] === true &&
    typeof (journey as JsonObject)["journey_cases_added"] === "number" &&
    ((journey as JsonObject)["journey_cases_added"] as number) > 0;

  const anyNetwork = acceptanceCriteria.some((ac) => {
    const net = ac["expected_network"];
    return typeof net === "object" && net !== null && !Array.isArray(net);
  });

  return {
    role_compare_ran: roleOk,
    openapi_cases_added: openapiOk,
    journey_cases_added: journeyOk,
    any_expected_network_on_ac: anyNetwork,
  };
}

/** Expert refuses "done" when G0 smells say exercise X but hooks did not run. */
export function deriveExpertMandateBlockers(
  signals: ExpertRiskSignals,
  coverage: ExpertHookCoverage,
): readonly ExpertMandateBlocker[] {
  const blockers: ExpertMandateBlocker[] = [];
  if (signals.needs_roles && !coverage.role_compare_ran) {
    blockers.push({
      code: "e2_roles_not_exercised",
      message: "Request/AC mentions roles/authz but role_b / role compare did not succeed — Expert would not sign off.",
    });
  }
  if (signals.needs_api_authz && !coverage.openapi_cases_added) {
    blockers.push({
      code: "e2_api_authz_not_exercised",
      message: "API/OpenAPI in scope but openapi/openapi_path hook did not add cases — supply OpenAPI or record gap.",
    });
  }
  if (signals.needs_money_oracles && !coverage.any_expected_network_on_ac) {
    blockers.push({
      code: "e2_money_oracle_weak",
      message: "Money/payment language without expected_network on AC — Expert requires ledger/API oracle or explicit gap.",
    });
  }
  if (signals.needs_journeys && !coverage.journey_cases_added) {
    blockers.push({
      code: "e2_journeys_not_exercised",
      message: "Multi-page/journey language but include_workflow_journeys did not add cases.",
    });
  }
  return blockers;
}

export function buildExpertObservations(input: {
  signals: ExpertRiskSignals;
  coverage: ExpertHookCoverage;
  mandate_blockers: readonly ExpertMandateBlocker[];
  summary: Readonly<{ passed: number; failed: number; flaky: number; not_executed: number }>;
  release_recommendation: string;
  extension_executed?: Readonly<{ api_ran: boolean; journey_ran: boolean }>;
}): JsonObject {
  const observations: string[] = [];
  observations.push(
    `Gate ${input.release_recommendation}: ${input.summary.passed} passed / ${input.summary.failed} failed / ${input.summary.flaky} flaky / ${input.summary.not_executed} not_executed.`,
  );
  if (input.signals.signals.length > 0) {
    observations.push(`Risk smells (G0-style): ${input.signals.signals.join("; ")}.`);
  } else {
    observations.push("No strong G0 risk smells in AC/request text — still not a full product audit.");
  }
  if (input.coverage.role_compare_ran) observations.push("Role surface compare ran (named-control diff only).");
  if (input.coverage.openapi_cases_added) observations.push("OpenAPI smoke cases merged into suite.");
  if (input.coverage.journey_cases_added) {
    observations.push(
      input.extension_executed?.journey_ran
        ? "Workflow journey cases merged and a capped subset executed this pass."
        : "Workflow journey cases merged into suite (execution deferred or skipped this pass).",
    );
  }
  if (input.extension_executed?.api_ran) {
    observations.push("API smoke capped subset executed this Expert pass.");
  }
  if (input.coverage.any_expected_network_on_ac) observations.push("At least one AC carries expected_network UI→API oracle.");
  for (const blocker of input.mandate_blockers) {
    observations.push(`UNTESTED like a human Expert would flag: ${blocker.message}`);
  }
  observations.push(
    "Human still owns release sign-off, pen-test, and novel domain judgment — automation is evidence, not accountability.",
  );

  return {
    schema_version: "1.0.0",
    style: "senior_tester_session_notes",
    observations,
    risk_signals: { ...input.signals, signals: [...input.signals.signals] },
    hook_coverage: { ...input.coverage },
    mandate_blockers: input.mandate_blockers.map((b) => ({ ...b })),
    note: "Written the way an Expert Tester closes a session: what ran, what smelled, what is still open.",
  };
}

export function readAcceptanceCriteriaObjects(
  value: JsonValue | undefined,
): readonly JsonObject[] {
  if (!Array.isArray(value)) return [];
  const out: JsonObject[] = [];
  for (const entry of value) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      out.push(entry as JsonObject);
    }
  }
  return out;
}
