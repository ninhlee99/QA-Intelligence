import {
  executionRequestDigest,
  type CancelRequest,
  type DescriptorRequest,
  type ExecutionAttemptIdentity,
  type ExecutionEngine,
  type ExecutionEngineEvent,
  type ExecutionEngineEventSink,
  type ExecutionEngineEventType,
  type ExecutionEngineFailure,
  type ExecutionEngineOperation,
  type ExecutionEngineOperationMap,
  type ExecutionEngineProvider,
  type ExecutionEngineRequest,
  type ExecutionEngineResult,
  type ExecutionOutcome,
  type FinalizeRequest,
  type PrepareRequest,
  type StartRequest,
  type ValidateRequest,
} from "../../execution-engine/public.js";
import type {
  JsonObject,
  WorkspaceAuthorizationFailure,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

/**
 * One scripted attempt's scenario: whether `validate`/`prepare` succeed, the
 * ordered event sequence `start` emits, and the terminal outcome. Keyed by
 * `attempt_id` (SPEC-602 §4: retries create distinct attempts) rather than
 * by exact-request matching — a deterministic simulator's scenarios are
 * "what does attempt X do", not "what does this literal request object do".
 */
export type ScriptedExecutionScenario = Readonly<{
  compatible?: boolean;
  incompatibility_reasons?: readonly string[];
  event_types: readonly ExecutionEngineEventType[];
  outcome: ExecutionOutcome;
  skip_reason?: string;
  evidence?: readonly string[];
  assertion_results?: readonly JsonObject[];
  /** Simulates a worker that never emits `started`/`completed` before the caller cancels — SPEC-602 §5 cooperative cancellation. */
  hangs_after_events?: number;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: ExecutionEngineProvider;
  scenarios: ReadonlyMap<string, ScriptedExecutionScenario>;
}>;

type AttemptRecord = Readonly<{
  digest: string;
  events: readonly ExecutionEngineEvent[];
  result: ExecutionEngineResult<"start">;
}>;

const PERMISSION_BY_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  descriptor: "execution:read",
  validate: "execution:read",
  prepare: "execution:execute",
  start: "execution:execute",
  cancel: "execution:cancel",
  finalize: "execution:cleanup",
});

/**
 * SPEC-504 §7's required "deterministic simulator/replay engine": proves
 * lifecycle, idempotency, cancellation, event ordering, and cleanup
 * semantics without a real execution technology (SPEC-407's Playwright
 * adapter is separate, larger scope — ADR-009 §4.3/§4.9 requires this
 * interface stay stable when that adapter is added, not the other way
 * around). Never throws for a domain-level failure — a normal
 * `ExecutionEngineResult` with `ok:false`, matching every other adapter
 * seam in this repository (ADR-016 §4's pattern, restated here for a
 * different seam).
 */
