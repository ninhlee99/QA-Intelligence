/**
 * Closes the generate->execute loop for an ad hoc `TestCase` (this
 * roadmap's Phase 3, docs/proposals/professional-qa-mcp-roadmap.md): takes
 * the exact `TestCase` + `TestCaseGeneratedAssertion` JSON a
 * `generate_test_cases` call returned, converts it via
 * `testCaseToExecutionPlan` (Phase 2's PlaywrightExecutionEngine), and runs
 * it — optionally filling in real field values (credentials, real data)
 * the generator deliberately left blank for the positive variant
 * (SPEC-207 §6: never invent "correct" test data). This is the seam that
 * lets a caller run a generated case against a real target the Workspace
 * has not pre-registered an environment/credential entry for yet (Phase
 * 3's remaining "real environment/credential registry" item) — every
 * value here comes from the MCP caller's own explicit input, never a
 * server-side secret store, so it carries no more authority than the
 * caller already had.
 */
import type { Browser } from "playwright";

import { PlaywrightExecutionEngine } from "../adapters/playwright/playwright-execution-engine.js";
import type { JsonObject, JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import { testCaseToExecutionPlan } from "./to-execution-plan.js";
import type { TestCase, TestCaseGeneratedAssertion } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import { isJsonObject } from "../shared/rule-engine-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type ExecuteGeneratedTestCaseRuntimeExecutorDependencies = Readonly<{
  clock: { now(): Date };
  authorizer: WorkspaceAuthorizer;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  launchBrowser?: () => Promise<Browser>;
}>;

export class ExecuteGeneratedTestCaseRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ExecuteGeneratedTestCaseRuntimeExecutorDependencies;

  constructor(dependencies: ExecuteGeneratedTestCaseRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const testCaseValue = input.start_request.input["test_case"];
    if (!isJsonObject(testCaseValue)) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "Execution requires an exact test_case object (from a prior generate_test_cases call).") };
    }
    const assertionValue = input.start_request.input["generated_assertion"];
    if (!isJsonObject(assertionValue)) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "Execution requires an exact generated_assertion object (from the same generate_test_cases call).") };
    }
    const fieldValuesInput = input.start_request.input["field_values"];
    const fieldValues = readFieldValues(fieldValuesInput);

    const testCase = testCaseValue as unknown as TestCase;
    const assertion = assertionValue as unknown as TestCaseGeneratedAssertion;

    const converted = testCaseToExecutionPlan(testCase, [assertion], fieldValues);
    if (!converted.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", converted.failure.message) };
    }

    const engine = new PlaywrightExecutionEngine({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      provider: { id: "playwright-execution-engine", version: "0.1.0" },
      plans: new Map([[testCase.id, converted.value]]),
      ...(this.#dependencies.launchBrowser !== undefined ? { launchBrowser: this.#dependencies.launchBrowser } : {}),
    });

    const now = this.#dependencies.clock.now();
    const attempt = { execution_id: input.reference.run_id, attempt_id: testCase.id };
    const startResult = await engine.start(
      {
        operation: "start",
        operationId: `${input.execution.operation_id}:start`,
        attempt,
        workspace: input.execution.workspace_context,
        idempotency: { key: `start:${testCase.id}`, scope: "start", request_digest: "" },
        deadline: { at: input.start_request.deadline, time_standard: "UTC" },
        version: { contract: "1.0.0", operation_schema: "1.0.0" },
        payload: { environment_lease: `lease:${input.reference.run_id}`, execution_plan_ref: `plan:${testCase.id}`, authorized_input_refs: [] },
      },
      () => {},
    );
    void now;

    if (!startResult.ok) {
      return { ok: false, failure: failure("skill", "skill_failure", `${startResult.failure.code}: ${startResult.failure.message}`, startResult.failure.retryable, startResult.failure.diagnostic_evidence_refs) };
    }

    const evidence = [...startResult.value.evidence, `test-case:${testCase.id}`];
    return {
      ok: true,
      value: {
        output: executionOutcomeJson(testCase.id, startResult.value.outcome),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          engine: "playwright-execution-engine@0.1.0",
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["playwright-execution-engine@0.1.0"],
        citations: evidence,
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: startResult.value.timing.duration_ms / 1000, tool_calls: 1, retries: 0 },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ExecuteGeneratedTestCaseRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Execute Generated Test Case executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Execute Generated Test Case is not present in retained Skill authority.");
  }
  return undefined;
}

function readFieldValues(value: JsonValue | undefined): ReadonlyMap<string, string> | undefined {
  if (!isJsonObject(value)) return undefined;
  const map = new Map<string, string>();
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") map.set(key, entry);
  }
  return map.size > 0 ? map : undefined;
}

function executionOutcomeJson(testCaseId: string, outcome: string): JsonObject {
  return { test_case_id: testCaseId, outcome };
}
