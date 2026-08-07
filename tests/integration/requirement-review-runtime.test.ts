import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { InMemoryKnowledgeSearch } from "../../src/adapters/memory/knowledge-search.js";
import { InMemoryRequirementResolver } from "../../src/adapters/memory/requirement-resolver.js";
import { ScriptedReasoningProvider } from "../../src/adapters/replay/scripted-reasoning-provider.js";
import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
} from "../../src/requirement-review/assess-requirement-quality.js";
import type {
  Requirement,
  RequirementAssessment,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import { RequirementReviewRuntimeExecutor } from "../../src/requirement-review/runtime-executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";
import type { AgentRunResult } from "../../src/runtime/public.js";
import {
  SchemaValidator,
  type SchemaObject,
} from "../../src/schema/schema-validator.js";

const NOW = "2026-08-03T08:00:00.000Z";
const WORKSPACE_ID = "workspace-runtime-001";
const AGENT = { id: "requirement-review-agent", version: "0.1.0" } as const;
const SKILL = { id: "assess-requirement-quality", version: "0.1.0" } as const;
const ASSESSMENT_SCHEMA_ID =
  "https://qa-intelligence.local/schemas/requirement-assessment.schema.json";
const RESULT_SCHEMA_ID =
  "https://qa-intelligence.local/schemas/agent-run-result.schema.json";

const clock = { now: (): Date => new Date(NOW) };

class RuntimeSequenceIds implements RuntimeIdFactory {
  #run = 0;
  #event = 0;

  next(kind: "run" | "event"): string {
    if (kind === "run") return `run-${++this.#run}`;
    return `event-${++this.#event}`;
  }
}

function context(): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "reviewer-001",
    actor_type: "human",
    roles: ["requirement-reviewer", "agent-operator"],
    permissions: [
      "agent:execute",
      "agent:read",
      "requirement:read",
      "knowledge:read",
      "assessment:create",
    ],
    policy_version: "test-policy@0.1.0",
    request_id: "request-runtime-001",
    correlation_id: "correlation-runtime-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-03T07:00:00.000Z",
    expires_at: "2026-08-03T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return {
    ...unsigned,
    integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)),
  };
}

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function requirement(): Requirement {
  return {
    id: "REQ-001",
    version: "1.0.0",
    status: "in_review",
    title: "Export an audit report",
    statement: "The platform shall export an audit report.",
    source: ["product-brief@1.0.0"],
    owner: "Product Requirements",
    capability_id: "audit-reporting",
    scope: { workspace_id: WORKSPACE_ID },
    acceptance_criteria: [],
    traceability: [
      { relationship: "derived_from", target_id: "product-brief@1.0.0" },
    ],
  };
}

test("executes Requirement Review through the runtime while preserving the QA verdict", async () => {
  const [assessmentSchema, resultSchema] = await Promise.all([
    readFile("schemas/requirement-assessment.schema.json", "utf8"),
    readFile("schemas/agent-run-result.schema.json", "utf8"),
  ]);
  const schemas = new SchemaValidator([
    JSON.parse(assessmentSchema) as SchemaObject,
    JSON.parse(resultSchema) as SchemaObject,
  ]);
  const permissions = [
    "agent:execute",
    "agent:read",
    "requirement:read",
    "knowledge:read",
    "assessment:create",
  ];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: {
      workspace_id: WORKSPACE_ID,
      version: "test-policy@0.1.0",
      permissions,
    },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });
  const reasoning = new ScriptedReasoningProvider([]);
  let reviewId = 0;
  const reviewer = new AssessRequirementQuality({
    authorizer,
    knowledge: new InMemoryKnowledgeSearch({
      workspace_id: WORKSPACE_ID,
      knowledge_snapshot: "0.1.0",
      projection_freshness: NOW,
      records: [],
    }),
    rules: new RequirementQualityRuleEngine(),
    reasoning,
    clock,
    ids: { next: (scope): string => `${scope}-${++reviewId}` },
    configuration: {
      resolved_versions: {
        agent: `${AGENT.id}@${AGENT.version}`,
        skill: `${SKILL.id}@${SKILL.version}`,
        prompt: "requirement-assessment-prompt@0.1.0",
        rule_set: "requirement-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: "test-policy@0.1.0",
        input_schema: "requirement.schema.json@1.0.0",
        output_schema: "requirement-assessment.schema.json@1.0.0",
      },
      limits: {
        knowledge_hits: 5,
        reasoning_tokens: 500,
        reasoning_cost: 0,
        reasoning_timeout_ms: 5_000,
      },
    },
  });
  const runtime = new InMemoryAgentRuntime(
    clock,
    new RuntimeSequenceIds(),
    authorizer,
    new RequirementReviewRuntimeExecutor({
      reviewer,
      requirements: new InMemoryRequirementResolver(
        WORKSPACE_ID,
        [requirement()],
        authorizer,
      ),
      validateAssessment: (assessment): boolean =>
        schemas.validate<RequirementAssessment>(ASSESSMENT_SCHEMA_ID, assessment).ok,
      expected_agent: AGENT,
      expected_skill: SKILL,
    }),
  );
  const workspaceContext = context();
  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Review REQ-001 without changing authoritative product intent.",
    consequence_class: "advisory",
    input: { requirement_ref: "REQ-001@1.0.0" },
    allowed_skills: [SKILL],
    policy_version: workspaceContext.policy_version,
    budgets: {
      max_steps: 1,
      max_duration_seconds: 60,
      max_tool_calls: 0,
      max_retries: 0,
    },
    deadline: "2026-08-03T09:00:00.000Z",
    evidence_requirements: ["assessment-schema", "requirement-traceability"],
    idempotency_key: "requirement-review-start-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const access = {
    schema_version: "1.0.0" as const,
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
  };
  const executed = await runtime.execute(started.value, {
    ...access,
    expected_revision: 3,
    idempotency_key: "requirement-review-execute-001",
  });

  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed");
  assert.equal(executed.value.failure_class, null);
  assert.equal(executed.value.output?.outcome, "completed");
  assert.equal(executed.value.output?.verdict, "changes_required");
  assert.deepEqual(executed.value.skill_usage, [
    "assess-requirement-quality@0.1.0",
  ]);
  assert.equal(reasoning.calls.length, 0);
  assert.equal(
    schemas.validate<AgentRunResult>(RESULT_SCHEMA_ID, executed.value).ok,
    true,
  );

  const retained = await runtime.result(started.value, {
    ...access,
    operation_id: "operation-runtime-result",
  });
  const snapshot = await runtime.inspect(started.value, {
    ...access,
    operation_id: "operation-runtime-inspect",
  });
  assert.equal(retained.ok, true);
  if (retained.ok) assert.strictEqual(retained.value, executed.value);
  assert.equal(snapshot.ok, true);
  if (snapshot.ok) {
    assert.equal(snapshot.value.state, "completed");
    assert.equal(snapshot.value.revision, 6);
  }
});
