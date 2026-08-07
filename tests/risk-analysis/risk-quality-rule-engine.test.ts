import assert from "node:assert/strict";
import test from "node:test";

import { RiskQualityRuleEngine } from "../../src/risk-analysis/assess-risk-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";

function baseContext(): RuleEvaluationRequest["context"] {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "reviewer-1",
    actor_type: "human",
    roles: ["risk-reviewer"],
    permissions: ["risk:read"],
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

function requestWith(risk: JsonObject): RuleEvaluationRequest {
  return {
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "risk-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: { risk },
    fact_provenance: ["risk:RISK-1@1.0.0"],
    requested_decisions: [],
    trace_level: "summary",
  };
}

function risk(overrides: Partial<JsonObject> = {}): JsonObject {
  return {
    ref: "RISK-1@1.0.0",
    id: "RISK-1",
    version: "1.0.0",
    status: "draft",
    statement: {
      cause: "Rate limiting is not enforced on the login endpoint.",
      event: "An attacker submits high-volume credential-stuffing requests.",
      consequence: "Legitimate user accounts are locked out or compromised.",
    },
    category: "security_and_privacy",
    affected: { workspace_id: "workspace-alpha", capability_id: "authentication" },
    likelihood_rationale: "Public endpoint with no prior rate-limiting control.",
    impact_rationale: "Account lockout affects all active users of this Workspace.",
    evidence: ["incident-report:INC-042"],
    owner: "Security Engineering",
    controls: ["control:rate-limit-login@1.0.0"],
    residual_risk: "Low, once rate limiting is deployed and monitored.",
    ...overrides,
  };
}

test("a complete risk satisfies all deterministic rules", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(requestWith(risk()));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "satisfied");
});

test("a risk with an incomplete statement is a completeness finding (SPEC-205 §2)", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(
    requestWith(risk({ statement: { cause: "Rate limiting is not enforced." } })),
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(
    findings.some((finding) => finding["category"] === "completeness" && (finding["message"] as string).includes("event, consequence")),
    true,
  );
});

test("a risk with no owner is a completeness finding", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(requestWith(risk({ owner: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(findings.some((finding) => finding["message"] === "The risk has no accountable owner."), true);
});

test("a risk with no controls is a critical treatment_governance finding (SPEC-205 §5/§9)", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(requestWith(risk({ controls: [] })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const controlFinding = findings.find((finding) => finding["category"] === "treatment_governance");
  assert.notEqual(controlFinding, undefined);
  assert.equal(controlFinding?.["severity"], "critical");
});

test("a risk with no residual-risk statement is a critical treatment_governance finding", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(requestWith(risk({ residual_risk: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  assert.equal(
    findings.some(
      (finding) => finding["category"] === "treatment_governance" && finding["severity"] === "critical",
    ),
    true,
  );
});

test("a risk missing likelihood/impact rationale is a medium completeness finding", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate(requestWith(risk({ likelihood_rationale: undefined })));

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.value.outcome, "not_satisfied");
  const findings = result.value.outputs["findings"] as JsonObject[];
  const rationaleFinding = findings.find((finding) =>
    (finding["message"] as string).includes("likelihood or impact rationale"),
  );
  assert.notEqual(rationaleFinding, undefined);
  assert.equal(rationaleFinding?.["severity"], "medium");
});

test("fails closed on missing risk facts", async () => {
  const engine = new RiskQualityRuleEngine();

  const result = await engine.evaluate({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "risk-quality", version: "1.0.0" },
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

runRuleEngineContract("risk-quality", {
  makeEngine: () => new RiskQualityRuleEngine(),
  satisfiedRequest: () => requestWith(risk()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "risk-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
  // SPEC-104 §9: a governance-level control rule vs. a Workspace-extension
  // variant of the same "risk must have controls" rule — a real
  // precedence scenario the shared contract suite resolves through
  // `resolveRulePrecedence`, independent of RiskQualityRuleEngine's own
  // single-rule-set evaluation logic.
  precedenceFixture: () => ({
    effectiveAt: "2026-08-05T08:00:00.000Z",
    workspaceId: "workspace-alpha",
    candidates: [
      {
        id: "risk-has-controls",
        version: "1.0.0",
        authority_class: "governance",
        specificity: 0,
        workspace_scope: "global",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_until: null,
        priority: 0,
        outcome: "critical",
      },
      {
        id: "risk-has-controls-workspace-alpha",
        version: "1.0.0",
        authority_class: "workspace_extension",
        specificity: 1,
        workspace_scope: "workspace-alpha",
        effective_from: "2026-01-01T00:00:00.000Z",
        effective_until: null,
        priority: 0,
        outcome: "high",
      },
    ],
  }),
});
