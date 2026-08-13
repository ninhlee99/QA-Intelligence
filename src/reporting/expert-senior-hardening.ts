/**
 * Senior competency hardening — domain enrichment, role-diff mandates,
 * authz-negative preference evidence, session delta, stateful protocol,
 * abuse residual charter, structured waive application.
 * Deterministic. Never invents product truth or release authority.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonObject, JsonValue } from "../requirement-review/public.js";
import type { DomainPackGateInput } from "./expert-checklist.js";
import type { ExpertRiskSignals } from "./expert-risk-signals.js";
import type { GitBlastRadius } from "../discovery/git-blast-radius.js";

export type DomainPackEnrichment = Readonly<{
  schema_version: "1.0.0";
  pack_path?: string;
  money_hints: readonly string[];
  permission_hints: readonly string[];
  legacy_hints: readonly string[];
  money_oracle_suggestions: readonly string[];
  notes: readonly string[];
}>;

export type RoleDiffMandate = Readonly<{
  ran: boolean;
  material_diff: boolean;
  only_in_a_count: number;
  only_in_b_count: number;
  blocker?: string;
  message?: string;
}>;

export type AuthzNegativeCoverage = Readonly<{
  openapi_cases_added: boolean;
  authz_negative_cases_present: boolean;
  wrong_role_cases_present: boolean;
  api_executed: boolean;
  blocker?: string;
}>;

export type SessionDelta = Readonly<{
  schema_version: "1.0.0";
  available: boolean;
  message: string;
  prior_suite_id?: string;
  prior_case_count?: number;
  current_case_count: number;
  case_count_delta?: number;
  note: string;
}>;

export type StatefulLifecycleProtocol = Readonly<{
  schema_version: "1.0.0";
  covered: boolean;
  waived: boolean;
  blocker?: string;
  checklist: readonly string[];
  message: string;
}>;

export type AbuseResidualCharter = Readonly<{
  schema_version: "1.0.0";
  title: string;
  objective: string;
  time_box_minutes: number;
  probes: readonly string[];
  out_of_scope: readonly string[];
  note: string;
}>;

export type SeniorHardeningBundle = Readonly<{
  schema_version: "1.0.0";
  domain_enrichment: DomainPackEnrichment;
  role_diff: RoleDiffMandate;
  authz_negatives: AuthzNegativeCoverage;
  session_delta: SessionDelta;
  stateful: StatefulLifecycleProtocol;
  abuse_residual: AbuseResidualCharter;
  depth_smoke_recommended: boolean;
  depth_smoke_reason: string;
  pass_blockers: readonly string[];
  gaps: readonly JsonObject[];
}>;

export function enrichDomainPack(domain: DomainPackGateInput | undefined): DomainPackEnrichment {
  if (!domain?.present || !domain.pack_path || !existsSync(domain.pack_path)) {
    return {
      schema_version: "1.0.0",
      money_hints: [],
      permission_hints: [],
      legacy_hints: [],
      money_oracle_suggestions: [],
      notes: ["Domain pack absent — Expert cannot enrich money/permission oracles from product knowledge."],
    };
  }
  const pack = domain.pack_path;
  const money = readMdSnippets(join(pack, "money-flows.md"));
  const perms = readMdSnippets(join(pack, "permissions.md"));
  const legacy = readMdSnippets(join(pack, "legacy.md"));
  const suggestions: string[] = [];
  if (money.raw.length > 0) {
    if (/TODO|stub|draft|<!--/i.test(money.raw)) {
      suggestions.push("money-flows.md still stubby — human must confirm ledger oracles before money claims.");
    } else {
      suggestions.push("Bind money AC with expected_network matching documented payment/ledger endpoints.");
      const urls = money.raw.match(/\/[a-z0-9_\/-]{3,}/gi)?.slice(0, 5) ?? [];
      for (const u of urls) {
        suggestions.push(`Consider expected_network.url_includes ≈ "${u}" from money-flows.md (verify with human).`);
      }
    }
  } else {
    suggestions.push("No money-flows.md — if money smell present, create pack file before claiming money coverage.");
  }

  return {
    schema_version: "1.0.0",
    pack_path: pack,
    money_hints: money.hints,
    permission_hints: perms.hints,
    legacy_hints: legacy.hints,
    money_oracle_suggestions: suggestions.slice(0, 8),
    notes: [
      ...(domain.notes ?? []),
      money.raw.length > 0 ? "money-flows.md read" : "money-flows.md missing",
      perms.raw.length > 0 ? "permissions.md read" : "permissions.md missing",
    ],
  };
}

export function assessRoleDiffMandate(extensions: JsonObject | undefined): RoleDiffMandate {
  const hook = extensions?.["role_compare_hook"];
  if (typeof hook !== "object" || hook === null || Array.isArray(hook)) {
    return { ran: false, material_diff: false, only_in_a_count: 0, only_in_b_count: 0 };
  }
  const obj = hook as JsonObject;
  if (obj["ok"] !== true) {
    return { ran: false, material_diff: false, only_in_a_count: 0, only_in_b_count: 0 };
  }
  const onlyA = Array.isArray(obj["only_in_a"]) ? obj["only_in_a"] : [];
  const onlyB = Array.isArray(obj["only_in_b"]) ? obj["only_in_b"] : [];
  const material = onlyA.length + onlyB.length > 0;
  if (!material) {
    return {
      ran: true,
      material_diff: false,
      only_in_a_count: 0,
      only_in_b_count: 0,
      message: "Role surfaces share named controls — still not a full authz model.",
    };
  }
  return {
    ran: true,
    material_diff: true,
    only_in_a_count: onlyA.length,
    only_in_b_count: onlyB.length,
    blocker: "e2_role_surface_diff_untriaged",
    message: `Role compare found ${onlyA.length} only_in_a + ${onlyB.length} only_in_b named controls — Senior Expert triages authz intent or files defects before pass.`,
  };
}

export function assessAuthzNegativeCoverage(input: {
  extension_cases: readonly Readonly<{ kind: string; case?: Readonly<{ id: string; auth?: string }> }>[];
  openapi_cases_added: boolean;
  api_ran: boolean;
  needs_api_authz: boolean;
}): AuthzNegativeCoverage {
  const apiCases = input.extension_cases.filter((c) => c.kind === "api" && c.case !== undefined);
  const authz = apiCases.some(
    (c) => c.case?.auth === "none" || (typeof c.case?.id === "string" && c.case.id.includes("-unauth")),
  );
  const wrong = apiCases.some(
    (c) =>
      c.case?.auth === "alternate_bearer" ||
      (typeof c.case?.id === "string" && c.case.id.includes("-wrong-role")),
  );
  let blocker: string | undefined;
  if (input.needs_api_authz && input.openapi_cases_added && !authz) {
    blocker = "e2_api_authz_negatives_missing";
  }
  return {
    openapi_cases_added: input.openapi_cases_added,
    authz_negative_cases_present: authz,
    wrong_role_cases_present: wrong,
    api_executed: input.api_ran,
    ...(blocker !== undefined ? { blocker } : {}),
  };
}

export function buildSessionDelta(input: {
  current_case_count: number;
  prior?: Readonly<{ suite_id: string; case_count: number }> | undefined;
}): SessionDelta {
  if (input.prior === undefined) {
    return {
      schema_version: "1.0.0",
      available: false,
      message: "No prior suite in registry to diff against — first Expert session for this workspace or registry empty.",
      current_case_count: input.current_case_count,
      note: "Senior Experts compare to last known suite when available.",
    };
  }
  const delta = input.current_case_count - input.prior.case_count;
  return {
    schema_version: "1.0.0",
    available: true,
    message:
      delta === 0
        ? `Suite case_count unchanged vs prior ${input.prior.suite_id} (${input.prior.case_count}).`
        : `Suite case_count ${delta > 0 ? "grew" : "shrank"} by ${Math.abs(delta)} vs prior ${input.prior.suite_id}.`,
    prior_suite_id: input.prior.suite_id,
    prior_case_count: input.prior.case_count,
    current_case_count: input.current_case_count,
    case_count_delta: delta,
    note: "Filename/count delta is a hint — map to AC risk before claiming regression completeness.",
  };
}

export function assessStatefulLifecycle(input: {
  acknowledged?: boolean;
  waived?: Readonly<{ reason_code: string; rationale: string }> | undefined;
}): StatefulLifecycleProtocol {
  const checklist = [
    "Document create fixture path (who/what creates test data).",
    "Document use path (which cases consume it).",
    "Document cleanup/teardown (or explicit accept pollution risk).",
    "Or waive with reason_code=stateful_lifecycle_accepted + rationale ≥12 chars.",
  ];
  if (input.waived !== undefined && input.waived.rationale.trim().length >= 12) {
    return {
      schema_version: "1.0.0",
      covered: false,
      waived: true,
      checklist,
      message: `Stateful lifecycle waived (${input.waived.reason_code}): ${input.waived.rationale}`,
    };
  }
  if (input.acknowledged === true) {
    return {
      schema_version: "1.0.0",
      covered: true,
      waived: false,
      checklist,
      message: "Host declared stateful_lifecycle_documented=true — Expert records as covered for this session.",
    };
  }
  return {
    schema_version: "1.0.0",
    covered: false,
    waived: false,
    blocker: "stateful_lifecycle_uncovered",
    checklist,
    message: "No durable create→use→cleanup oracle — Senior Expert blocks silent pass on data lifecycle.",
  };
}

export function buildAbuseResidualCharter(signals: ExpertRiskSignals): AbuseResidualCharter {
  const probes = [
    "Privilege escalation via IDOR / hidden admin actions (manual).",
    "Session fixation / cookie jar confusion across roles.",
    "Business-logic abuse: replay, double-submit money, race on inventory.",
    "Injection beyond automation adversarial variants (stored XSS, SSRF if applicable).",
  ];
  if (signals.needs_money_oracles) {
    probes.unshift("Money mutation without matching ledger entry / refund asymmetry.");
  }
  if (signals.needs_api_authz) {
    probes.unshift("API authz matrix across all principals — not just unauth smoke.");
  }
  return {
    schema_version: "1.0.0",
    title: "Abuse / security residual (human pen-test territory)",
    objective:
      "Time-box human adversarial review — automation adversarial probes are NOT a pen-test engagement.",
    time_box_minutes: signals.needs_money_oracles || signals.needs_api_authz ? 90 : 60,
    probes: probes.slice(0, 8),
    out_of_scope: [
      "Claiming pen-test certification from run_auto_qa",
      "Inventing CVEs without evidence",
      "Skipping human security review when surface is sensitive",
    ],
    note: "Senior Expert always leaves this residual visible — never green-washes security.",
  };
}

export function shouldRecommendDepthSmokes(input: {
  signals: ExpertRiskSignals;
  git?: GitBlastRadius;
  include_depth_smokes?: boolean;
}): Readonly<{ recommend: boolean; reason: string }> {
  if (input.include_depth_smokes === false) {
    return { recommend: false, reason: "include_depth_smokes=false" };
  }
  if (input.include_depth_smokes === true) {
    return { recommend: true, reason: "host requested include_depth_smokes=true" };
  }
  if (input.signals.needs_money_oracles || input.signals.needs_api_authz) {
    return { recommend: true, reason: "money/API smells — Senior Expert runs depth security/a11y/perf smoke" };
  }
  if (input.git?.hotspots && input.git.hotspots.length > 0) {
    return { recommend: true, reason: "git hotspots present — depth smoke recommended" };
  }
  return { recommend: false, reason: "no strong depth-smoke trigger" };
}

/**
 * Apply structured waives: remove matching risk_matrix_* / stateful / role-diff
 * blockers when host supplies valid waive for that risk_id.
 */
