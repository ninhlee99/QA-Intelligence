import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { InMemoryKnowledgeSearch } from "../../src/adapters/memory/knowledge-search.js";
import { ScriptedReasoningProvider } from "../../src/adapters/replay/scripted-reasoning-provider.js";
import {
  EvaluationManager,
  StaticEvaluationSuitePolicyRegistry,
} from "../../src/evaluation/evaluation-manager.js";
import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
} from "../../src/requirement-review/assess-requirement-quality.js";
import type {
  Requirement,
  RequirementAssessment,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import { RequirementReviewDevelopmentHarness } from "../../src/requirement-review/tracer-bullet.js";
import { SchemaValidator, type SchemaObject } from "../../src/schema/schema-validator.js";

const NOW = "2026-08-03T08:00:00.000Z";
const WORKSPACE_ID = "workspace-evaluation-001";
const ASSESSMENT_SCHEMA_ID =
  "https://qa-intelligence.local/schemas/requirement-assessment.schema.json";

const clock = { now: (): Date => new Date(NOW) };

function context(): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "reviewer-001",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["requirement:read", "knowledge:read", "assessment:create"],
    policy_version: "test-policy-0.1.0",
    request_id: "request-001",
    correlation_id: "correlation-001",
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
    title: "Fast requirement review",
    statement: "The platform shall review each requirement quickly.",
    source: ["product-brief@1.0.0"],
    owner: "Product Requirements",
    capability_id: "requirement-intelligence",
    scope: { workspace_id: WORKSPACE_ID },
    acceptance_criteria: [
      { id: "AC-001", expected: "An assessment is returned with evidence." },
    ],
    traceability: [{ relationship: "governed_by", target_id: "SPEC-203" }],
  };
}

test("runs the development tracer bullet without recommending release before suite completion", async () => {
  const schema = JSON.parse(
    await readFile("schemas/requirement-assessment.schema.json", "utf8"),
  ) as SchemaObject;
  let id = 0;
  const reasoning = new ScriptedReasoningProvider([
    {
      case_id: "ambiguous-speed",
      match: {
        operation_id: "operation-001:bounded-reasoning",
        context: context(),
        purpose: "assess unresolved semantic gaps",
        workspace_id: WORKSPACE_ID,
        actor_id: "reviewer-001",
        policy_version: "test-policy-0.1.0",
        consequence_class: "advisory",
        capability_constraints: [
          "Do not invent business intent.",
          "Return uncertainty and a human-answerable question when authority is missing.",
          "Do not approve, edit, or mutate the requirement.",
        ],
        prompt: { id: "requirement-assessment-prompt", version: "0.1.0" },
        authorized_context_refs: [
          "REQ-001@1.0.0",
          "quality-rule-source-001@1.0.0",
          "rule-set:requirement-quality@1.0.0:indeterminate",
          "rule:requirement-has-acceptance-criteria@1.0.0",
          "rule:requirement-has-authoritative-source@1.0.0",
          "rule:requirement-avoids-unbounded-terms@1.0.0",
          "semantic term requires authoritative clarification",
        ],
        output_schema: {
          id: "requirement-assessment.schema.json",
          version: "1.0.0",
        },
        allowed_tools: [],
        limits: {
          max_tokens: 500,
          max_cost: 0,
          timeout_ms: 5_000,
          max_retries: 0,
        },
        safety_policy: { id: "test-policy", version: "0.1.0" },
      },
      provider: {
        provider_id: "scripted-replay",
        provider_version: "1.0.0",
        model_id: "scripted-model-001",
      },
      outcome: {
        kind: "completed",
        structured_output: {
          question: "What response-time threshold makes quickly observable?",
          uncertainty: "No authoritative response-time threshold is available.",
        },
        usage: { input_tokens: 80, output_tokens: 40, cost: 0 },
        latency_ms: 10,
        citations: ["REQ-001@1.0.0", "quality-rule-source-001@1.0.0"],
      },
    },
  ]);
  const reviewer = new AssessRequirementQuality({
    authorizer: new DeterministicWorkspaceAuthorizer({
      clock,
      expected_issuer: "https://identity.test.invalid",
      expected_audience: "qa-intelligence-test",
      workspace: { workspace_id: WORKSPACE_ID, status: "active" },
      policy: {
        workspace_id: WORKSPACE_ID,
        version: "test-policy-0.1.0",
        permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      },
      integrity_proof_verifier: {
        verify({ canonical_claims, integrity_proof }): boolean {
          return integrity_proof === fixtureProof(canonical_claims);
        },
      },
    }),
    knowledge: new InMemoryKnowledgeSearch({
      workspace_id: WORKSPACE_ID,
      knowledge_snapshot: "0.1.0",
      projection_freshness: NOW,
      records: [
        {
          workspace_id: WORKSPACE_ID,
          knowledge_snapshot: "0.1.0",
          knowledge_ref: "quality-rule-source-001@1.0.0",
          title: "Observable acceptance criteria",
          excerpt: "A testable requirement has observable acceptance criteria.",
          authority_status: "accepted",
          scopes: ["requirements", "business_rules"],
          applicability: {
            workspace_id: WORKSPACE_ID,
            capability_id: "requirement-intelligence",
          },
          provenance: ["SPEC-203"],
          evidence: ["evidence://SPEC-203/testability"],
        },
      ],
    }),
    rules: new RequirementQualityRuleEngine(),
    reasoning,
    clock,
    ids: { next: (scope): string => `${scope}-${++id}` },
    configuration: {
      resolved_versions: {
        agent: "requirement-review-agent@0.1.0",
        skill: "assess-requirement-quality@0.1.0",
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
  const tracer = new RequirementReviewDevelopmentHarness({
    reviewer,
    evaluator: new EvaluationManager(
      clock,
      new StaticEvaluationSuitePolicyRegistry([
        {
          suite: { id: "assess-requirement-quality-core", version: "0.1.0" },
          required_case_ids: ["requirement-review-execution"],
          critical_invariant_ids: [
            "assessment-schema",
            "workspace-isolation",
            "evidence-completeness",
            "exact-version-pins",
          ],
          minimum_trials_per_case: 3,
        },
      ]),
      { verify: () => true },
    ),
    validateAssessment: (value): boolean =>
      new SchemaValidator([schema]).validate<RequirementAssessment>(
        ASSESSMENT_SCHEMA_ID,
        value,
      ).ok,
  });

  const result = await tracer.execute({
    operation_id: "operation-001",
    workspace_id: WORKSPACE_ID,
    context: context(),
    requirement: requirement(),
    evaluation_run_id: "evaluation-run-001",
    evaluation_suite: {
      id: "assess-requirement-quality-core",
      version: "0.1.0",
    },
  });

  assert.equal(
    result.review.ok,
    true,
    JSON.stringify({ review: result.review, reasoning_request: reasoning.calls[0] }),
  );
  assert.ok(result.review.ok);
  assert.equal(result.review.value.outcome, "indeterminate");
  assert.equal(result.review.value.verdict, "changes_required");
  assert.deepEqual(result.review.value.questions, [
    "What response-time threshold makes quickly observable?",
    "Which authoritative evidence resolves authoritative meaning for 'quickly'?",
  ]);
  assert.equal(reasoning.calls.length, 1);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.deepEqual(result.evaluation.metrics.invalid_test_reasons, [
    "minimum-trials-not-met:requirement-review-execution",
  ]);
  assert.equal(
    result.evaluation.critical_invariants.every((invariant) => invariant.passed),
    true,
  );
});
