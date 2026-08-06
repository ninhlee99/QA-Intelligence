import assert from "node:assert/strict";
import test from "node:test";

import { TestDatasetQualityRuleEngine } from "../../src/test-data/assess-test-dataset-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["data-governance"],
    permissions: ["test_dataset:read"],
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

function requestWith(dataset: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-dataset-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { test_dataset: dataset },
    fact_provenance: ["test-dataset:DS-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function dataset(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "DS-1@1.0.0",
    id: "DS-1",
    version: "1.0.0",
    status: "draft",
    owner: "Data Governance",
    purpose: "Boundary values for the account-lockout threshold.",
    traced_test_refs: ["TC-1@1.0.0"],
    schema_ref: "account.schema.json@1.0.0",
    source: "Synthetic generator",
    generation_method: "Deterministic factory seeded by test run ID.",
    classification: "synthetic",
    workspace_scope: "workspace-alpha",
    environment_scope: "staging",
    setup: "Insert accounts at threshold-1, threshold, threshold+1.",
    teardown: "Delete all accounts created by this dataset's setup.",
    retention: "Deleted at end of test run.",
    disposal: "Automatic teardown, no manual step.",
    ...overrides,
  };
}

test("a complete dataset satisfies all deterministic rules", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a dataset with no traced tests is a high traceability finding", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ traced_test_refs: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["category"] === "traceability"), true);
});

test("a dataset with sensitive fields but no controls is a critical privacy_and_isolation finding (SPEC-208 §7)", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ contains_sensitive_fields: true })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["category"] === "privacy_and_isolation");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "critical");
});

test("a dataset with sensitive fields AND recorded controls satisfies the rule", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      dataset({ contains_sensitive_fields: true, sensitive_field_controls: ["masked:email", "access_control:role=data-governance"] }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a dataset with no teardown is a high completeness finding", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ teardown: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((f) => f["message"] === "The test dataset has no teardown procedure."), true);
});

test("a dataset with no owner is a high lifecycle finding", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ owner: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => f["message"] === "The test dataset has no accountable owner.");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["category"], "lifecycle");
});

test("fails closed on missing test dataset facts", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "test-dataset-quality", version: "1.0.0" },
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

test("an AI evaluation dataset with no metadata is a high completeness finding (SPEC-208 §8)", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ classification: "ai_evaluation_dataset" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => (f["message"] as string).includes("AI evaluation dataset"));
  assert.notEqual(finding, undefined);
  assert.equal(finding?.["severity"], "high");
  assert.ok((finding?.["message"] as string).includes("ai_evaluation_metadata"));
});

test("an AI evaluation dataset with partial metadata reports exactly the missing fields", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      dataset({
        classification: "ai_evaluation_dataset",
        ai_evaluation_metadata: {
          labels: ["boundary", "negative"],
          representativeness: "Covers threshold boundary and one negative case.",
        },
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const finding = findings.find((f) => (f["message"] as string).includes("AI evaluation dataset"));
  assert.notEqual(finding, undefined);
  const message = finding?.["message"] as string;
  assert.ok(message.includes("known_bias"));
  assert.ok(message.includes("contamination_risk"));
  assert.ok(message.includes("protected_data_authorization_ref"));
  assert.ok(!message.includes("labels"));
  assert.ok(!message.includes("representativeness"));
});

test("an AI evaluation dataset with complete metadata satisfies the rule", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      dataset({
        classification: "ai_evaluation_dataset",
        ai_evaluation_metadata: {
          labels: ["boundary", "negative"],
          representativeness: "Covers threshold boundary and one negative case.",
          known_bias: "Skews toward English-language input.",
          contamination_risk: "None — synthetic, generated after model training cutoff.",
          protected_data_authorization_ref: "AUTH-2026-004",
        },
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a non-AI-evaluation dataset is not penalized for missing ai_evaluation_metadata", async () => {
  const engine = new TestDatasetQualityRuleEngine();

  const result = await engine.evaluate(requestWith(dataset({ classification: "synthetic" })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});
