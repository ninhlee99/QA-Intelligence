import type {
  BlockExecutionRequest,
  CancelExecutionRequest,
  CompleteExecutionRequest,
  DispatchAttemptRequest,
  ExecutionAggregate,
  ExecutionAttempt,
  ExecutionFailureClass,
  ExecutionLifecycleState,
  ExecutionManager,
  ExecutionManagerFailureCode,
  ExecutionManagerResult,
  FailExecutionRequest,
  PlanExecutionRequest,
  QueueExecutionRequest,
  RecordProgressRequest,
  RetryEligibleAttemptRequest,
  TimeoutExecutionRequest,
} from "../../execution-manager/public.js";
import type { ExecutionEngine } from "../../execution-engine/public.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

type StoredExecution = Readonly<{ aggregate: ExecutionAggregate; revision: number }>;

const TERMINAL_STATES: ReadonlySet<ExecutionLifecycleState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
]);

/**
 * SPEC-602 §2's diagram: planned → queued → preparing → running →
 * collecting_evidence → completed | failed. The diagram's vertical
 * failure/cancellation/block/timeout branches sit under every non-terminal
 * stage, not only the later ones — a dependency failure or cancellation can
 * arrive at any point before completion, so `failed`/`cancelled`/`blocked`/
 * `timed_out` are reachable from every non-terminal state.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ExecutionLifecycleState, readonly ExecutionLifecycleState[]>> = {
  planned: ["queued", "failed", "cancelled", "blocked", "timed_out"],
  queued: ["preparing", "failed", "cancelled", "blocked", "timed_out"],
  preparing: ["running", "failed", "cancelled", "blocked", "timed_out"],
  running: ["collecting_evidence", "failed", "cancelled", "blocked", "timed_out"],
  collecting_evidence: ["completed", "failed", "cancelled", "blocked", "timed_out"],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  blocked: [],
};

const RETRY_INELIGIBLE_CLASSES: ReadonlySet<ExecutionFailureClass> = new Set(["domain", "cancellation"]);

/**
 * SPEC-404's required reference adapter: an in-process, deterministic
 * `ExecutionManager` proving the SPEC-602 §2 state machine, idempotent
 * commands, attempt visibility, and infrastructure-vs-domain retry
 * classification — composed entirely from the existing `ExecutionEngine`
 * (SPEC-504) contract rather than implementing a provider engine itself
 * (§2: "it does not implement provider engines"). Durable persistence is
 * separate, larger scope, not attempted here.
 */
export class InMemoryExecutionManager implements ExecutionManager {
  readonly #clock: Clock;
  readonly #engine: ExecutionEngine;
  readonly #executions = new Map<string, StoredExecution>();
  readonly #dispatchIdempotency = new Map<string, ExecutionAggregate>();
  readonly #planIdempotency = new Map<string, ExecutionAggregate>();

  constructor(clock: Clock, engine: ExecutionEngine) {
    this.#clock = clock;
    this.#engine = engine;
  }

  async plan(request: PlanExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const existingByKey = this.#planIdempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    if (this.#executions.has(request.execution_id)) {
      return failure("conflict", `Execution "${request.execution_id}" already exists.`, false);
    }

