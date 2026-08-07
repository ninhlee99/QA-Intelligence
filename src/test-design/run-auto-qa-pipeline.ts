/**
 * Composes the four Skills a caller previously had to invoke as separate
 * MCP calls — Discovery (`DiscoverUiSurface`/`DiscoverAfterLogin`), Test
 * Design (`GenerateTestCases`), Execution (`testCaseToExecutionPlan` +
 * `PlaywrightExecutionEngine`), and Reporting (`QaRunReport`) — behind one
 * `run()` call, so "here is a URL and what it should do" produces a
 * generated-and-executed report without the caller composing
 * discover_ui_surface -> generate_test_cases -> execute_generated_test_case
 * itself (docs/proposals/professional-qa-mcp-roadmap.md's stated Phase 3
 * goal, extended to close the execute+report loop this roadmap left open).
 *
 * Each inner Skill still runs its own authorization independently — this
 * module adds no authority of its own, exactly like
 * `GenerateTestCasesRuntimeExecutor` it extends the same pattern from. A
 * test case with no generated assertion (SPEC-207 §6: the generator never
 * fabricates one) or whose execution plan cannot be built is reported as
 * `not_executed`, never silently skipped or given a fabricated outcome
 * (SPEC-210 §4). A non-`passed`/`failed` `ExecutionOutcome` (`blocked`,
 * `skipped`, `flaky`, `infrastructure_error`, `indeterminate`) is likewise
 * never rounded up to `passed` or down to `failed` — it is reported as
 * `not_executed` with the outcome preserved in `skip_reason`, so a real
 * infrastructure failure never reads as a test failure or a pass.
 */
import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { SemanticUiDiscoveryResult } from "../discovery/public.js";
import { testCaseToExecutionPlan } from "./to-execution-plan.js";
import { summarizeQaRunTestCases, type QaRunReport, type QaRunTestCaseResult } from "../reporting/qa-run-report.js";
import type { GenerateTestCasesResult, JsonObject, TestCase, TestCaseGeneratedAssertion } from "./public.js";

export interface Clock {
  now(): Date;
}

/** Matches `DiscoverUiSurface.discover`/`DiscoverAfterLogin.discover`'s own signature — accepted as a plain function so either can be injected (already bound to its own `url` vs. `login_url`+`target_url` request) without this module depending on both concrete classes. */
export type QaPipelineDiscover = (operationId: string, context: WorkspaceContext) => Promise<SemanticUiDiscoveryResult>;

export interface QaPipelineGenerator {
  generate(request: {
    operation_id: string;
    workspace_id: string;
    context: WorkspaceContext;
    requirement_ref: string;
    requirement_title: string;
    acceptance_criteria: readonly JsonObject[];
    ui_map_elements: readonly { id: string; kind: "page" | "field" | "action"; accessible_name?: string; accessible_role?: string; interaction_hint?: "clickable" | "editable" | "selectable" | "navigable" | "none" }[];
    ui_map_source_url: string;
  }): Promise<GenerateTestCasesResult>;
}

export type RunAutoQaPipelineRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  requirement_ref: string;
  requirement_title: string;
  /** The page Discovery observes and Test Design binds criteria against — used only for the report's `target_url` field; the actual navigation target is whatever `discover` (already bound to the right request) resolves. */
  url: string;
  acceptance_criteria: readonly JsonObject[];
}>;

export type RunAutoQaPipelineFailure = Readonly<{
  class: "authorization" | "infrastructure" | "configuration";
  code: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type RunAutoQaPipelineResult =
  | Readonly<{ ok: true; value: QaRunReport }>
  | Readonly<{ ok: false; failure: RunAutoQaPipelineFailure }>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  discover: QaPipelineDiscover;
  generator: QaPipelineGenerator;
  launchBrowser?: () => Promise<import("playwright").Browser>;
}>;

/** Deep module: one `run()` call hides discovery, generation, per-case execution, and report assembly. */
export class RunAutoQaPipeline {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async run(request: RunAutoQaPipelineRequest): Promise<RunAutoQaPipelineResult> {
    const discovered = await this.#dependencies.discover(request.operation_id, request.context);
    if (!discovered.ok) {
      return {
        ok: false,
        failure: {
          class: discovered.failure.class === "authorization" ? "authorization" : "infrastructure",
          code: discovered.failure.code,
          message: discovered.failure.message,
          retryable: discovered.failure.retryable,
          evidence: discovered.failure.evidence,
        },
      };
    }

