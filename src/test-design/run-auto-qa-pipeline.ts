/**
 * Composes Discovery -> Test Design -> Execution -> Reporting behind one
 * `run()` call. Each inner Skill still runs its own authorization
 * independently; this module adds no authority of its own. A test case with
 * no generated assertion, an unbuildable execution plan, or a non-`passed`/
 * `failed` `ExecutionOutcome` is reported as `not_executed` with the real
 * reason preserved in `skip_reason` — never rounded up to a fabricated pass
 * or down to a fail (SPEC-207 §6, SPEC-210 §4).
 */
import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import { draftDefectsFromQaRun } from "../bug-analysis/draft-defects-from-qa-run.js";
import { assessUiAccessibilitySmoke, type AccessibilitySmokeReport } from "../discovery/assess-ui-accessibility-smoke.js";
import { ExecuteBrowserTest, MAX_FLAKE_TRIALS } from "../execution/execute-browser-test.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { SemanticUiDiscoveryResult } from "../discovery/public.js";
import { buildProfessionalQaAnalysis } from "../reporting/qa-professional-analysis.js";
import { summarizeQaRunTestCases, withProfessionalAnalysis, type QaRunReport, type QaRunTestCaseResult } from "../reporting/qa-run-report.js";
import { testCaseToExecutionPlan } from "./to-execution-plan.js";
import type { GenerateTestCasesResult, JsonObject, TestCase, TestCaseGeneratedAssertion } from "./public.js";

export interface Clock {
  now(): Date;
}

/** Accepted as a plain function (matching both Skills' `discover` signature) so either can be injected without depending on both concrete classes. */
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
  /** Report's `target_url` field only — actual navigation target is whatever `discover` (already bound to its own request) resolves. */
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
  /** Directory failure screenshots are written under (forwarded to `PlaywrightExecutionEngine`). Screenshot capture is skipped when omitted. */
  screenshotDir?: string;
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

    // Senior QA default: naming a11y smoke on the same discovery capture —
    // no second browser navigate. Full WCAG remains out of scope.
    const accessibilitySmoke: AccessibilitySmokeReport = assessUiAccessibilitySmoke({
      elements: discovered.value.elements,
      source_url: discovered.value.source_url,
    });

    const summary = summarizeQaRunTestCases(testCaseResults);
    const draftDefects = draftDefectsFromQaRun({
      workspace_id: request.workspace_id,
      requirement_ref: request.requirement_ref,
      target_url: request.url,
      environment_ref: `environment:${request.operation_id}`,
      test_cases: testCaseResults,
    });
    const analysis = buildProfessionalQaAnalysis({
      test_cases: testCaseResults,
      generation_findings: generated.value.findings,
      draft_defects: draftDefects,
      summary,
      accessibility_smoke: accessibilitySmoke,
    });
    const report = withProfessionalAnalysis(
      {
        schema_version: "1.1.0",
        workspace_id: request.workspace_id,
        target_url: request.url,
        generated_at: this.#dependencies.clock.now().toISOString(),
        requirement_ref: request.requirement_ref,
        discovery_capture_id: discovered.value.capture_id,
        discovery_element_count: discovered.value.elements.length,
        test_cases: testCaseResults,
        generation_findings: generated.value.findings,
        summary,
        draft_defects: draftDefects,
        accessibility_smoke: accessibilitySmoke,
      },
      analysis,
    );

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

    // Seed one plan entry per flake-detection trial `ExecuteBrowserTest`
    // will internally construct/look up (`${testCase.id}:trial-N`) — the
    // request itself still carries the base (unsuffixed) attempt_id,
    // exactly as `BrowserTestRuntimeExecutor` already does for
    // `execute_browser_test`, so the two callers' request-construction
    // stays symmetric (see ExecuteBrowserTest.run()'s own trial-suffixing).
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
      ...(this.#dependencies.screenshotDir !== undefined ? { screenshotDir: this.#dependencies.screenshotDir } : {}),
    });
    const skill = new ExecuteBrowserTest({
      engine,
      clock: this.#dependencies.clock,
      provider_ref: "playwright-execution-engine@0.1.0",
    });

    const run = await skill.run({
      operation_id: `${request.operation_id}:${testCase.id}`,
      workspace: request.context,
      execution: { execution_id: `${request.operation_id}:auto-qa`, attempt_id: testCase.id },
      test_case_ref: testCase.id,
      environment_ref: `environment:${request.operation_id}`,
      deadline: new Date(this.#dependencies.clock.now().valueOf() + 60_000).toISOString(),
    });

    if (!run.ok) {
      return {
        test_case_id: testCase.id,
        purpose: testCase.purpose,
        variant,
        outcome: "not_executed",
        skip_reason: `${run.failure.class}: ${run.failure.message}`,
        evidence: [],
      };
    }

    return {
      test_case_id: testCase.id,
      purpose: testCase.purpose,
      variant,
      ...mapExecutionOutcome(run.value.outcome ?? "indeterminate", run.value.skip_reason),
      evidence: run.value.evidence ?? [],
    };
  }
}

/** Non-`passed`/`failed`/`cancelled`/`flaky` outcomes are infrastructure noise, not a verdict — reported as `not_executed` with the real outcome kept in `skip_reason`. `infrastructure_error` is deliberately excluded: it is never a product-level verdict (SPEC-210 §4), unlike `flaky`, which IS real information about the test/product. */
function mapExecutionOutcome(
  outcome: string,
  engineSkipReason: string | undefined,
): Pick<QaRunTestCaseResult, "outcome" | "skip_reason"> {
  if (outcome === "passed" || outcome === "failed" || outcome === "cancelled" || outcome === "flaky") {
    return { outcome };
  }
  return {
    outcome: "not_executed",
    skip_reason: engineSkipReason ?? `execution engine reported outcome "${outcome}", not a pass/fail verdict`,
  };
}
