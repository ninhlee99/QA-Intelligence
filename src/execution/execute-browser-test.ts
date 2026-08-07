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
 * Scope note (docs/proposals/SPEC-512-mcp-test-execution-tool.md): the
 * underlying engine only navigates and asserts against the Semantic UI
 * tree (ADR-022 §4, ADR-003) — it does not type, click, or authenticate.
 * A flow requiring login is out of scope until a governed interaction
 * capability is accepted; this Skill SHALL NOT attempt to work around that
 * by reaching past the engine into raw Playwright.
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

/** Deep module: callers see one `run()` operation, not the engine's six-step lifecycle. */
export class ExecuteBrowserTest {
  readonly #dependencies: ExecuteBrowserTestDependencies;

  constructor(dependencies: ExecuteBrowserTestDependencies) {
    this.#dependencies = dependencies;
  }

  async run(request: ExecuteBrowserTestRequest): Promise<ExecuteBrowserTestResult> {
    const engine = this.#dependencies.engine;
    const version = { contract: "1.0.0", operation_schema: "1.0.0" } as const;
    const deadline = { at: request.deadline, time_standard: "UTC" } as const;
    const idempotency = (scope: string) => ({
      key: `${scope}:${request.execution.attempt_id}`,
      scope,
      request_digest: "",
    });

    const validated = await engine.validate({
      operation: "validate",
      operationId: `${request.operation_id}:validate`,
      attempt: request.execution,
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
          message: `Execution plan is not registered for attempt ${request.execution.attempt_id}: ${validated.value.incompatibility_reasons.join("; ")}`,
          retryable: false,
          evidence: [],
        },
      };
    }

    const prepared = await engine.prepare({
      operation: "prepare",
      operationId: `${request.operation_id}:prepare`,
      attempt: request.execution,
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
        operationId: `${request.operation_id}:start`,
        attempt: request.execution,
        workspace: request.workspace,
        idempotency: idempotency("start"),
        deadline,
        version,
        payload: {
          environment_lease: prepared.value.environment_lease,
          execution_plan_ref: request.test_case_ref,
          authorized_input_refs: [],
        },
      },
      () => {
        // SPEC-504 §4 event stream: this tracer bullet retains only the
        // terminal result (`ExecutionRecord`), not the per-attempt event
        // log — a fuller MCP tool would forward these as run evidence.
      },
    );

    await engine.finalize({
      operation: "finalize",
      operationId: `${request.operation_id}:finalize`,
      attempt: request.execution,
      workspace: request.workspace,
      idempotency: idempotency("finalize"),
      deadline,
      version,
      payload: { environment_lease: prepared.value.environment_lease, cleanup_policy_ref: "default" },
    });

    if (!started.ok) {
      return { ok: false, failure: engineFailure("engine", started.failure) };
    }

    const now = this.#dependencies.clock.now().toISOString();
    const record: ExecutionRecord = {
      id: `execution:${request.execution.execution_id}:${request.execution.attempt_id}`,
      workspace_id: request.workspace.workspace_id,
      actor_id: request.workspace.actor_id,
      test_case_ref: request.test_case_ref,
      automation_asset_ref: request.test_case_ref,
      engine_ref: this.#dependencies.provider_ref,
      environment_ref: request.environment_ref,
      state: "completed",
      outcome: started.value.outcome as ExecutionOutcome,
      evidence: started.value.evidence,
      timing: {
        started_at: started.value.timing.started_at,
        completed_at: started.value.timing.completed_at,
        duration_seconds: started.value.timing.duration_ms / 1000,
      },
      resource_usage: started.value.resource_usage,
    };
    void now;
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
