import assert from "node:assert/strict";
import test from "node:test";

import { TestCaseQualityRuleEngine } from "../../src/test-design/assess-test-case-quality.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["test-designer"],
    permissions: ["test_case:read"],
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

function requestWith(testCase: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-case-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { test_case: testCase },
    fact_provenance: ["test-case:TC-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function testCase(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "TC-1@1.0.0",
    id: "TC-1",
    version: "1.0.0",
    status: "draft",
    purpose: "Verify lockout behavior at the boundary.",
    traceability: ["REQ-1@1.0.0"],
    preconditions: ["An account exists and is not locked."],
    workspace_scope: "workspace-alpha",
    steps: [{ action: "Attempt authentication with invalid credentials until the threshold.", input: {} }],
    expected_results: [{ assertion: "The account becomes locked exactly at the threshold.", authority: "RULE-1@1.0.0" }],
    owner: "Quality Owner",
    actor_scope: "authenticated-user",
    cleanup: ["Unlock the account and reset failed-attempt counter."],
    priority: "high",
    ...overrides,
  };
}

test("a complete test case satisfies all deterministic rules", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a test case with no traceability is a high traceability finding", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ traceability: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "traceability");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "high");
});

test("a test case with no steps is a critical completeness finding", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ steps: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The test case has no steps.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("an expected result with no authority is a critical authority finding (SPEC-207 §3)", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(testCase({ expected_results: [{ assertion: "The account is locked." }] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "authority");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("a test case with no expected results is a critical completeness finding", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ expected_results: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test case has no expected results."), true);
});

test("a test case with no owner is a high completeness finding", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ owner: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test case has no owner."), true);
});

test("a test case with no cleanup is a high independence finding (SPEC-207 §2/§3)", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ cleanup: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "independence");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "high");
});

test("a test case with no actor scope is a medium completeness finding (SPEC-207 §2)", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ actor_scope: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test case has no actor scope."), true);
});

test("a test case with no priority is a low completeness finding (SPEC-207 §2)", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate(requestWith(testCase({ priority: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The test case has no priority.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "low");
});

test("fails closed on missing test case facts", async () => {
  const engine = new TestCaseQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-case-quality", version: "1.0.0" },
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

runRuleEngineContract("test-case-quality", {
  makeEngine: () => new TestCaseQualityRuleEngine(),
  satisfiedRequest: () => requestWith(testCase()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-case-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
});
