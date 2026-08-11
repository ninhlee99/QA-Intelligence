import assert from "node:assert/strict";
import test from "node:test";

import { deriveFlakeTaxonomy } from "../../src/reporting/flake-taxonomy.js";
import type { QaRunReport } from "../../src/reporting/qa-run-report.js";

function baseReport(overrides: Partial<QaRunReport> & { test_cases: QaRunReport["test_cases"] }): QaRunReport {
  return {
    schema_version: "1.1.0",
    workspace_id: "ws",
    target_url: "https://example.test",
    generated_at: "2026-08-11T00:00:00.000Z",
    requirement_ref: "REQ@1",
    discovery_capture_id: "cap-1",
    discovery_element_count: 1,
    generation_findings: [],
    summary: {
      generated: overrides.test_cases.length,
      executed: overrides.test_cases.length,
      passed: 0,
      failed: 0,
      flaky: overrides.test_cases.filter((t) => t.outcome === "flaky").length,
      not_executed: 0,
    },
    draft_defects: [],
    accessibility_smoke: {
      schema_version: "1.0.0",
      element_count: 0,
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      findings: [],
      limitations: [],
    },
    variant_coverage: [],
    residual_risks: [],
    release_recommendation: "investigate_flakes",
    release_recommendation_rationale: "flakes",
    ...overrides,
  };
}

test("deriveFlakeTaxonomy empty when no flakes", () => {
  const taxonomy = deriveFlakeTaxonomy(
    baseReport({
      test_cases: [
        {
          test_case_id: "tc-1",
          purpose: "ok",
          variant: "positive",
          outcome: "passed",
          evidence: [],
        },
      ],
      release_recommendation: "recommend_release",
      release_recommendation_rationale: "clean",
    }),
  );
  assert.equal(taxonomy.flaky_count, 0);
  assert.equal(taxonomy.cases.length, 0);
});

test("deriveFlakeTaxonomy classifies network and timing signals", () => {
  const taxonomy = deriveFlakeTaxonomy(
    baseReport({
      test_cases: [
        {
          test_case_id: "tc-net",
          purpose: "submit",
          variant: "positive",
          outcome: "flaky",
          evidence: ["network-obs:3", "xhr status:500"],
        },
        {
          test_case_id: "tc-wait",
          purpose: "open",
          variant: "positive",
          outcome: "flaky",
          evidence: ["timeout waiting for Sign in"],
        },
      ],
    }),
  );
  assert.equal(taxonomy.flaky_count, 2);
  assert.equal(taxonomy.by_category.network_or_api, 1);
  assert.equal(taxonomy.by_category.timing_or_wait, 1);
  assert.ok(taxonomy.cases[0]?.host_hint.length);
});
