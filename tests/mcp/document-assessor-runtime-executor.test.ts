import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { DeterministicWorkspaceAuthorizer, canonicalWorkspaceIntegrityClaims } from "../../src/adapters/deterministic/workspace-authorizer.js";
import {
  AssessRiskQuality,
  RiskQualityRuleEngine,
} from "../../src/risk-analysis/assess-risk-quality.js";
import { InMemoryKnowledgeSearch } from "../../src/adapters/memory/knowledge-search.js";
import {
  DocumentQualityRuntimeExecutor,
  toDocumentQualityAssessment,
  toDocumentQualityFailure,
} from "../../src/mcp/document-assessor-runtime-executor.js";
import {
  buildDevFixture,
  RISK_QUALITY_AGENT,
  RISK_QUALITY_SKILL,
} from "../../src/mcp/dev-fixture.js";
import type { Risk } from "../../src/risk-analysis/public.js";
import type { AgentRunExecutorInput } from "../../src/runtime/executor.js";

const WORKSPACE_ID = "workspace-doc-assessor-001";
const POLICY_VERSION = "test-policy@0.1.0";
const ISSUER = "identity-test";
const AUDIENCE = "qa-intelligence-test";

function fixtureProof(canonicalClaims: string): string {
  return createHash("sha256").update(`fixture:${canonicalClaims}`).digest("hex");
}

function authorizerAndContext() {
  const clock = { now: (): Date => new Date("2026-08-10T08:00:00.000Z") };
  const permissions = [
    "agent:execute",
    "agent:read",
    "knowledge:read",
    "assessment:create",
    "risk:read",
    "workflow:read",
    "test_strategy:read",
    "test_case:read",
    "test_dataset:read",
    "automation_asset:read",
    "report:read",
    "requirement:read",
    "defect:read",
    "discovery:observe",
    "test-case:create",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
  ];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: ISSUER,
    expected_audience: AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: POLICY_VERSION, permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });
  const unsigned = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "tester-1",
    actor_type: "human" as const,
    roles: ["agent-operator"],
    permissions,
    policy_version: POLICY_VERSION,
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: [AUDIENCE],
    environment: "test",
    issued_at: "2026-08-10T07:00:00.000Z",
    expires_at: "2026-08-10T09:00:00.000Z",
    issuer: ISSUER,
    integrity_proof: "",
  };
  const context = {
    ...unsigned,
    integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)),
  };
  return { clock, authorizer, context };
}

function completeRisk(): Risk {
  return {
    id: "RISK-1",
    version: "1.0.0",
    status: "draft",
    statement: {
      cause: "Rate limiting is not enforced on the login endpoint.",
      event: "An attacker submits high-volume credential-stuffing requests.",
      consequence: "Legitimate user accounts are locked out or compromised.",
    },
    category: "security_and_privacy",
    affected: { workspace_id: WORKSPACE_ID, capability_id: "authentication" },
    likelihood_rationale: "Public endpoint with no prior rate-limiting control.",
    impact_rationale: "Account lockout affects all active users of this Workspace.",
    evidence: ["incident-report:INC-042"],
    owner: "Security Engineering",
    controls: ["control:rate-limit-login@1.0.0"],
    residual_risk: "Low, once rate limiting is deployed and monitored.",
  };
}

function executorInput(risk: Risk): AgentRunExecutorInput {
  const { context } = authorizerAndContext();
  return {
    reference: {
      schema_version: "1.0.0",
      run_id: "run-1",
      workspace_id: WORKSPACE_ID,
    },
    start_request: {
      schema_version: "1.0.0",
      operation_id: "operation-1",
      workspace_id: WORKSPACE_ID,
      actor_id: "tester-1",
      workspace_context: context,
      agent: RISK_QUALITY_AGENT,
      purpose: "Assess risk quality via MCP",
      consequence_class: "advisory",
      policy_version: POLICY_VERSION,
      allowed_skills: [RISK_QUALITY_SKILL],
      input: { risk: risk as unknown as Record<string, never> },
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 5, max_retries: 1 },
      deadline: "2026-08-10T09:00:00.000Z",
    },
    execution: {
      schema_version: "1.0.0",
      operation_id: "operation-1",
      workspace_id: WORKSPACE_ID,
      actor_id: "tester-1",
      policy_version: POLICY_VERSION,
      workspace_context: context,
      expected_revision: 1,
      idempotency_key: "idem-1",
    },
    signal: new AbortController().signal,
  } as unknown as AgentRunExecutorInput;
}

test("Phase 7 fixture registers all document-quality MCP tools", () => {
  const { clock, authorizer } = authorizerAndContext();
  const { tools } = buildDevFixture({
    workspaceId: WORKSPACE_ID,
    policyVersion: POLICY_VERSION,
    authorizer,
    clock,
  });
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of [
    "assess_business_analysis_quality",
    "assess_risk_quality",
    "assess_test_strategy_quality",
    "assess_test_case_quality",
    "assess_test_dataset_quality",
    "assess_automation_asset_quality",
    "assess_report_quality",
  ]) {
    assert.equal(names.has(name), true, `missing tool ${name}`);
  }
});

test("DocumentQualityRuntimeExecutor surfaces risk assessment verdict via MCP adapter", async () => {
  const { clock, authorizer } = authorizerAndContext();
  let assessmentSeq = 0;
  let findingSeq = 0;
  const reviewer = new AssessRiskQuality({
    authorizer,
    knowledge: new InMemoryKnowledgeSearch({
      workspace_id: WORKSPACE_ID,
      knowledge_snapshot: "0.1.0",
      projection_freshness: clock.now().toISOString(),
      records: [],
    }),
    rules: new RiskQualityRuleEngine(),
    clock,
    ids: {
      next: (scope) =>
        scope === "assessment" ? `assessment-${++assessmentSeq}` : `finding-${++findingSeq}`,
    },
    configuration: {
      resolved_versions: {
        agent: `${RISK_QUALITY_AGENT.id}@${RISK_QUALITY_AGENT.version}`,
        skill: `${RISK_QUALITY_SKILL.id}@${RISK_QUALITY_SKILL.version}`,
        rule_set: "risk-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: POLICY_VERSION,
        input_schema: "risk.schema.json@1.0.0",
        output_schema: "risk-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5 },
    },
  });

  const executor = new DocumentQualityRuntimeExecutor({
    expected_agent: RISK_QUALITY_AGENT,
    expected_skill: RISK_QUALITY_SKILL,
    document_key: "risk",
    review: async ({ operation_id, workspace_id, context, document }) => {
      const result = await reviewer.review({
        operation_id,
        workspace_id,
        context,
        risk: document as unknown as Risk,
      });
      if (!result.ok) return { ok: false, failure: toDocumentQualityFailure(result.failure) };
      return { ok: true, value: toDocumentQualityAssessment(result.value) };
    },
  });

  const result = await executor.execute(executorInput(completeRisk()));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.output["verdict"], "pass");
});

test("DocumentQualityRuntimeExecutor rejects empty document object", async () => {
  const executor = new DocumentQualityRuntimeExecutor({
    expected_agent: RISK_QUALITY_AGENT,
    expected_skill: RISK_QUALITY_SKILL,
    document_key: "risk",
    review: async () => {
      throw new Error("should not be called");
    },
  });
  const input = executorInput(completeRisk());
  (input.start_request.input as Record<string, unknown>)["risk"] = {};
  const result = await executor.execute(input);
  assert.equal(result.ok, false);
});