export function applyStructuredWaivesToBlockers(
  blockers: readonly string[],
  waives: readonly Readonly<{ risk_id: string; reason_code: string; rationale: string }>[],
): Readonly<{ blockers: readonly string[]; cleared: readonly string[]; notes: readonly string[] }> {
  if (waives.length === 0) return { blockers, cleared: [], notes: [] };
  const cleared: string[] = [];
  const notes: string[] = [];
  const remaining = blockers.filter((b) => {
    for (const w of waives) {
      if (w.rationale.trim().length < 12) continue;
      const id = w.risk_id.trim();
      if (
        b.includes(id) ||
        (id === "risk-stateful-data" && b.startsWith("stateful_lifecycle")) ||
        (id === "e2_role_surface_diff_untriaged" && b.includes("role_surface_diff")) ||
        (id === "risk-scope-pen" && b.includes("pen"))
      ) {
        cleared.push(b);
        notes.push(`Waived ${b} via ${w.reason_code}: ${w.rationale.slice(0, 80)}`);
        return false;
      }
    }
    return true;
  });
  return { blockers: remaining, cleared, notes };
}

export function buildSeniorHardeningBundle(input: {
  domain_pack?: DomainPackGateInput;
  extensions?: JsonObject;
  extension_cases: readonly Readonly<{ kind: string; case?: Readonly<{ id: string; auth?: string }> }>[];
  signals: ExpertRiskSignals;
  hook_coverage: Readonly<{
    openapi_cases_added: boolean;
    journey_cases_added: boolean;
  }>;
  api_ran: boolean;
  current_case_count: number;
  prior_suite?: Readonly<{ suite_id: string; case_count: number }>;
  git?: GitBlastRadius;
  stateful_lifecycle_documented?: boolean;
  declared_waives?: readonly Readonly<{ risk_id: string; reason_code: string; rationale: string }>[];
  include_depth_smokes?: boolean;
}): SeniorHardeningBundle {
  const domain_enrichment = enrichDomainPack(input.domain_pack);
  const role_diff = assessRoleDiffMandate(input.extensions);
  const authz_negatives = assessAuthzNegativeCoverage({
    extension_cases: input.extension_cases,
    openapi_cases_added: input.hook_coverage.openapi_cases_added,
    api_ran: input.api_ran,
    needs_api_authz: input.signals.needs_api_authz,
  });
  const session_delta = buildSessionDelta({
    current_case_count: input.current_case_count,
    ...(input.prior_suite !== undefined ? { prior: input.prior_suite } : {}),
  });
  const statefulWaive = input.declared_waives?.find((w) => w.risk_id === "risk-stateful-data");
  const stateful = assessStatefulLifecycle({
    acknowledged: input.stateful_lifecycle_documented === true,
    ...(statefulWaive !== undefined ? { waived: statefulWaive } : {}),
  });
  const abuse_residual = buildAbuseResidualCharter(input.signals);
  const depth = shouldRecommendDepthSmokes({
    signals: input.signals,
    ...(input.git !== undefined ? { git: input.git } : {}),
    ...(input.include_depth_smokes !== undefined ? { include_depth_smokes: input.include_depth_smokes } : {}),
  });

  const pass_blockers: string[] = [];
  if (role_diff.blocker) pass_blockers.push(role_diff.blocker);
  if (authz_negatives.blocker) pass_blockers.push(authz_negatives.blocker);
  if (stateful.blocker) pass_blockers.push(stateful.blocker);

  const gaps: JsonObject[] = [];
  if (role_diff.material_diff && role_diff.message) {
    gaps.push({
      gap: "role_surface_diff",
      message: role_diff.message,
      only_in_a_count: role_diff.only_in_a_count,
      only_in_b_count: role_diff.only_in_b_count,
    });
  }
  if (authz_negatives.blocker) {
    gaps.push({
      gap: "api_authz_negatives_missing",
      message: "OpenAPI merged without authz-negative cases — set include_authz_negatives:true.",
    });
  }
  for (const s of domain_enrichment.money_oracle_suggestions.slice(0, 3)) {
    gaps.push({ gap: "money_oracle_suggestion", message: s });
  }
  gaps.push({
    gap: "stateful_data_lifecycle",
    message: stateful.message,
    checklist: [...stateful.checklist],
    waived: stateful.waived,
    covered: stateful.covered,
  });
  gaps.push({
    gap: "abuse_residual_pen_territory",
    message: abuse_residual.note,
    charter_title: abuse_residual.title,
    time_box_minutes: abuse_residual.time_box_minutes,
  });
  if (session_delta.available) {
    gaps.push({
      gap: "session_delta",
      message: session_delta.message,
      prior_suite_id: session_delta.prior_suite_id ?? null,
      case_count_delta: session_delta.case_count_delta ?? null,
    });
  }

  return {
    schema_version: "1.0.0",
    domain_enrichment,
    role_diff,
    authz_negatives,
    session_delta,
    stateful,
    abuse_residual,
    depth_smoke_recommended: depth.recommend,
    depth_smoke_reason: depth.reason,
    pass_blockers,
    gaps,
  };
}