    const generated = await this.#dependencies.generator.generate({
      operation_id: request.operation_id,
      workspace_id: request.workspace_id,
      context: request.context,
      requirement_ref: request.requirement_ref,
      requirement_title: request.requirement_title,
      acceptance_criteria: request.acceptance_criteria,
      ui_map_elements: discovered.value.elements,
      ui_map_source_url: discovered.value.source_url,
    });
    if (!generated.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: generated.failure.code,
          message: generated.failure.message,
          retryable: generated.failure.retryable,
          evidence: generated.failure.evidence,
        },
      };
    }

    const testCaseResults: QaRunTestCaseResult[] = [];
    for (const testCase of generated.value.test_cases) {
      testCaseResults.push(await this.#executeOne(testCase, generated.value.generated_assertions, request));
    }

    const report: QaRunReport = {
      schema_version: "1.0.0",
      workspace_id: request.workspace_id,
      target_url: request.url,
      generated_at: this.#dependencies.clock.now().toISOString(),
      requirement_ref: request.requirement_ref,
      discovery_capture_id: discovered.value.capture_id,
      discovery_element_count: discovered.value.elements.length,
      test_cases: testCaseResults,
      generation_findings: generated.value.findings,
      summary: summarizeQaRunTestCases(testCaseResults),
    };

    return { ok: true, value: report };
  }

  async #executeOne(
    testCase: TestCase,
    assertions: readonly TestCaseGeneratedAssertion[],
    request: RunAutoQaPipelineRequest,
  ): Promise<QaRunTestCaseResult> {
    const variant = testCase.tags?.[testCase.tags.length - 1] ?? "unknown";
    const converted = testCaseToExecutionPlan(testCase, assertions);
    if (!converted.ok) {
      return {
        test_case_id: testCase.id,
        purpose: testCase.purpose,
        variant,
        outcome: "not_executed",
        skip_reason: converted.failure.message,
        evidence: [],
      };
    }

    const plans = new Map<string, PlaywrightExecutionPlan>([[testCase.id, converted.value]]);
    const engine = new PlaywrightExecutionEngine({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      provider: { id: "playwright-execution-engine", version: "0.1.0" },
      plans,
      ...(this.#dependencies.launchBrowser !== undefined ? { launchBrowser: this.#dependencies.launchBrowser } : {}),
    });

    const attempt = { execution_id: `${request.operation_id}:auto-qa`, attempt_id: testCase.id };
    const startResult = await engine.start(
      {
        operation: "start",
        operationId: `${request.operation_id}:${testCase.id}:start`,
        attempt,
        workspace: request.context,
        idempotency: { key: `start:${testCase.id}`, scope: "start", request_digest: "" },
        deadline: { at: new Date(this.#dependencies.clock.now().valueOf() + 60_000).toISOString(), time_standard: "UTC" },
        version: { contract: "1.0.0", operation_schema: "1.0.0" },
        payload: { environment_lease: `lease:${request.operation_id}`, execution_plan_ref: `plan:${testCase.id}`, authorized_input_refs: [] },
      },
      () => {},
    );

    if (!startResult.ok) {
      return {
        test_case_id: testCase.id,
        purpose: testCase.purpose,
        variant,
        outcome: "not_executed",
        skip_reason: `${startResult.failure.code}: ${startResult.failure.message}`,
        evidence: [],
      };
    }

    return {
      test_case_id: testCase.id,
      purpose: testCase.purpose,
      variant,
      ...mapExecutionOutcome(startResult.value.outcome, startResult.value.skip_reason),
      evidence: startResult.value.evidence,
    };
  }
}

/**
 * `ExecutionOutcome` has more states than `QaRunTestCaseOutcome` — only
 * `passed`/`failed`/`cancelled` map straight across. Every other state
 * (`blocked`, `skipped`, `flaky`, `infrastructure_error`, `indeterminate`)
 * is infrastructure/process noise, not a real pass or fail verdict on the
 * test case's assertion, so it is reported as `not_executed` with the real
 * outcome preserved in `skip_reason` rather than rounded to a verdict the
 * execution engine never actually reached.
 */
function mapExecutionOutcome(
  outcome: string,
  engineSkipReason: string | undefined,
): Pick<QaRunTestCaseResult, "outcome" | "skip_reason"> {
  if (outcome === "passed" || outcome === "failed" || outcome === "cancelled") {
    return { outcome };
  }
  return {
    outcome: "not_executed",
    skip_reason: engineSkipReason ?? `execution engine reported outcome "${outcome}", not a pass/fail verdict`,
  };
}
