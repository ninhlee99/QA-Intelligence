/**
 * Tracer bullet Skill composing the accepted SPEC-504 `ExecutionEngine`
 * contract (`PlaywrightExecutionEngine`, ADR-022) into one governed
 * operation: descriptor -> validate -> prepare -> start -> finalize,
 * producing an `ExecutionRecord` (SPEC-210 §2/§4) instead of leaking the
 * engine's own request/result envelopes to a caller. Mirrors
 * `AssessRequirementQuality`'s shape (authorize implicitly through the
 * engine, run the governed operation, map to the domain result) so the
 * Runtime executor wiring in `runtime-executor.ts` can follow the same
 * pattern `RequirementReviewRuntimeExecutor` already established.
 *
 * Scope note: the engine navigates and asserts against the Semantic UI
 * tree (ADR-022 §4, ADR-003) and runs semantic interaction steps
 * (`type` / `click` / `select` / `wait_for`) plus Workspace-scoped
 * `secret_ref` resolution — never raw CSS/XPath selectors.
 */
import type {
  ExecutionEngine,
  ExecutionAttemptIdentity,
} from "../execution-engine/public.js";
import type { StableResult } from "../requirement-review/public.js";
import type { ExecutionOutcome, ExecutionRecord } from "./public.js";

export type ExecuteBrowserTestRequest = Readonly<{
  operation_id: string;
  workspace: import("../requirement-review/public.js").WorkspaceContext;
  execution: ExecutionAttemptIdentity;
  test_case_ref: string;
  environment_ref: string;
  deadline: string;
}>;