export function seniorHardeningJson(bundle: SeniorHardeningBundle): JsonObject {
  return {
    schema_version: bundle.schema_version,
    domain_enrichment: {
      ...bundle.domain_enrichment,
      money_hints: [...bundle.domain_enrichment.money_hints],
      permission_hints: [...bundle.domain_enrichment.permission_hints],
      legacy_hints: [...bundle.domain_enrichment.legacy_hints],
      money_oracle_suggestions: [...bundle.domain_enrichment.money_oracle_suggestions],
      notes: [...bundle.domain_enrichment.notes],
    },
    role_diff: { ...bundle.role_diff },
    authz_negatives: { ...bundle.authz_negatives },
    session_delta: { ...bundle.session_delta },
    stateful: {
      ...bundle.stateful,
      checklist: [...bundle.stateful.checklist],
    },
    abuse_residual: {
      ...bundle.abuse_residual,
      probes: [...bundle.abuse_residual.probes],
      out_of_scope: [...bundle.abuse_residual.out_of_scope],
    },
    depth_smoke_recommended: bundle.depth_smoke_recommended,
    depth_smoke_reason: bundle.depth_smoke_reason,
    pass_blockers: [...bundle.pass_blockers],
  };
}

function readMdSnippets(path: string): Readonly<{ raw: string; hints: string[] }> {
  if (!existsSync(path)) return { raw: "", hints: [] };
  try {
    const raw = readFileSync(path, "utf8");
    const hints = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- ") || l.startsWith("* "))
      .map((l) => l.replace(/^[-*]\s+/, "").slice(0, 120))
      .filter((l) => l.length > 8 && !/^TODO/i.test(l))
      .slice(0, 8);
    return { raw, hints };
  } catch {
    return { raw: "", hints: [] };
  }
}
