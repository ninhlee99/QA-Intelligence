import { RequirementQualityRuleEngine } from "../../src/requirement-review/assess-requirement-quality.js";
import type { JsonObject, RuleEvaluationRequest } from "../../src/requirement-review/public.js";
import { runRuleEngineContract } from "../shared/rule-engine-contract.js";

/**
 * SPEC-502 conformance for `RequirementQualityRuleEngine` directly (§4/§6),
 * separate from `assess-requirement-quality.test.ts`'s Skill-level tests,
 * which only exercise this engine indirectly through `AssessRequirementQuality`
 * and never call `.evaluate()` with a bare `RuleEvaluationRequest` the way
 * every other rule engine's own test file does.
 */

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
    rule_set: { id: "requirement-quality", version: "1.0.0" },
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
    acceptance_criteria: [{ criterion: "Reviewer downloads a signed PDF within 5 seconds." }],
    traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
    ...overrides,
  };
}

runRuleEngineContract("requirement-quality", {
  makeEngine: () => new RequirementQualityRuleEngine(),
  satisfiedRequest: () => requestWith(requirement()),
  emptyFactsRequest: () => ({
    evaluation_id: "evaluation-1",
    context: baseContext(),
    rule_set: { id: "requirement-quality", version: "1.0.0" },
    effective_at: "2026-08-05T08:00:00.000Z",
    facts: {},
    fact_provenance: [],
    requested_decisions: [],
    trace_level: "summary",
  }),
});
