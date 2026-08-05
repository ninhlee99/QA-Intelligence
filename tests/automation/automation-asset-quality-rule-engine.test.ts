import assert from "node:assert/strict";
import test from "node:test";

import { AutomationAssetQualityRuleEngine } from "../../src/automation/assess-automation-asset-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["automation-engineer"],
    permissions: ["automation_asset:read"],
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

function requestWith(asset: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "automation-asset-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { automation_asset: asset },
    fact_provenance: ["automation-asset:AA-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function asset(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "AA-1@1.0.0",
    id: "AA-1",
    version: "1.0.0",
    status: "draft",
    implemented_test_case_refs: ["TC-1@1.0.0"],
    execution_interface: "playwright-adapter@1.0.0",
    compatible_engine_refs: ["playwright@1.40.0"],
    environment_constraints: ["staging"],
    owner: "Automation Engineering",
    assertion_map: [{ expected_result_ref: "TC-1#expected_results[0]", assertion_implementation: "expect(page).toHaveText(...)" }],
    ...overrides,
  };
}

test("a complete automation asset satisfies all deterministic rules", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(asset()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("an asset with no implemented test cases is a high traceability finding", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(asset({ implemented_test_case_refs: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "traceability"), true);
});

test("an asset implementing tests with no assertion map is a high assertion_integrity finding (SPEC-209 §4)", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(asset({ assertion_map: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "assertion_integrity");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "high");
});

test("an asset with an embedded secret is a critical isolation finding (SPEC-209 §8)", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(asset({ environment_constraints: ["staging", "api_key: sk-live-abc123"] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "isolation");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("an asset with no compatible engine is a high completeness finding", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(asset({ compatible_engine_refs: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The automation asset declares no compatible execution engine."), true);
});

test("fails closed on missing automation asset facts", async () => {
  const engine = new AutomationAssetQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "automation-asset-quality", version: "1.0.0" },
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
