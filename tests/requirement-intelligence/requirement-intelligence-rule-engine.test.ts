import assert from "node:assert/strict";
import test from "node:test";

import { RequirementIntelligenceRuleEngine } from "../../src/requirement-intelligence/requirement-intelligence-rule-engine.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";

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

function requestWith(requirement: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "requirement-intelligence", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { requirement },
    fact_provenance: ["requirement:REQ-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function requirement(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "REQ-1@1.0.0",
    id: "REQ-1",
    version: "1.0.0",
    status: "draft",
    title: "Export audit report",
    statement: "A reviewer can export an audit report.",
    source: ["product-brief@1.0.0"],
    owner: "Product",
    capability_id: "audit-reporting",
    scope: {},
    rationale: "Auditors need offline evidence of report access.",
    acceptance_criteria: [{ criterion: "Reviewer downloads a signed PDF within 5 seconds." }],
    traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    ...overrides,
  };
}

test("a complete draft requirement satisfies all deterministic rules", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(requestWith(requirement()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a requirement with no rationale is a completeness finding (SPEC-202 §4)", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(requestWith(requirement({ rationale: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.["category"], "completeness");
});

test("a draft requirement is not penalized for having no traceability edge", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(requestWith(requirement({ status: "draft", traceability: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("an in_review requirement with no traceability edge fails (SPEC-202 §11)", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(requestWith(requirement({ status: "in_review", traceability: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((finding) => finding["category"] === "traceability"), true);
});

test("an implemented requirement with only one traceability edge fails the broader-traceability rule (SPEC-202 §11)", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      requirement({
        status: "implemented",
        traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(
    findings.some(
      (finding) =>
        finding["category"] === "traceability" &&
        typeof finding["message"] === "string" &&
        finding["message"].includes("upstream intent and downstream impact"),
    ),
    true,
  );
});

test("an implemented requirement with ZERO traceability edges gets the broader-traceability message, not the generic after-draft one (regression for the if/else-if ordering bug)", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(
    requestWith(requirement({ status: "implemented", traceability: [] })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(
    findings.some(
      (finding) =>
        finding["category"] === "traceability" &&
        typeof finding["message"] === "string" &&
        finding["message"].includes("upstream intent and downstream impact"),
    ),
    true,
    "expected the broadly-traceable-at-implementation message, not the generic no-traceability-edge one",
  );
  assert.equal(
    findings.some(
      (finding) => typeof finding["message"] === "string" && finding["message"] === 'A requirement in status "implemented" has no traceability edge.',
    ),
    false,
    "the generic after-draft message should not fire when the more specific implementation-stage rule already covers this case",
  );
});

test("an implemented requirement with two traceability edges satisfies the broader-traceability rule", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate(
    requestWith(
      requirement({
        status: "implemented",
        traceability: [
          { relationship: "derived_from", target_id: "product-brief@1.0.0" },
          { relationship: "verified_by", target_id: "TC-42@1.0.0" },
        ],
      }),
    ),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("fails closed on missing requirement facts", async () => {
  const engine = new RequirementIntelligenceRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "requirement-intelligence", version: "1.0.0" },
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