export class DeterministicExecutionEngine implements ExecutionEngine {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: ExecutionEngineProvider;
  readonly #scenarios: ReadonlyMap<string, ScriptedExecutionScenario>;
  readonly #attempts = new Map<string, AttemptRecord>();
  readonly #cancelled = new Set<string>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = dependencies.provider;
    this.#scenarios = dependencies.scenarios;
  }

  async descriptor(request: DescriptorRequest): Promise<ExecutionEngineResult<"descriptor">> {
    const authorized = await this.#authorize(request, "descriptor");
    if (!authorized.ok) return this.#deny(request, "descriptor", authorized.failure);
    return this.#envelope(request, "descriptor", {
      ok: true,
      value: {
        supported_contract_versions: ["1.0.0"],
        supported_operations: ["descriptor", "validate", "prepare", "start", "cancel", "finalize"],
        capabilities: ["deterministic_replay"],
        deterministic: true,
        evidence_guarantees: ["scripted"],
        cancellation_guarantee: "cooperative_bounded",
        cleanup_guarantee: "best_effort",
        health: "healthy",
        capacity: {},
      },
    });
  }

  async validate(request: ValidateRequest): Promise<ExecutionEngineResult<"validate">> {
    const authorized = await this.#authorize(request, "validate");
    if (!authorized.ok) return this.#deny(request, "validate", authorized.failure);

    const scenario = this.#scenarios.get(request.attempt.attempt_id);
    if (scenario === undefined) {
      return this.#envelope(request, "validate", {
        ok: false,
        failure: unscriptedFailure(request.attempt),
      });
    }
    return this.#envelope(request, "validate", {
      ok: true,
      value: {
        compatible: scenario.compatible ?? true,
        resolved_versions: { asset: request.payload.test_version.id },
        incompatibility_reasons: scenario.incompatibility_reasons ?? [],
      },
    });
  }

  async prepare(request: PrepareRequest): Promise<ExecutionEngineResult<"prepare">> {
    const authorized = await this.#authorize(request, "prepare");
    if (!authorized.ok) return this.#deny(request, "prepare", authorized.failure);

    const scenario = this.#scenarios.get(request.attempt.attempt_id);
    if (scenario === undefined) {
      return this.#envelope(request, "prepare", { ok: false, failure: unscriptedFailure(request.attempt) });
    }
    const now = this.#clock.now();
    return this.#envelope(request, "prepare", {
      ok: true,
      value: {
        environment_lease: `lease:${request.attempt.execution_id}:${request.attempt.attempt_id}`,
        resolved_versions: { environment: request.payload.environment_ref },
        expires_at: new Date(now.valueOf() + 60 * 60 * 1000).toISOString(),
        cleanup_required: true,
      },
    });
  }

  async start(
    request: StartRequest,
    onEvent: ExecutionEngineEventSink,
  ): Promise<ExecutionEngineResult<"start">> {
    const authorized = await this.#authorize(request, "start");
    if (!authorized.ok) return this.#deny(request, "start", authorized.failure);

    const attemptKey = attemptStateKey(request.attempt);
    const digest = executionRequestDigest(request);
    const existing = this.#attempts.get(attemptKey);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        return this.#envelope(request, "start", {
          ok: false,
          failure: {
            code: "idempotency_conflict",
            retryable: false,
            responsible_domain: "caller",
            message: "A different start request was already retained for this attempt.",
            details: {},
            diagnostic_evidence_refs: [],
          },
        });
      }
      // SPEC-504 §7 idempotent start: replay retained events, do not re-run.
      for (const event of existing.events) onEvent(event);
      return existing.result;
    }

    const scenario = this.#scenarios.get(request.attempt.attempt_id);
    if (scenario === undefined) {
      const result = this.#envelope(request, "start", { ok: false, failure: unscriptedFailure(request.attempt) });
      this.#attempts.set(attemptKey, { digest, events: [], result });
      return result;
    }

    const emitted: ExecutionEngineEvent[] = [];
    let sequence = 0;
    const emit = (type: ExecutionEngineEventType, data: JsonObject = {}): void => {
      const event: ExecutionEngineEvent = {
        type,
        attempt: request.attempt,
        sequence: sequence++,
        occurred_at: this.#clock.now().toISOString(),
        data,
      };
      emitted.push(event);
      onEvent(event);
    };

    const eventTypes = scenario.event_types;
    const hangAfter = scenario.hangs_after_events;
    for (let index = 0; index < eventTypes.length; index += 1) {
      if (hangAfter !== undefined && index >= hangAfter) break;
      if (this.#cancelled.has(attemptKey)) break;
      emit(eventTypes[index] as ExecutionEngineEventType);
    }

    const now = this.#clock.now();
    let result: ExecutionEngineResult<"start">;
    if (this.#cancelled.has(attemptKey)) {
      emit("cancelled");
      result = this.#envelope(request, "start", {
        ok: true,
        value: {
          outcome: "cancelled",
          evidence: scenario.evidence ?? [],
          assertion_results: [],
          resource_usage: {},
          timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
        },
      });
    } else {
      result = this.#envelope(request, "start", {
        ok: true,
        value: {
          outcome: scenario.outcome,
          ...(scenario.skip_reason !== undefined ? { skip_reason: scenario.skip_reason } : {}),
          evidence: scenario.evidence ?? [],
          assertion_results: scenario.assertion_results ?? [],
          resource_usage: {},
          timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
        },
      });
    }

    this.#attempts.set(attemptKey, { digest, events: emitted, result });
    return result;
  }

  async cancel(request: CancelRequest): Promise<ExecutionEngineResult<"cancel">> {
    const authorized = await this.#authorize(request, "cancel");
    if (!authorized.ok) return this.#deny(request, "cancel", authorized.failure);

    const attemptKey = attemptStateKey(request.attempt);
    const existing = this.#attempts.get(attemptKey);
    // SPEC-602 §5: late provider completion SHALL not replace the terminal
    // platform outcome — an already-terminal attempt is not re-cancelled.
    if (existing !== undefined && existing.result.ok && existing.result.value.outcome !== "cancelled") {
      return this.#envelope(request, "cancel", { ok: true, value: { accepted: false, already_terminal: true } });
    }
    this.#cancelled.add(attemptKey);
    return this.#envelope(request, "cancel", { ok: true, value: { accepted: true, already_terminal: false } });
  }

  async finalize(request: FinalizeRequest): Promise<ExecutionEngineResult<"finalize">> {
    const authorized = await this.#authorize(request, "finalize");
    if (!authorized.ok) return this.#deny(request, "finalize", authorized.failure);

    return this.#envelope(request, "finalize", {
      ok: true,
      value: { cleanup_status: "completed", residual_resources: [] },
    });
  }

  async #authorize(
    request: Readonly<{ workspace: WorkspaceContext; operationId: string }>,
    operation: string,
  ): Promise<WorkspaceAuthorizationResult> {
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operationId,
      context: request.workspace,
      purpose: `execution-engine:${operation}`,
      consequence_class: "reversible",
      required_permissions: [PERMISSION_BY_OPERATION[operation] ?? "execution:execute"],
      resource_refs: [`workspace:${request.workspace.workspace_id}`],
    };
    return this.#authorizer.authorize(authorizationRequest);
  }

  #envelope<Operation extends ExecutionEngineOperation>(
    request: ExecutionEngineRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: ExecutionEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: ExecutionEngineFailure }>,
  ): ExecutionEngineResult<Operation> {
    const now = this.#clock.now();
    const envelope = {
      operation,
      operationId: request.operationId,
      attempt: request.attempt,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
      warnings: [],
      evidence: outcome.ok && "evidence" in outcome.value ? (outcome.value as { evidence?: readonly string[] }).evidence ?? [] : [],
    };
    return { ...envelope, ...outcome } as ExecutionEngineResult<Operation>;
  }

  #deny<Operation extends ExecutionEngineOperation>(
    request: ExecutionEngineRequest<Operation>,
    operation: Operation,
    authorizationFailure: WorkspaceAuthorizationFailure,
  ): ExecutionEngineResult<Operation> {
    return this.#envelope(request, operation, {
      ok: false,
      failure: {
        code: "workspace_denied",
        retryable: false,
        responsible_domain: "workspace",
        message: authorizationFailure.message,
        details: {},
        diagnostic_evidence_refs: [],
      },
    });
  }
}

function attemptStateKey(attempt: ExecutionAttemptIdentity): string {
  return `${attempt.execution_id}:${attempt.attempt_id}`;
}

function unscriptedFailure(attempt: ExecutionAttemptIdentity): ExecutionEngineFailure {
  return {
    code: "invalid_request",
    retryable: false,
    responsible_domain: "caller",
    message: `No scripted scenario for attempt ${attempt.attempt_id}.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}
