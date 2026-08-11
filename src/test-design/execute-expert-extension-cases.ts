/**
 * Execute a capped subset of Expert extension cases (API smoke + journey
 * browser) in the same run_auto_qa / run_expert_qa pass — so "registered"
 * is not silently treated as "tested".
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import type { ExecuteApiSmoke } from "../api-testing/execute-api-smoke.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { ExecuteBrowserTest, MAX_FLAKE_TRIALS } from "../execution/execute-browser-test.js";
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { QaRunTestCaseResult } from "../reporting/qa-run-report.js";
import { testCaseToExecutionPlan } from "./to-execution-plan.js";
import type { RegressionCase } from "./regression-suite-registry.js";

export type ExpertExtensionExecutionDeps = Readonly<{
  clock: { now(): Date };
  authorizer: WorkspaceAuthorizer;
  apiSmoke?: ExecuteApiSmoke;
  credentials?: WorkspaceCredentialRegistry;
  launchBrowser?: () => Promise<import("playwright").Browser>;
}>;

export type ExpertExtensionExecutionInput = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  /** HTTP origin for API smoke (may differ from UI url). */
  api_base_url: string;
  deadline: string;
  run_id: string;
  /** Only hook extras — never re-run primary AC browser cases. */
  cases: readonly RegressionCase[];
  max_api?: number;
  max_browser?: number;
  enabled?: boolean;
}>;

export type ExpertExtensionExecutionResult = Readonly<{
  skipped: boolean;
  reason?: string;
  api_ran: boolean;
  journey_ran: boolean;
  api_attempted: number;
  journey_attempted: number;
  results: readonly QaRunTestCaseResult[];
  failed_count: number;
  flaky_count: number;
}>;