    const aggregate: ExecutionAggregate = {
      execution_id: request.execution_id,
      workspace_id: request.context.workspace_id,
      asset_ref: request.asset_ref,
      environment_ref: request.environment_ref,
      revision: 1,
      attempts: [{ ...plannedAttempt() }],
      current_attempt_id: null,
    };
    this.#executions.set(request.execution_id, { aggregate, revision: 1 });
    this.#planIdempotency.set(request.idempotency_key, aggregate);
    return { ok: true, value: aggregate };
  }

  async queue(request: QueueExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    return this.#transitionAggregate(found.value, request.expected_revision, "queued");
  }

  async dispatchAttempt(request: DispatchAttemptRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const existingByKey = this.#dispatchIdempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    const { aggregate, revision } = found.value;

    if (TERMINAL_STATES.has(currentState(aggregate))) {
      // SPEC-602 §3: late/duplicate transitions on an already-terminal
      // execution are idempotently ignored, not an error.
      return { ok: true, value: aggregate };
    }
    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    if (!ALLOWED_TRANSITIONS[currentState(aggregate)].includes("preparing")) {
      return failure("unsupported_transition", `Cannot dispatch an attempt from state "${currentState(aggregate)}".`, false);
    }

    const attempt: ExecutionAttemptIdentityLike = { execution_id: request.execution_id, attempt_id: request.attempt_id };
    const envelopeBase = {
      operationId: request.attempt_id,
      attempt,
      workspace: request.context,
      idempotency: { key: request.idempotency_key, scope: "execution-manager:dispatch", request_digest: "" },
      deadline: { at: new Date(this.#clock.now().valueOf() + 60 * 60 * 1000).toISOString(), time_standard: "UTC" as const },
      version: { contract: "1.0.0" as const, operation_schema: "1.0.0" as const },
    };

    const validated = await this.#engine.validate({
      ...envelopeBase,
      operation: "validate",
      payload: {
        asset_ref: aggregate.asset_ref,
        test_version: request.test_version,
        environment_ref: aggregate.environment_ref,
        data_refs: request.data_refs,
        configuration: request.configuration,
        evidence_policy_ref: request.evidence_policy_ref,
      },
    });
    if (!validated.ok) return this.#engineFailure(aggregate, revision);

    const prepared = await this.#engine.prepare({
      ...envelopeBase,
      operation: "prepare",
      payload: {
        asset_ref: aggregate.asset_ref,
        environment_ref: aggregate.environment_ref,
        data_refs: request.data_refs,
        configuration: request.configuration,
        isolation_requirements: request.isolation_requirements,
      },
    });
    if (!prepared.ok) return this.#engineFailure(aggregate, revision);

    const started = await this.#engine.start(
      {
        ...envelopeBase,
        operation: "start",
        payload: {
          environment_lease: prepared.value.environment_lease,
          execution_plan_ref: request.execution_plan_ref,
          authorized_input_refs: request.authorized_input_refs,
        },
      },
      () => {
        // Progress/evidence events stream through recordProgress() in this
        // reference adapter rather than a live sink — SPEC-404 §2's
        // "dispatch and callback correlation" is proven by the ordered
        // validate→prepare→start sequence itself, not an event bus.
      },
    );
    const nowIso = this.#clock.now().toISOString();
    const newAttempt: ExecutionAttempt = started.ok
      ? {
          attempt_id: request.attempt_id,
          state: "collecting_evidence",
          engine_ref: request.test_version,
          environment_lease: prepared.value.environment_lease,
          started_at: started.value.timing.started_at,
          completed_at: nowIso,
          outcome: started.value.outcome,
          evidence: started.value.evidence,
          failure_class: null,
        }
      : {
          attempt_id: request.attempt_id,
          state: "failed",
          engine_ref: request.test_version,
          environment_lease: prepared.value.environment_lease,
          started_at: nowIso,
          completed_at: nowIso,
          outcome: null,
          evidence: [],
          failure_class: classifyEngineFailure(started.failure.responsible_domain),
        };

    const updated: ExecutionAggregate = {
      ...aggregate,
      revision: revision + 1,
      attempts: [...aggregate.attempts.slice(0, -1), newAttempt],
      current_attempt_id: request.attempt_id,
    };
    this.#executions.set(request.execution_id, { aggregate: updated, revision: revision + 1 });
    this.#dispatchIdempotency.set(request.idempotency_key, updated);
    return { ok: true, value: updated };
  }

  async recordProgress(request: RecordProgressRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    const { aggregate, revision } = found.value;

    if (TERMINAL_STATES.has(currentState(aggregate))) {
      // SPEC-602 §3: a late callback after termination is ignored, not an error.
      return { ok: true, value: aggregate };
    }
    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;

    const attempts = aggregate.attempts.slice();
    const lastIndex = attempts.length - 1;
    const last = attempts[lastIndex];
    if (last === undefined) return failure("unknown_execution", "No attempt to record progress against.", false);
    attempts[lastIndex] = { ...last, evidence: [...last.evidence, ...request.evidence_refs] };
    const updated: ExecutionAggregate = { ...aggregate, revision: revision + 1, attempts };
    this.#executions.set(request.execution_id, { aggregate: updated, revision: revision + 1 });
    return { ok: true, value: updated };
  }

  async complete(request: CompleteExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    return this.#transitionAggregate(found.value, request.expected_revision, "completed", (attempt) => ({
      ...attempt,
      state: "completed",
      outcome: request.outcome,
      completed_at: this.#clock.now().toISOString(),
    }));
  }

  async fail(request: FailExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    return this.#transitionAggregate(found.value, request.expected_revision, "failed", (attempt) => ({
      ...attempt,
      state: "failed",
      failure_class: request.failure_class,
      completed_at: this.#clock.now().toISOString(),
    }));
  }

  async block(request: BlockExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    return this.#transitionAggregate(found.value, request.expected_revision, "blocked", (attempt) => ({
      ...attempt,
      state: "blocked",
      completed_at: this.#clock.now().toISOString(),
    }));
  }

  async cancel(request: CancelExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    const { aggregate } = found.value;
    if (TERMINAL_STATES.has(currentState(aggregate))) {
      // Already-terminal cancel is a no-op, mirroring DeterministicWorkflowEngine's cancel semantics.
      return { ok: true, value: aggregate };
    }
    return this.#transitionAggregate(found.value, request.expected_revision, "cancelled", (attempt) => ({
      ...attempt,
      state: "cancelled",
      failure_class: "cancellation",
      completed_at: this.#clock.now().toISOString(),
    }));
  }

  async timeout(request: TimeoutExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    return this.#transitionAggregate(found.value, request.expected_revision, "timed_out", (attempt) => ({
      ...attempt,
      state: "timed_out",
      failure_class: "timeout",
      completed_at: this.#clock.now().toISOString(),
    }));
  }

  async retryEligibleAttempt(request: RetryEligibleAttemptRequest): Promise<ExecutionManagerResult<boolean>> {
    const found = this.#requireOwned(request.execution_id, request.context);
    if (!found.ok) return found;
    const { aggregate } = found.value;

    const attempt = aggregate.attempts.find((candidate) => candidate.attempt_id === request.attempt_id);
    if (attempt === undefined) return failure("unknown_execution", `No attempt "${request.attempt_id}" on this execution.`, false);
    if (aggregate.attempts.length >= request.max_attempts) return { ok: true, value: false };
    if (attempt.failure_class === null) return { ok: true, value: false };
    return { ok: true, value: !RETRY_INELIGIBLE_CLASSES.has(attempt.failure_class) };
  }

  async getExecution(context: WorkspaceContext, executionId: string): Promise<ExecutionManagerResult<ExecutionAggregate>> {
    const found = this.#requireOwned(executionId, context);
    if (!found.ok) return found;
    return { ok: true, value: found.value.aggregate };
  }

  async listAttempts(context: WorkspaceContext, executionId: string): Promise<ExecutionManagerResult<readonly ExecutionAttempt[]>> {
    const found = this.#requireOwned(executionId, context);
    if (!found.ok) return found;
    return { ok: true, value: found.value.aggregate.attempts };
  }

  #requireOwned(executionId: string, context: WorkspaceContext): ExecutionManagerResult<StoredExecution> {
    const stored = this.#executions.get(executionId);
    if (stored === undefined || stored.aggregate.workspace_id !== context.workspace_id) {
      return failure("unknown_execution", `Execution "${executionId}" not found.`, false);
    }
    return { ok: true, value: stored };
  }

  #checkRevision(actual: number, expected: number): ExecutionManagerResult<true> {
    if (actual !== expected) {
      return failure("conflict", `Expected revision ${expected} but found ${actual}.`, false);
    }
    return { ok: true, value: true };
  }

  #transitionAggregate(
    stored: StoredExecution,
    expectedRevision: number,
    toState: ExecutionLifecycleState,
    updateAttempt?: (attempt: ExecutionAttempt) => ExecutionAttempt,
  ): ExecutionManagerResult<ExecutionAggregate> {
    const { aggregate, revision } = stored;
    if (TERMINAL_STATES.has(currentState(aggregate))) {
      // One terminal state is final (SPEC-404 §4) — a further transition
      // attempt returns the existing terminal state rather than erroring.
      return { ok: true, value: aggregate };
    }
    const concurrency = this.#checkRevision(revision, expectedRevision);
    if (!concurrency.ok) return concurrency;
    if (!ALLOWED_TRANSITIONS[currentState(aggregate)].includes(toState)) {
      return failure("unsupported_transition", `Cannot transition Execution from "${currentState(aggregate)}" to "${toState}".`, false);
    }

    const attempts = aggregate.attempts.slice();
    const lastIndex = attempts.length - 1;
    const last = attempts[lastIndex];
    if (last !== undefined) {
      attempts[lastIndex] = updateAttempt !== undefined ? updateAttempt(last) : { ...last, state: toState };
    }
    const updated: ExecutionAggregate = { ...aggregate, revision: revision + 1, attempts };
    this.#executions.set(aggregate.execution_id, { aggregate: updated, revision: revision + 1 });
    return { ok: true, value: updated };
  }

  #engineFailure(aggregate: ExecutionAggregate, revision: number): ExecutionManagerResult<ExecutionAggregate> {
    const attempts = aggregate.attempts.slice();
    const lastIndex = attempts.length - 1;
    const last = attempts[lastIndex];
    if (last !== undefined) {
      attempts[lastIndex] = { ...last, state: "failed", failure_class: "infrastructure", completed_at: this.#clock.now().toISOString() };
    }
    const updated: ExecutionAggregate = { ...aggregate, revision: revision + 1, attempts };
    this.#executions.set(aggregate.execution_id, { aggregate: updated, revision: revision + 1 });
    return failure("engine_unavailable", "The Execution Engine could not validate, prepare, or start this attempt.", true);
  }
}

type ExecutionAttemptIdentityLike = Readonly<{ execution_id: string; attempt_id: string }>;

function currentState(aggregate: ExecutionAggregate): ExecutionLifecycleState {
  const last = aggregate.attempts[aggregate.attempts.length - 1];
  return last?.state ?? "planned";
}

function plannedAttempt(): ExecutionAttempt {
  return {
    attempt_id: "attempt-0",
    state: "planned",
    engine_ref: null,
    environment_lease: null,
    started_at: null,
    completed_at: null,
    outcome: null,
    evidence: [],
    failure_class: null,
  };
}

function classifyEngineFailure(responsibleDomain: string): ExecutionFailureClass {
  return responsibleDomain === "caller" || responsibleDomain === "workspace" || responsibleDomain === "policy"
    ? "domain"
    : "infrastructure";
}

function failure<Value>(code: ExecutionManagerFailureCode, message: string, retryable: boolean): ExecutionManagerResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
