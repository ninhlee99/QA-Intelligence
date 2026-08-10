/**
 * Closes the generate->execute loop for an ad hoc `TestCase`: takes the
 * exact `TestCase` + `TestCaseGeneratedAssertion` JSON a
 * `generate_test_cases` call returned, converts it via
 * `testCaseToExecutionPlan`, and runs it through `ExecuteBrowserTest`
 * (same flake-detection + evidence path as `run_auto_qa`) — optionally
 * filling real field values the generator left blank for the positive
 * variant (SPEC-207 §6: never invent "correct" test data).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import type { InMemoryWorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { mergeFieldValuesWithSecrets, readStringMap } from "../credentials/resolve-secret-input.js";
import { ExecuteBrowserTest, MAX_FLAKE_TRIALS } from "../execution/execute-browser-test.js";
import type { JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
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
  /** Directory failure screenshots are written under. Defaults to cwd/.qa-screenshots/<operation_id>. */
  screenshotBaseDir?: string;
  credentials?: InMemoryWorkspaceCredentialRegistry;
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
    const fieldSecretRefsInput = input.start_request.input["field_secret_refs"];
    const fieldValuesMap = readStringMap(fieldValuesInput);
    const fieldSecretRefsMap = readStringMap(fieldSecretRefsInput);
    const merged = mergeFieldValuesWithSecrets({
      registry: this.#dependencies.credentials,
      workspaceId: input.reference.workspace_id,
      ...(fieldValuesMap !== undefined ? { field_values: fieldValuesMap } : {}),
      ...(fieldSecretRefsMap !== undefined ? { field_secret_refs: fieldSecretRefsMap } : {}),
    });
    if (!merged.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", merged.message) };
    }
    const fieldValues = merged.values.size > 0 ? merged.values : undefined;

    const testCase = testCaseValue as unknown as TestCase;
    const assertion = assertionValue as unknown as TestCaseGeneratedAssertion;

    const converted = testCaseToExecutionPlan(testCase, [assertion], fieldValues);
    if (!converted.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", converted.failure.message) };
    }

    const screenshotDir = join(
      this.#dependencies.screenshotBaseDir ?? process.cwd(),
      ".qa-screenshots",
      input.execution.operation_id,
    );
    let screenshotDirReady = true;
    try {
      await mkdir(screenshotDir, { recursive: true });
    } catch {
      screenshotDirReady = false;
    }

    const plans = new Map<string, PlaywrightExecutionPlan>(
      Array.from({ length: MAX_FLAKE_TRIALS }, (_, i) => {
        const key = i === 0 ? testCase.id : `${testCase.id}:trial-${i + 1}`;
        return [key, converted.value] as const;
      }),
    );
    const engine = new PlaywrightExecutionEngine({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      provider: { id: "playwright-execution-engine", version: "0.1.0" },
      plans,
      ...(this.#dependencies.launchBrowser !== undefined ? { launchBrowser: this.#dependencies.launchBrowser } : {}),
      ...(screenshotDirReady ? { screenshotDir } : {}),
    });
    const skill = new ExecuteBrowserTest({
      engine,
      clock: this.#dependencies.clock,
      provider_ref: "playwright-execution-engine@0.1.0",
    });

    const run = await skill.run({
      operation_id: `${input.execution.operation_id}:${testCase.id}`,
      workspace: input.execution.workspace_context,
      execution: { execution_id: input.reference.run_id, attempt_id: testCase.id },
      test_case_ref: testCase.id,
      environment_ref: `environment:${input.execution.operation_id}`,
      deadline: input.start_request.deadline,
    });

    if (!run.ok) {
      return {
        ok: false,
        failure: failure(
          run.failure.class === "authorization" ? "policy" : "skill",
          run.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          run.failure.message,
          run.failure.retryable,
          run.failure.evidence,
        ),
      };
    }

    const outcome = run.value.outcome ?? "indeterminate";
    const evidence = [...(run.value.evidence ?? []), `test-case:${testCase.id}`];
    return {
      ok: true,
      value: {
        output: {
          test_case_id: testCase.id,
          outcome,
          ...(run.value.skip_reason !== undefined ? { skip_reason: run.value.skip_reason } : {}),
          evidence: [...evidence],
        },
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
        uncertainty: {
          level: outcome === "flaky" ? "medium" : "none",
          reasons: outcome === "flaky" ? ["Outcome disagreed across flake-detection trials."] : [],
        },
        policy_events: [],
        usage: {
          steps: 1,
          duration_seconds: run.value.timing?.duration_seconds ?? 0,
          tool_calls: 1,
          retries: 0,
        },
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
