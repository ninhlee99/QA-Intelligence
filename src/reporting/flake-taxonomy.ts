/**
 * Heuristic flake taxonomy from QA run evidence — advisory, not root cause.
 * Expert hosts MUST treat as triage hint; never as confirmed_cause.
 */
import type { JsonObject } from "../requirement-review/public.js";
import type { QaRunReport, QaRunTestCaseResult } from "./qa-run-report.js";

export type FlakeCategory =
  | "timing_or_wait"
  | "network_or_api"
  | "assertion_instability"
  | "navigation_or_url"
  | "undetermined_intermittent";

export type FlakeTaxonomyEntry = Readonly<{
  test_case_id: string;
  variant: string;
  category: FlakeCategory;
  confidence: "low" | "medium";
  signals: readonly string[];
  evidence_sample: readonly string[];
  host_hint: string;
}>;

export type FlakeTaxonomy = Readonly<{
  schema_version: "1.0.0";
  flaky_count: number;
  by_category: Readonly<Record<FlakeCategory, number>>;
  cases: readonly FlakeTaxonomyEntry[];
  note: string;
}>;

const HOST_HINTS: Readonly<Record<FlakeCategory, string>> = {
  timing_or_wait: "Stabilize waits / use wait_for_* on AC; avoid fixed sleeps.",
  network_or_api: "Check expected_network oracles + backend flake; prefer API smoke isolation.",
  assertion_instability: "Oracle may be racey (text/title); tighten expected_* or wait_for.",
  navigation_or_url: "Post-submit redirect timing — wait_for_url / expected_url_includes.",
  undetermined_intermittent: "Investigate trial evidence; do not re-run full suite — targeted case only.",
};

export function deriveFlakeTaxonomy(report: QaRunReport): FlakeTaxonomy {
  const flaky = report.test_cases.filter((tc) => tc.outcome === "flaky");
  const by_category: Record<FlakeCategory, number> = {
    timing_or_wait: 0,
    network_or_api: 0,
    assertion_instability: 0,
    navigation_or_url: 0,
    undetermined_intermittent: 0,
  };
  const cases = flaky.map((tc) => {
    const entry = classifyFlakyCase(tc);
    by_category[entry.category] += 1;
    return entry;
  });
  return {
    schema_version: "1.0.0",
    flaky_count: flaky.length,
    by_category,
    cases,
    note:
      flaky.length === 0
        ? "No flaky outcomes in this run."
        : "Heuristic triage only — not confirmed_cause. Prefer targeted retest of flaky_case_ids.",
  };
}

export function flakeTaxonomyJson(taxonomy: FlakeTaxonomy): JsonObject {
  return {
    schema_version: taxonomy.schema_version,
    flaky_count: taxonomy.flaky_count,
    by_category: { ...taxonomy.by_category },
    cases: taxonomy.cases.map((entry) => ({
      test_case_id: entry.test_case_id,
      variant: entry.variant,
      category: entry.category,
      confidence: entry.confidence,
      signals: [...entry.signals],
      evidence_sample: [...entry.evidence_sample],
      host_hint: entry.host_hint,
    })),
    note: taxonomy.note,
  };
}

function classifyFlakyCase(tc: QaRunTestCaseResult): FlakeTaxonomyEntry {
  const blob = [...tc.evidence, tc.purpose, tc.variant].join(" ").toLowerCase();
  const signals: string[] = [];

  const checks: ReadonlyArray<Readonly<{ category: FlakeCategory; pattern: RegExp; signal: string }>> = [
    { category: "timing_or_wait", pattern: /timeout|timed.?out|wait_for|waiting|slow|deadline/, signal: "wait/timeout language" },
    { category: "network_or_api", pattern: /network|xhr|fetch|api|status:\s*[45]|http\s*[45]|cors/, signal: "network/API language" },
    {
      category: "navigation_or_url",
      pattern: /navigat|redirect|expected_url|url_includes|location\.href|wrong.?page/,
      signal: "navigation/URL language",
    },
    {
      category: "assertion_instability",
      pattern: /assert|expected_text|expected_title|oracle|mismatch|not visible|detached/,
      signal: "assertion/oracle language",
    },
  ];

  let category: FlakeCategory = "undetermined_intermittent";
  let confidence: "low" | "medium" = "low";
  for (const check of checks) {
    if (check.pattern.test(blob)) {
      category = check.category;
      signals.push(check.signal);
      confidence = "medium";
      break;
    }
  }
  if (signals.length === 0) signals.push("mixed pass/fail trials without strong evidence keywords");

  return {
    test_case_id: tc.test_case_id,
    variant: tc.variant,
    category,
    confidence,
    signals,
    evidence_sample: tc.evidence.slice(0, 6),
    host_hint: HOST_HINTS[category],
  };
}
