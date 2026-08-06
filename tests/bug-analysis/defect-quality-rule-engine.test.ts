import assert from "node:assert/strict";
import test from "node:test";

import { DefectQualityRuleEngine } from "../../src/bug-analysis/assess-defect-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["triage-owner"],
    permissions: ["defect:read"],
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

function requestWith(defect: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "defect-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { defect: defect },
    fact_provenance: ["defect:BUG-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function defect(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "BUG-1@1.0.0",
    id: "BUG-1",
    version: "1.0.0",
    status: "triaged",
    summary: "Lockout does not trigger at the governed threshold.",
    observed_behavior: "Account remains active after 10 failed attempts.",
    expected_behavior: "Account locks at exactly 5 failed attempts.",
    expected_behavior_authority: "RULE-LOCKOUT@1.0.0",
    workspace_scope: "workspace-alpha",
    environment_ref: "staging",
    reproduction_conditions: ["Attempt login 10 times with invalid credentials on staging."],
    evidence: ["run://exec-1/step-3/observation"],
    severity: "high",
    severity_rationale: "Weakens the account-lockout control but is not itself exploitable directly.",
    priority: "p1",
    classification: "product_defect",
    owner: "Product Engineering",
    ...overrides,
  };
}

test("a complete defect satisfies all deterministic rules", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(requestWith(defect()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a defect with no evidence is a high completeness finding", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(requestWith(defect({ evidence: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The defect has no evidence."), true);
});

test("a confirmed cause with no evidence is a high cause_integrity finding (SPEC-211 §6)", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(requestWith(defect({ confirmed_cause: "Off-by-one in threshold comparison.", evidence: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "cause_integrity");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "high");
});

test("closing a defect without fix evidence, regression validation, or release is a critical closure_governance finding (SPEC-211 §8)", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(requestWith(defect({ status: "closed" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "closure_governance");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
  assert.ok((finding?.["message"] as string).includes("fix_evidence"));
});

test("closing a defect with all closure fields recorded satisfies the rule", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      defect({
        status: "closed",
        fix_evidence: ["commit:abc123"],
        regression_validation_ref: "EXEC-99@1.0.0",
        artifact_version_refs: ["service-auth@2.3.1"],
        release_ref: "RELEASE-2026.08.1",
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("closing a defect with fix/regression/release but no impacted artifacts is a critical closure_governance finding (SPEC-211 §8)", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      defect({
        status: "closed",
        fix_evidence: ["commit:abc123"],
        regression_validation_ref: "EXEC-99@1.0.0",
        release_ref: "RELEASE-2026.08.1",
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "closure_governance");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
  assert.ok((finding?.["message"] as string).includes("artifact_version_refs"));
});

test("a triaged (non-closed) defect is not penalized for missing closure fields", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate(requestWith(defect({ status: "triaged" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "closure_governance"), false);
});

test("fails closed on missing defect facts", async () => {
  const engine = new DefectQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "defect-quality", version: "1.0.0" },
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