export async function executeExpertExtensionCases(
  deps: ExpertExtensionExecutionDeps,
  input: ExpertExtensionExecutionInput,
): Promise<ExpertExtensionExecutionResult> {
  if (input.enabled === false) {
    return emptySkipped("execute_extension_cases=false");
  }

  const maxApi = Math.min(Math.max(input.max_api ?? 5, 0), 10);
  const maxBrowser = Math.min(Math.max(input.max_browser ?? 3, 0), 8);
  // Prefer authz negatives / wrong-role before happy-path API — Senior Expert order.
  const apiCases = [...input.cases.filter((c) => c.kind === "api")]
    .sort((a, b) => {
      if (a.kind !== "api" || b.kind !== "api") return 0;
      return apiPriority(a.case) - apiPriority(b.case);
    })
    .slice(0, maxApi);
  const journeyCases = input.cases
    .filter(
      (c) =>
        c.kind === "browser" &&
        (c.test_case.id.startsWith("journey-") || c.test_case.tags?.includes("journey")),
    )
    .slice(0, maxBrowser);

  if (apiCases.length === 0 && journeyCases.length === 0) {
    return emptySkipped("no_extension_cases");
  }

  const results: QaRunTestCaseResult[] = [];

  for (const item of apiCases) {
    if (item.kind !== "api") continue;
    if (deps.apiSmoke === undefined) {
      results.push({
        test_case_id: item.case.id,
        purpose: `API smoke ${item.case.method} ${item.case.path}`,
        variant: "api_smoke",
        outcome: "not_executed",
        skip_reason: "apiSmoke skill not configured on executor",
        evidence: ["api-smoke:not-configured"],
      });
      continue;
    }
    const run = await deps.apiSmoke.run({
      operation_id: `${input.operation_id}:ext-api:${item.case.id}`,
      workspace_id: input.workspace_id,
      context: input.context,
      base_url: input.api_base_url,
      cases: [item.case],
    });
    if (!run.ok) {
      results.push({
        test_case_id: item.case.id,
        purpose: `API smoke ${item.case.method} ${item.case.path}`,
        variant: "api_smoke",
        outcome: "not_executed",
        skip_reason: run.failure.message,
        evidence: [...run.failure.evidence],
      });
      continue;
    }
    const caseResult = run.value.cases[0];
    const raw = String(caseResult?.outcome ?? run.value.outcome);
    const outcome = mapOutcome(raw);
    results.push({
      test_case_id: item.case.id,
      purpose: `API smoke ${item.case.method} ${item.case.path}`,
      variant: "api_smoke",
      outcome,
      ...(outcome === "not_executed"
        ? { skip_reason: caseResult?.message ?? raw }
        : {}),
      evidence: [
        `api-outcome:${raw}`,
        ...(caseResult?.message ? [`api-msg:${caseResult.message}`] : []),
        ...(caseResult?.evidence ?? []),
      ],
    });
  }

  for (const item of journeyCases) {
    if (item.kind !== "browser") continue;
    const converted = testCaseToExecutionPlan(item.test_case, [item.generated_assertion]);
    if (!converted.ok) {
      results.push({
        test_case_id: item.test_case.id,
        purpose: item.test_case.purpose,
        variant: "journey",
        outcome: "not_executed",
        skip_reason: converted.failure.message,
        evidence: [],
      });
      continue;
    }
    const screenshotDir = join(process.cwd(), ".qa-screenshots", input.operation_id, item.test_case.id);
    const traceDir = join(process.cwd(), ".qa-traces", input.operation_id, item.test_case.id);
    await mkdir(screenshotDir, { recursive: true }).catch(() => undefined);
    await mkdir(traceDir, { recursive: true }).catch(() => undefined);
    const plans = new Map<string, PlaywrightExecutionPlan>(
      Array.from({ length: MAX_FLAKE_TRIALS }, (_, i) => {
        const key = i === 0 ? item.test_case.id : `${item.test_case.id}:trial-${i + 1}`;
        return [key, converted.value] as const;
      }),
    );
    const engine = new PlaywrightExecutionEngine({
      clock: deps.clock,
      authorizer: deps.authorizer,
      provider: { id: "playwright-execution-engine", version: "0.1.0" },
      plans,
      ...(deps.credentials !== undefined ? { secrets: deps.credentials } : {}),
      ...(deps.launchBrowser !== undefined ? { launchBrowser: deps.launchBrowser } : {}),
      screenshotDir,
      traceDir,
    });
    const skill = new ExecuteBrowserTest({
      engine,
      clock: deps.clock,
      provider_ref: "playwright-execution-engine@0.1.0",
    });
    const executed = await skill.run({
      operation_id: `${input.operation_id}:ext-browser:${item.test_case.id}`,
      workspace: input.context,
      execution: { execution_id: input.run_id, attempt_id: item.test_case.id },
      test_case_ref: item.test_case.id,
      environment_ref: `environment:${input.operation_id}`,
      deadline: input.deadline,
    });
    if (!executed.ok) {
      results.push({
        test_case_id: item.test_case.id,
        purpose: item.test_case.purpose,
        variant: "journey",
        outcome: "not_executed",
        skip_reason: executed.failure.message,
        evidence: [...executed.failure.evidence],
      });
      continue;
    }
    const mapped = mapOutcome(executed.value.outcome ?? "indeterminate");
    results.push({
      test_case_id: item.test_case.id,
      purpose: item.test_case.purpose,
      variant: "journey",
      outcome: mapped,
      ...(mapped === "not_executed"
        ? { skip_reason: `non-verdict outcome:${executed.value.outcome}` }
        : {}),
      evidence: [...(executed.value.evidence ?? [])],
    });
  }

  return {
    skipped: false,
    api_ran: apiCases.length > 0 && results.some((r) => r.variant === "api_smoke" && r.outcome !== "not_executed"),
    journey_ran:
      journeyCases.length > 0 && results.some((r) => r.variant === "journey" && r.outcome !== "not_executed"),
    api_attempted: apiCases.length,
    journey_attempted: journeyCases.length,
    results,
    failed_count: results.filter((r) => r.outcome === "failed").length,
    flaky_count: results.filter((r) => r.outcome === "flaky").length,
  };
}

function emptySkipped(reason: string): ExpertExtensionExecutionResult {
  return {
    skipped: true,
    reason,
    api_ran: false,
    journey_ran: false,
    api_attempted: 0,
    journey_attempted: 0,
    results: [],
    failed_count: 0,
    flaky_count: 0,
  };
}

function mapOutcome(raw: string): QaRunTestCaseResult["outcome"] {
  if (raw === "passed" || raw === "failed" || raw === "flaky" || raw === "cancelled") return raw;
  return "not_executed";
}

function apiPriority(smokeCase: Readonly<{ id: string; auth?: string }>): number {
  if (smokeCase.auth === "none" || smokeCase.id.includes("-unauth")) return 0;
  if (smokeCase.auth === "alternate_bearer" || smokeCase.id.includes("-wrong-role")) return 1;
  return 2;
}
