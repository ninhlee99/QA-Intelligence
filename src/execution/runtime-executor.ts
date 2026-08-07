import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type {
  ExecuteBrowserTest,
  ExecuteBrowserTestFailure,
} from "./execute-browser-test.js";
import type { ExecutionRecord } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type BrowserTestRuntimeExecutorDependencies = Readonly<{
  skill: ExecuteBrowserTest;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

/** Runtime-owned adapter invoking the Browser Test Execution Skill through retained input. Mirrors `RequirementReviewRuntimeExecutor`. */
export class BrowserTestRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: BrowserTestRuntimeExecutorDependencies;

  constructor(dependencies: BrowserTestRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const testCaseRef = input.start_request.input["test_case_ref"];
    const environmentRef = input.start_request.input["environment_ref"];
    if (typeof testCaseRef !== "string" || testCaseRef.trim().length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "Browser Test execution requires an exact test_case_ref input.",
        ),
      };
    }
    if (typeof environmentRef !== "string" || environmentRef.trim().length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "Browser Test execution requires an exact environment_ref input.",
        ),
      };
    }

    const run = await this.#dependencies.skill.run({
      operation_id: input.execution.operation_id,
      workspace: input.execution.workspace_context,
      // `PlaywrightExecutionEngine` looks up its seeded plan by
      // `attempt.attempt_id` (ADR-022's tracer bullet has no separate plan
      // registry keyed by `test_case_ref`) — using `test_case_ref` directly
      // as the attempt id is what lets the seeded plan resolve.
      execution: {
        execution_id: input.reference.run_id,
        attempt_id: testCaseRef,
      },
      test_case_ref: testCaseRef,
      environment_ref: environmentRef,
      deadline: input.start_request.deadline,
    });
    if (!run.ok) return { ok: false, failure: mapSkillFailure(run.failure) };

    const record = run.value;
    const evidence = unique([
      ...(record.evidence ?? []),
      `execution-record:${record.id}`,
    ]);

    return {
      ok: true,
      value: {
        output: executionRecordJson(record),
        output_validated: true,
        satisfied_evidence_requirements: [],
        // Only exact version pins belong here (runtime's `isExactVersionPin`
        // check, in-memory-agent-runtime.ts) — `test_case_ref`/`environment_ref`
        // are plain identifiers, not versions, so they travel via `citations`
        // instead (below).
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          engine: record.engine_ref,
        },
        rule_results: [],
        skill_usage: [
          `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        ],
        tool_usage: [record.engine_ref],
        citations: unique([
          ...evidence,
          `test-case:${testCaseRef}`,
          `environment:${environmentRef}`,
        ]),
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: {
          steps: 1,
          duration_seconds: record.timing?.duration_seconds ?? 0,
          tool_calls: 1,
          retries: 0,
        },
        evidence,
        // SPEC-504 §3 `finalize` already ran inside the Skill; the browser
        // and its lease are released before this result is returned.
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: BrowserTestRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure(
      "orchestration",
      "incompatible_version",
      "Retained Agent version is not supported by the Browser Test executor.",
    );
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id &&
        skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure(
      "policy",
      "authorization_denied",
      "Execute Browser Test is not present in retained Skill authority.",
    );
  }
  return undefined;
}

function mapSkillFailure(value: ExecuteBrowserTestFailure): AgentRunFailure {
  switch (value.class) {
    case "configuration":
      return failure("orchestration", "invalid_definition", value.message, value.retryable, value.evidence);
    case "authorization":
      return failure("policy", "authorization_denied", value.message, value.retryable, value.evidence);
    case "engine":
      return failure("skill", "skill_failure", value.message, value.retryable, value.evidence);
    case "infrastructure":
      return failure("infrastructure", "unavailable", value.message, value.retryable, value.evidence);
  }
}

function executionRecordJson(value: ExecutionRecord): JsonObject {
  return {
    id: value.id,
    workspace_id: value.workspace_id,
    actor_id: value.actor_id,
    test_case_ref: value.test_case_ref,
    automation_asset_ref: value.automation_asset_ref,
    engine_ref: value.engine_ref,
    environment_ref: value.environment_ref,
    state: value.state,
    outcome: value.outcome,
    evidence: [...(value.evidence ?? [])],
    timing: value.timing ? { ...value.timing } : {},
    resource_usage: value.resource_usage ?? {},
  };
}
