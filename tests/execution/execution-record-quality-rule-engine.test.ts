import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionRecordQualityRuleEngine } from "../../src/execution/assess-execution-record-quality.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["execution-observer"],
    permissions: ["execution_record:read"],
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

function requestWith(execution: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "execution-record-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { execution_record: execution },
    fact_provenance: ["execution-record:EXEC-1"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function execution(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "EXEC-1",
    id: "EXEC-1",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    test_case_ref: "TC-1@1.0.0",
    automation_asset_ref: "AA-1@1.0.0",
    engine_ref: "playwright@1.40.0",
    environment_ref: "staging",
    state: "completed",
    outcome: "passed",
    evidence: ["run://exec-1/step-1/assertion-1"],
    ...overrides,
  };
}

test("a complete terminal execution satisfies all deterministic rules", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a terminal execution with no outcome is a high outcome_integrity finding", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution({ outcome: null })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(
    findings.some((f) => f["message"] === 'The execution record is in terminal state "completed" but has no outcome.'),
    true,
  );
});

test("a non-terminal execution already claiming an outcome is a high outcome_integrity finding", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution({ state: "running", outcome: "passed" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "outcome_integrity"), true);
});

test("a passed outcome with no evidence is a critical outcome_integrity finding (SPEC-210 §4/§10)", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution({ evidence: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The execution record claims a passed outcome with no evidence to interpret it by.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("a running execution with no outcome yet is not penalized", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution({ state: "running", outcome: null, evidence: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a skipped outcome with no reason is a medium completeness finding", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate(requestWith(execution({ outcome: "skipped", evidence: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The execution record claims a skipped outcome with no governed reason.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "medium");
});

test("fails closed on missing execution record facts", async () => {
  const engine = new ExecutionRecordQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "execution-record-quality", version: "1.0.0" },
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

runRuleEngineContract("execution-record-quality", {
  makeEngine: () => new ExecutionRecordQualityRuleEngine(),
  satisfiedRequest: () => requestWith(execution()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "execution-record-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
});