export type ExecuteBrowserTestFailure = Readonly<{
  class: "configuration" | "authorization" | "engine" | "infrastructure";
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ExecuteBrowserTestResult = StableResult<
  ExecutionRecord,
  ExecuteBrowserTestFailure
>;

export type ExecuteBrowserTestDependencies = Readonly<{
  engine: ExecutionEngine;
  clock: { now(): Date };
  provider_ref: string;
}>;

/**
 * SPEC-210 §4/§7: up to this many independent trials of the same case,
 * version, and environment are run before a `passed`/`failed` disagreement
 * is recorded as `flaky` rather than retried forever. Not budget-gated by
 * `AgentRunBudgets.max_retries` — that budgets Agent Run-level retries
 * across any executor, a distinct concept from a single Skill call's
 * internal flake-detection trials (see `run()`'s doc comment).
 */
export const MAX_FLAKE_TRIALS = 3;

type TrialOutcome = Readonly<{
  ok: true;
  attempt: ExecutionAttemptIdentity;
  outcome: ExecutionOutcome;
  evidence: readonly string[];
  timing: Readonly<{ started_at: string; completed_at: string; duration_seconds: number }>;
  resource_usage: import("../requirement-review/public.js").JsonObject;
  cleanup_status: "completed" | "partial" | "failed";
}> | Readonly<{
  ok: false;
  failure: ExecuteBrowserTestFailure;
}>;

/** Deep module: callers see one `run()` operation, not the engine's six-step lifecycle. */
export class ExecuteBrowserTest {
  readonly #dependencies: ExecuteBrowserTestDependencies;

  constructor(dependencies: ExecuteBrowserTestDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Runs up to `MAX_FLAKE_TRIALS` independent trials of `request` (each its
   * own validate->prepare->start->finalize sequence against a distinct
   * `attempt_id`, per SPEC-602 §4's "retries create distinct attempts under
   * one execution") and reconciles them into one `ExecutionRecord` —
   * `passed`/`failed` immediately on the first trial when trial 1 alone is
   * conclusive (a pass, or an infra/cancelled/blocked/skipped stop), else
   * `flaky` when trials disagree with no evidence of an infra fault (SPEC-210
   * §4). Callers whose seeded plans only cover the base `attempt_id` (never
   * needing a retry, e.g. an immediate pass) are unaffected — trial 2/3 keys
   * are only looked up when trial 1 actually fails.
   */
  async run(request: ExecuteBrowserTestRequest): Promise<ExecuteBrowserTestResult> {
    const trials: TrialOutcome[] = [];

    for (let trialNumber = 1; trialNumber <= MAX_FLAKE_TRIALS; trialNumber++) {
      const trialAttempt: ExecutionAttemptIdentity = {
        execution_id: request.execution.execution_id,
        attempt_id: trialNumber === 1 ? request.execution.attempt_id : `${request.execution.attempt_id}:trial-${trialNumber}`,
      };
      const trial = await this.#runOneTrial(request, trialAttempt);
      trials.push(trial);

      if (!trial.ok) {
        // Engine-level failure (validate/prepare/start/finalize) stops the
        // loop immediately — an infra fault is never retried into a flaky
        // verdict (SPEC-210 §4: "infrastructure errors ... SHALL NOT be
        // reported" as a product outcome), and a non-infra engine failure
        // (e.g. an unregistered plan) is a configuration problem a retry
        // cannot fix either.
        break;
      }
      if (trial.outcome === "passed" && trialNumber === 1) break; // immediate pass, no retry needed
      if (trial.outcome !== "passed" && trial.outcome !== "failed") break; // blocked/skipped/cancelled/infrastructure_error/indeterminate: not a flake signal, stop as-is.
      if (trialNumber === 2 && trial.outcome === (trials[0] as TrialOutcome & { ok: true }).outcome) break; // 2 consistent trials, done (no tie-break needed)
      if (trialNumber === MAX_FLAKE_TRIALS) break; // tie-break trial ran, reconcile whatever we have
    }

    return this.#reconcile(request, trials);
  }

  async #runOneTrial(request: ExecuteBrowserTestRequest, attempt: ExecutionAttemptIdentity): Promise<TrialOutcome> {
    const engine = this.#dependencies.engine;
    const version = { contract: "1.0.0", operation_schema: "1.0.0" } as const;
    const deadline = { at: request.deadline, time_standard: "UTC" } as const;
    const idempotency = (scope: string) => ({
      key: `${scope}:${attempt.attempt_id}`,
      scope,
      request_digest: "",
    });

    const validated = await engine.validate({
      operation: "validate",
      operationId: `${request.operation_id}:validate:${attempt.attempt_id}`,
      attempt,
      workspace: request.workspace,
      idempotency: idempotency("validate"),
      deadline,
      version,
      payload: {
        asset_ref: request.test_case_ref,
        test_version: { id: request.test_case_ref, version: "1.0.0" },
        environment_ref: request.environment_ref,
        data_refs: [],
        configuration: {},
        evidence_policy_ref: "default",
      },
    });
    if (!validated.ok) {
      return { ok: false, failure: engineFailure("engine", validated.failure) };
    }
    if (!validated.value.compatible) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          message: `Execution plan is not registered for attempt ${attempt.attempt_id}: ${validated.value.incompatibility_reasons.join("; ")}`,
          retryable: false,
          evidence: [],
        },
      };
    }

    const prepared = await engine.prepare({
      operation: "prepare",
      operationId: `${request.operation_id}:prepare:${attempt.attempt_id}`,
      attempt,
      workspace: request.workspace,
      idempotency: idempotency("prepare"),
      deadline,
      version,
      payload: {
        asset_ref: request.test_case_ref,
        environment_ref: request.environment_ref,
        data_refs: [],
        configuration: {},
        isolation_requirements: {},
      },
    });
    if (!prepared.ok) {
      return { ok: false, failure: engineFailure("infrastructure", prepared.failure) };
    }

    const started = await engine.start(
      {
        operation: "start",
        operationId: `${request.operation_id}:start:${attempt.attempt_id}`,
        attempt,
        workspace: request.workspace,
        idempotency: idempotency("start"),
        deadline,
        version,
        payload: {
          environment_lease: prepared.value.environment_lease,
          execution_plan_ref: attempt.attempt_id,
          authorized_input_refs: [],
        },
      },
      () => {
        // SPEC-504 §4 event stream: this tracer bullet retains only the
        // terminal result (`ExecutionRecord`), not the per-attempt event
        // log — a fuller MCP tool would forward these as run evidence.
      },
    );

    const finalized = await engine.finalize({
      operation: "finalize",
      operationId: `${request.operation_id}:finalize:${attempt.attempt_id}`,
      attempt,
      workspace: request.workspace,
      idempotency: idempotency("finalize"),
      deadline,
      version,
      payload: { environment_lease: prepared.value.environment_lease, cleanup_policy_ref: "default" },
    });

    if (!finalized.ok) {
      return { ok: false, failure: engineFailure("infrastructure", finalized.failure) };
    }

    if (!started.ok) {
      const failureClass = started.failure.responsible_domain === "infrastructure" ? "infrastructure" : "engine";
      return { ok: false, failure: engineFailure(failureClass, started.failure) };
    }

    return {
      ok: true,
      attempt,
      outcome: started.value.outcome,
      evidence: started.value.evidence,
      timing: {
        started_at: started.value.timing.started_at,
        completed_at: started.value.timing.completed_at,
        duration_seconds: started.value.timing.duration_ms / 1000,
      },
      resource_usage: started.value.resource_usage,
      cleanup_status: finalized.value.cleanup_status,
    };
  }

  #reconcile(request: ExecuteBrowserTestRequest, trials: readonly TrialOutcome[]): ExecuteBrowserTestResult {
    const last = trials[trials.length - 1]!;

    if (!last.ok) {
      // An engine-level failure on any trial (including retries) reports
      // that failure directly — a configuration/authorization failure
      // never becomes a `flaky` product verdict.
      return { ok: false, failure: last.failure };
    }

    const passFailTrials = trials.filter((t): t is TrialOutcome & { ok: true } => t.ok && (t.outcome === "passed" || t.outcome === "failed"));
    const passCount = passFailTrials.filter((t) => t.outcome === "passed").length;
    const failCount = passFailTrials.filter((t) => t.outcome === "failed").length;

    let outcome: ExecutionOutcome = last.outcome;
    if (passFailTrials.length > 1 && passCount > 0 && failCount > 0) {
      outcome = "flaky";
    }

    const first = trials[0]!;
    const retryOfRef = trials.length > 1 && first.ok
      ? `execution:${request.execution.execution_id}:${first.attempt.attempt_id}`
      : undefined;

    const evidence = trials.flatMap((t) => (t.ok ? t.evidence : []));

    const record: ExecutionRecord = {
      id: `execution:${request.execution.execution_id}:${last.attempt.attempt_id}`,
      workspace_id: request.workspace.workspace_id,
      actor_id: request.workspace.actor_id,
      test_case_ref: request.test_case_ref,
      automation_asset_ref: request.test_case_ref,
      engine_ref: this.#dependencies.provider_ref,
      environment_ref: request.environment_ref,
      state: "completed",
      outcome,
      evidence,
      timing: {
        started_at: last.timing.started_at,
        completed_at: last.timing.completed_at,
        duration_seconds: last.timing.duration_seconds,
      },
      resource_usage: { ...last.resource_usage, cleanup_status: last.cleanup_status },
      ...(retryOfRef !== undefined ? { retry_of_ref: retryOfRef } : {}),
    };
    return { ok: true, value: record };
  }
}

function engineFailure(
  failureClass: ExecuteBrowserTestFailure["class"],
  failure: { message: string; retryable: boolean; diagnostic_evidence_refs: readonly string[] },
): ExecuteBrowserTestFailure {
  return {
    class: failureClass,
    message: failure.message,
    retryable: failure.retryable,
    evidence: [...failure.diagnostic_evidence_refs],
  };
}
