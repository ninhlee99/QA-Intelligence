import assert from "node:assert/strict";
import test from "node:test";

import { BusinessAnalysisQualityRuleEngine } from "../../src/business-analysis/assess-business-analysis-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["business-analyst"],
    permissions: ["workflow:read"],
    policy_version: "policy-3",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T07:00:00.000Z",
    expires_at: "2026-08-07T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-test-context",
  };
}

function requestWith(workflow: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "business-analysis-quality", version: "1.0.0" },
    effective_at: "2026-08-07T08:00:00.000Z",
    facts: { workflow },
    fact_provenance: ["workflow:WORKFLOW-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function workflow(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "WORKFLOW-1@1.0.0",
    id: "WORKFLOW-1",
    version: "1.0.0",
    name: "Submit expense report",
    state: "current",
    trigger: "An employee submits an expense report for reimbursement.",
    preconditions: ["The employee has an active account."],
    actors: [{ actor: "Employee", permissions: ["submit_expense"] }, { actor: "Manager", permissions: ["approve_expense"] }],
    activities: [
      { step: "1", description: "Employee fills out the expense report." },
      { step: "2", description: "Manager reviews the report." },
    ],
    decisions: [{ description: "Is the report within policy limits?", rule_ref: "rule:expense-policy-limit@1.0.0" }],
    data_consumed: ["expense-policy"],
    data_produced: ["expense-report-record"],
    transitions: [{ from_state: "submitted", to_state: "approved", trigger: "manager approval" }],
    alternate_paths: ["Manager requests additional receipts before approving."],
    failure_paths: ["Report is rejected for exceeding policy limits."],
    outcome: "The expense report is approved or rejected with a recorded reason.",
    evidence: ["interview:finance-team-2026-08-01"],
    traces_to: ["REQ-42@1.0.0"],
    ...overrides,
  };
}

test("a complete workflow satisfies all deterministic rules", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(requestWith(workflow()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a workflow with no trigger is a scope_and_actors finding (SPEC-204 §6)", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(requestWith(workflow({ trigger: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((finding) => finding["message"] === "The workflow has no trigger."), true);
});

test("a workflow missing alternate and failure paths is a high path_coverage finding", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(workflow({ alternate_paths: [], failure_paths: [] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const pathFinding = findings.find((finding) => finding["category"] === "path_coverage");
  assert.notEqual(pathFinding, undefined);
  assert.equal(pathFinding?.["severity"], "high");
});

test("a decision with no rule_ref or open_question is a decision_traceability finding", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(workflow({ decisions: [{ description: "Is the report within policy limits?" }] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((finding) => finding["category"] === "decision_traceability"), true);
});

test("a target-state workflow with no gap is a critical state_distinction finding (SPEC-204 §7)", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(requestWith(workflow({ state: "target" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const stateFinding = findings.find((finding) => finding["category"] === "state_distinction");
  assert.notEqual(stateFinding, undefined);
  assert.equal(stateFinding?.["severity"], "critical");
});

test("a target-state workflow with a complete gap statement satisfies the state_distinction rule", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      workflow({
        state: "target",
        evidence: [],
        gap: {
          required_change: "Add automated policy-limit checks before manager review.",
          affected_owner: "Finance Engineering",
          assumptions: ["The policy service will be available."],
          validation: "A/B test with a pilot team before full rollout.",
        },
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((finding) => finding["category"] === "state_distinction"), false);
});

test("a workflow with no traceability is a medium traceability finding", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate(requestWith(workflow({ traces_to: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const traceabilityFinding = findings.find((finding) => finding["category"] === "traceability");
  assert.notEqual(traceabilityFinding, undefined);
  assert.equal(traceabilityFinding?.["severity"], "medium");
});

test("fails closed on missing workflow facts", async () => {
  const engine = new BusinessAnalysisQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "business-analysis-quality", version: "1.0.0" },
    effective_at: "2026-08-07T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "invalid_facts");
});

runRuleEngineContract("business-analysis-quality", {
  makeEngine: () => new BusinessAnalysisQualityRuleEngine(),
  satisfiedRequest: () => requestWith(workflow()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "business-analysis-quality", version: "1.0.0" },
    effective_at: "2026-08-07T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
});
