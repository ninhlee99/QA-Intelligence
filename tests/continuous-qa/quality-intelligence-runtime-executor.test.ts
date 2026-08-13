import assert from "node:assert/strict";
import test from "node:test";
import { QualityIntelligenceRuntimeExecutor } from "../../src/continuous-qa/quality-intelligence-runtime-executor.js";
import type { AgentRunExecutorInput } from "../../src/runtime/executor.js";

const agent = { id: "continuous", version: "1.0.0" }; const skill = { id: "continuous-skill", version: "1.0.0" };
const authorizer = { authorize: async () => ({ ok: true as const, value: { policy_version: "p", effective_permissions: ["execution:read"], authorized_resource_refs: ["workspace:ws"], decision_evidence: ["allow"] } }) };
function input(value: Record<string, unknown>): AgentRunExecutorInput { return { reference: { run_id: "r", workspace_id: "ws", revision: 1 }, start_request: { schema_version: "1.0.0", operation_id: "op", workspace_id: "ws", agent, allowed_skills: [skill], input: value, purpose: "test", budgets: { max_steps: 4, max_duration_seconds: 30, max_tool_calls: 0, max_retries: 0 }, idempotency_key: "k" }, execution: { operation_id: "op", workspace_context: { policy_version: "p" } }, signal: new AbortController().signal } as unknown as AgentRunExecutorInput; }

test("continuous QA runtime returns selected scope and trend through retained authority", async () => {
  const executor = new QualityIntelligenceRuntimeExecutor({ authorizer, expected_agent: agent, expected_skill: skill, mode: "continuous" });
  const result = await executor.execute(input({ changed_paths: ["src/auth/x.ts"], cases: [{ id: "TC", traced_paths: ["src/auth/**"], tags: [], critical: true }], critical_smoke_ids: [], quality_windows: [{ release: "r1", pass_rate: .99, flake_rate: 0, escaped_defects: 0 }] }));
  assert.equal(result.ok, true); if (result.ok) assert.deepEqual((result.value.output["selection"] as { selected: { id: string }[] }).selected.map((item) => item.id), ["TC"]);
});
