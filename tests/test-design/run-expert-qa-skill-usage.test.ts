import assert from "node:assert/strict";
import test from "node:test";

import { RunExpertQaRuntimeExecutor } from "../../src/test-design/run-expert-qa-runtime-executor.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../../src/runtime/executor.js";
import type { JsonObject } from "../../src/requirement-review/public.js";

const EXPERT_AGENT = { id: "expert-qa-facade-agent", version: "0.1.0" } as const;
const EXPERT_SKILL = { id: "run-expert-qa", version: "0.1.0" } as const;
const AUTO_AGENT = { id: "auto-qa-pipeline-agent", version: "0.1.0" } as const;
const AUTO_SKILL = { id: "run-auto-qa-pipeline", version: "0.1.0" } as const;

class StubAutoQa implements AgentRunExecutor {
  async execute(_input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const output: JsonObject = {
      release_recommendation: "changes_required",
      release_recommendation_rationale: "missing oracle",
      test_cases: [],
      summary: { passed: 0, failed: 0, flaky: 0, not_executed: 1 },
      draft_defects: [],
      coverage_gaps: [{ id: "gap-1", message: "gap" }],
      smart_retest_suggestion: { action: "full_retest" },
      auto_registered_suite: null,
      expert_checklist: {
        claim_pass_allowed: false,
        blockers: ["oracle_weak:AC1", "gate:changes_required"],
      },
    };
    return {
      ok: true,
      value: {
        output,
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${AUTO_AGENT.id}@${AUTO_AGENT.version}`,
          policy: "test-policy@0.1.0",
          skill: `${AUTO_SKILL.id}@${AUTO_SKILL.version}`,
          execution_engine: "playwright-execution-engine@0.1.0",
          discovery_engine: "playwright-dom-pipeline@0.1.0",
        },
        rule_results: [],
        skill_usage: [`${AUTO_SKILL.id}@${AUTO_SKILL.version}`],
        tool_usage: ["playwright-execution-engine@0.1.0", "playwright-dom-pipeline@0.1.0"],
        citations: ["source-url:https://example.invalid"],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 3, duration_seconds: 0, tool_calls: 1, retries: 0 },
        evidence: ["capture:stub"],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function baseInput(): AgentRunExecutorInput {
  return {
    reference: { schema_version: "1.0.0", run_id: "run-1", workspace_id: "ws-1" },
    start_request: {
      schema_version: "1.0.0",
      operation_id: "op-start",
      workspace_id: "ws-1",
      actor_id: "actor-1",
      workspace_context: {
        schema_version: "1.0.0",
        workspace_id: "ws-1",
        actor_id: "actor-1",
        actor_type: "human",
        roles: [],
        permissions: [],
        policy_version: "test-policy@0.1.0",
        request_id: "r1",
        correlation_id: "c1",
        audience: [],
        environment: "test",
        issued_at: "2026-08-07T00:00:00.000Z",
        expires_at: "2030-01-01T00:00:00.000Z",
        issuer: "test",
        integrity_proof: "proof",
      },
      agent: EXPERT_AGENT,
      purpose: "expert",
      consequence_class: "reversible",
      input: {
        url: "https://example.invalid/app",
        acceptance_criteria: [{ id: "AC1", statement: "Keyword search works" }],
      },
      policy_version: "test-policy@0.1.0",
      budgets: { max_steps: 8, max_duration_seconds: 60, max_tool_calls: 8, max_retries: 1 },
      deadline: "2030-01-01T00:00:00.000Z",
      idempotency_key: "idem-1",
      allowed_skills: [EXPERT_SKILL],
      allowed_tools: [
        { id: "playwright-dom-pipeline", version: "0.1.0" },
        { id: "playwright-execution-engine", version: "0.1.0" },
      ],
    },
    execution: {
      schema_version: "1.0.0",
      operation_id: "op-exec",
      workspace_id: "ws-1",
      actor_id: "actor-1",
      policy_version: "test-policy@0.1.0",
      workspace_context: {
        schema_version: "1.0.0",
        workspace_id: "ws-1",
        actor_id: "actor-1",
        actor_type: "human",
        roles: [],
        permissions: [],
        policy_version: "test-policy@0.1.0",
        request_id: "r1",
        correlation_id: "c1",
        audience: [],
        environment: "test",
        issued_at: "2026-08-07T00:00:00.000Z",
        expires_at: "2030-01-01T00:00:00.000Z",
        issuer: "test",
        integrity_proof: "proof",
      },
      expected_revision: 3,
      idempotency_key: "idem-1:execute",
    },
    signal: new AbortController().signal,
  };
}

test("run_expert_qa skill_usage is only the facade skill (not wrapped auto_qa)", async () => {
  const executor = new RunExpertQaRuntimeExecutor({
    autoQa: new StubAutoQa(),
    expected_agent: EXPERT_AGENT,
    expected_skill: EXPERT_SKILL,
    auto_qa_agent: AUTO_AGENT,
    auto_qa_skill: AUTO_SKILL,
  });

  const result = await executor.execute(baseInput());
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.deepEqual(result.value.skill_usage, [`${EXPERT_SKILL.id}@${EXPERT_SKILL.version}`]);
  assert.ok(!result.value.skill_usage.includes(`${AUTO_SKILL.id}@${AUTO_SKILL.version}`));

  const output = result.value.output as JsonObject;
  assert.equal(typeof output["expert_checklist"], "object");
  const checklist = output["expert_checklist"] as JsonObject;
  assert.equal(checklist["claim_pass_allowed"], false);
  assert.ok(Array.isArray(checklist["blockers"]));

  assert.ok(
    result.value.uncertainty.reasons.some((r) => r.includes("claim_pass_allowed=false")),
  );
  assert.ok(result.value.uncertainty.reasons.some((r) => r.startsWith("blockers:")));
});
