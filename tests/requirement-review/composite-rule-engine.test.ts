import assert from "node:assert/strict";
import test from "node:test";

import { CompositeRuleEngine } from "../../src/requirement-review/composite-rule-engine.js";
import type {
  DeterministicRuleEngine,
  JsonObject,
  RuleEvaluationRequest,
  RuleEvaluationResult,
} from "../../src/requirement-review/public.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["requirement:read"],
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

function requestBase(): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "requirement-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { requirement: { ref: "REQ-1@1.0.0" } },
    fact_provenance: ["requirement:REQ-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function stubEngine(
  outcome: "satisfied" | "not_satisfied" | "indeterminate" | "not_applicable" | "error",
  findings: JsonObject[],
  ruleId: string,
): DeterministicRuleEngine {
  return {
    evaluate: (request: RuleEvaluationRequest): Promise<RuleEvaluationResult> =>
      Promise.resolve({
        ok: true,
        value: {
          outcome,
          rule_set: { ...request.rule_set },
          rule_versions: [{ id: ruleId, version: "1.0.0" }],
          matched_conditions: findings.map((finding) => String(finding["category"])),
          relevant_facts: request.fact_provenance,
          outputs: { findings },
          conflicts: [],
          missing_facts: [],
          explanation_trace: [`${ruleId} evaluated`],
          policy_version: request.context.policy_version,
          duration_ms: 1,
        },
      }),
  };
}

test("merges findings from both engines without dropping either", async () => {
  const engineA = stubEngine("satisfied", [], "engine-a");
  const engineB = stubEngine("not_satisfied", [{ category: "completeness", severity: "high", message: "missing rationale", evidence: ["REQ-1"], next_action: "add rationale" }], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.["message"], "missing rationale");
});

test("a critical outcome from one engine is never diluted by a satisfied outcome from another", async () => {
  const engineA = stubEngine("satisfied", [], "engine-a");
  const engineB = stubEngine("not_satisfied", [{ category: "authority", severity: "critical", message: "bad", evidence: ["x"], next_action: "y" }], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
});

test("indeterminate from one engine beats satisfied from another, but not not_satisfied", async () => {
  const engineA = stubEngine("indeterminate", [], "engine-a");
  const engineB = stubEngine("not_satisfied", [], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
});

test("both engines satisfied merges to satisfied with no findings", async () => {
  const engineA = stubEngine("satisfied", [], "engine-a");
  const engineB = stubEngine("satisfied", [], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
  assert.equal((result.value.outputs["findings"] as JsonObject[]).length, 0);
});

test("propagates a failure from any engine without calling the others' result", async () => {
  const engineA: DeterministicRuleEngine = {
    evaluate: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "invalid_facts", message: "bad facts", retryable: false, evidence: [] },
      }),
  };
  const engineB = stubEngine("satisfied", [], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "invalid_facts");
});

test("merges rule_versions from both engines uniquely", async () => {
  const engineA = stubEngine("satisfied", [], "engine-a");
  const engineB = stubEngine("satisfied", [], "engine-b");
  const composite = new CompositeRuleEngine([engineA, engineB]);

  const result = await composite.evaluate(requestBase());

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.rule_versions.length, 2);
  assert.deepEqual(
    result.value.rule_versions.map((r) => r.id).sort(),
    ["engine-a", "engine-b"],
  );
});

test("throws when constructed with zero engines", () => {
  assert.throws(() => new CompositeRuleEngine([]));
});
