import assert from "node:assert/strict";
import test from "node:test";

import { ReportQualityRuleEngine } from "../../src/reporting/assess-report-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["quality-governance"],
    permissions: ["report:read"],
    policy_version: "policy-3",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-05T07:00:00.000Z",
    expires_at: "2026-08-05T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-test-context",
  };
}

function requestWith(report: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "report-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { report },
    fact_provenance: ["report:RPT-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function report(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "RPT-1@1.0.0",
    id: "RPT-1",
    version: "1.0.0",
    report_type: "release_readiness",
    audience: "Release approvers",
    purpose: "Assess release readiness for the 2026.08.1 cut.",
    workspace_scope: "workspace-alpha",
    reporting_period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-05T00:00:00.000Z" },
    generated_at: "2026-08-05T08:00:00.000Z",
    source_artifact_refs: ["EXEC-1@1.0.0"],
    metrics: [
      {
        id: "pass-rate",
        owner: "Quality Engineering",
        definition: "Percentage of executions that passed.",
        numerator: "count(passed)",
        denominator: "count(total)",
        source_ref: "EXEC-1@1.0.0",
        update_cadence: "per release",
      },
    ],
    findings: ["Overall pass rate is 98%."],
    drill_down_refs: ["EXEC-1@1.0.0#outcome"],
    ...overrides,
  };
}

test("a complete report satisfies all deterministic rules", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate(requestWith(report()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a report with no drill-down refs is a high traceability finding", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate(requestWith(report({ drill_down_refs: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The report has no drill-down evidence links."), true);
});

test("an incomplete metric is a high metric_governance finding (SPEC-212 §5)", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(report({ metrics: [{ id: "pass-rate", owner: "Quality Engineering" }] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "metric_governance"), true);
});

test("a critical exception not reflected in findings is a critical aggregation_integrity finding (SPEC-212 §6)", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(report({ critical_exceptions: ["Cross-Workspace data leak in staging"] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "aggregation_integrity");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("a critical exception reflected in findings satisfies the aggregation rule", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      report({
        critical_exceptions: ["Cross-Workspace data leak in staging"],
        findings: ["Overall pass rate is 98%.", "Cross-Workspace data leak in staging remains open and blocks release."],
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "aggregation_integrity"), false);
});

test("fails closed on missing report facts", async () => {
  const engine = new ReportQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "report-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "invalid_facts");
});
