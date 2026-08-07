import assert from "node:assert/strict";
import test from "node:test";

import { TestStrategyQualityRuleEngine } from "../../src/test-strategy/assess-test-strategy-quality.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["quality-engineer"],
    permissions: ["test_strategy:read"],
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

function requestWith(strategy: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-strategy-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { test_strategy: strategy },
    fact_provenance: ["test-strategy:STRAT-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function strategy(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "STRAT-1@1.0.0",
    id: "STRAT-1",
    version: "1.0.0",
    status: "draft",
    scope: "Authentication capability, all Workspaces.",
    objectives: ["Prevent credential-stuffing account lockout."],
    governing_requirement_refs: ["REQ-1@1.0.0"],
    governing_risk_refs: ["RISK-1@1.0.0"],
    quality_characteristics: ["security", "resilience"],
    test_levels: ["unit", "integration"],
    techniques: ["boundary_analysis"],
    environments: [{ name: "staging", representativeness: "Mirrors production traffic shape." }],
    test_data_approach: "Synthetic accounts generated per test run.",
    automation_approach: "Automated regression at integration level; manual exploratory at system level.",
    entry_criteria: ["Staging environment is healthy."],
    exit_criteria: ["No critical or high defects open."],
    evidence_and_reporting: "Evidence retained in the Evaluation Campaign record store.",
    residual_risk: "Low, once rate limiting is verified in staging.",
    roles_and_escalation: "Quality Engineering owns triage; escalates to Security for critical findings.",
    exclusions: ["Third-party identity provider outages are out of scope."],
    assumptions: ["Staging traffic shape matches production within 10%."],
    owner: "Quality Engineering",
    ...overrides,
  };
}

test("a complete test strategy satisfies all deterministic rules", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a strategy with no governing requirement or risk is a high traceability finding", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(strategy({ governing_requirement_refs: [], governing_risk_refs: [] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "traceability"), true);
});

test("a strategy governing a risk but stating no residual risk is a critical risk_coverage finding (SPEC-206 §6)", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy({ residual_risk: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "risk_coverage");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("a strategy governing no risk at all is not penalized for a missing residual risk statement", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(strategy({ governing_risk_refs: [], residual_risk: undefined })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "risk_coverage"), false);
});

test("a strategy with no test levels is a high completeness finding", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy({ test_levels: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test strategy has no test levels."), true);
});

test("a strategy with no owner is a high governance finding", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy({ owner: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The test strategy has no accountable owner.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["category"], "governance");
});

test("a strategy with no roles and escalation path is a high completeness finding (SPEC-206 §3)", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy({ roles_and_escalation: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test strategy has no roles and escalation path."), true);
});

test("a strategy with no exclusions or assumptions is a high completeness finding (SPEC-206 §3)", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate(requestWith(strategy({ exclusions: [], assumptions: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test strategy has no exclusions."), true);
  assert.equal(findings.some((f) => f["message"] === "The test strategy has no assumptions."), true);
});

test("fails closed on missing test strategy facts", async () => {
  const engine = new TestStrategyQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-strategy-quality", version: "1.0.0" },
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

runRuleEngineContract("test-strategy-quality", {
  makeEngine: () => new TestStrategyQualityRuleEngine(),
  satisfiedRequest: () => requestWith(strategy()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-strategy-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
});
