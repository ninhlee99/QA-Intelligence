import type {
  AgentRunApproval,
  AgentRunAccessRequest,
  AgentRunCancellation,
  AgentRunEvent,
  AgentRunEventCursor,
  AgentRunEventPage,
  AgentRunExecution,
  AgentRunFailure,
  AgentRunFailureClass,
  AgentRunReference,
  AgentRunResult,
  AgentRunResume,
  AgentRunSnapshot,
  AgentRunStartRequest,
  AgentRunState,
  AgentRunTransition,
  AgentRuntime,
  AgentRuntimeResult,
} from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorResult,
  AgentRunExecutorValue,
} from "./executor.js";
import type {
  ConsequenceClass,
  JsonObject,
  WorkspaceAuthorization,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

export interface IdFactory {
  next(kind: "run" | "event"): string;
}

export type RunRecord = {
  snapshot: AgentRunSnapshot;
  events: readonly AgentRunEvent[];
  startRequest: AgentRunStartRequest;
  startedAt: string;
  startFingerprint: string;
  result?: AgentRunResult;
  cancellation?: AgentRunTransition;
};

/**
 * Identifies which public command produced a completed run record, plus the
 * exact idempotency/revision context `AgentRunRecordStore.retainMutation`
 * (SPEC-410 §5) requires. A command may append several intermediate events
 * internally (e.g. `execute` moves through step_proposed → step_committed),
 * but this hook fires exactly once per public method call, after that
 * call's outcome is final — never per intermediate event — because
 * `retainMutation` is an atomic-per-command seam, not a per-event log.
 */
export type CompletedRunCommand = Readonly<{
  kind: "start" | "execute" | "approve" | "resume" | "cancel";
  idempotency_key: string;
  /** The revision the command expected before it ran; null only for `start`, which creates the run. */
  expected_revision: number | null;
}>;

/**
 * Called synchronously once per completed public command — the single choke
 * point a durable-backed subclass (e.g. a future `PersistedAgentRuntime`
 * composing an `AgentRunRecordStore`) can observe to mirror final state
 * without this class's state machine being duplicated. Never called for
 * reads, and never called for an intermediate step within a command. Errors
 * thrown by the hook are not caught here — a persistence failure SHALL
 * surface to the caller rather than be silently swallowed.
 */
export type RunPersistedHook = (
  runId: string,
  record: Readonly<RunRecord>,
  command: CompletedRunCommand,
) => void;

type StoredCommand = Readonly<{
  fingerprint: string;
  transition: AgentRunTransition;
}>;

type StoredExecution = Readonly<{
  fingerprint: string;
  result: AgentRunResult;
}>;

const MAX_EVENT_PAGE_SIZE = 100;
const TERMINAL_STATES: ReadonlySet<AgentRunState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
  "blocked",
]);

/**
 * Deterministic adapter for contract tests and local development.
 * It deliberately performs no execution, provider calls, or durable persistence.
 */
export class InMemoryAgentRuntime implements AgentRuntime {
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #executor: AgentRunExecutor | undefined;
  readonly #runs = new Map<string, RunRecord>();
  readonly #starts = new Map<string, Readonly<{ fingerprint: string; runId: string }>>();
  readonly #commands = new Map<string, StoredCommand>();
  readonly #executions = new Map<string, StoredExecution>();
  readonly #activeExecutions = new Map<string, AbortController>();
  readonly #onRunPersisted: RunPersistedHook | undefined;

  constructor(
    clock: Clock,
    ids: IdFactory,
    authorizer: WorkspaceAuthorizer,
    executor?: AgentRunExecutor,
    onRunPersisted?: RunPersistedHook,
  ) {
    this.#clock = clock;
    this.#ids = ids;
    this.#authorizer = authorizer;
    this.#executor = executor;
    this.#onRunPersisted = onRunPersisted;
  }

  /**
   * The single write path for `#runs` — every mutation site calls this
   * instead of `#runs.set` directly. Intermediate steps within a command
   * (e.g. `execute`'s step_proposed → step_committed) call only this; they
   * do NOT fire `#onRunPersisted` (see `CompletedRunCommand` docstring).
   */
  #persist(runId: string, record: RunRecord): RunRecord {
    this.#runs.set(runId, record);
    return record;
  }

  /**
   * Loads a run's in-process state from an external source (a durable
   * record store, SPEC-410 §5) without going through `start` — for a
   * `PersistedAgentRuntime`-style subclass restoring a run created in a
   * prior process. Does not fire `#onRunPersisted` (nothing new happened;
   * this mirrors already-durable state into memory) and does not re-derive
   * `#starts`/`#commands`/`#executions` idempotency indexes, so a command
   * replayed against a freshly seeded run re-authorizes and re-validates
   * exactly as it would for any other in-flight run at that revision.
   *
   * Refuses to seed over a run this SAME instance already holds in a
   * non-terminal state (SPEC-508 §5 / SPEC-606 §7: a stale writer SHALL
   * NOT overwrite newer or in-flight state). Without this guard, calling
   * `restore()` while `execute()` is still awaiting its executor on the
   * very same instance would roll `#runs` back to the pre-execute
   * snapshot; when the executor later resolves, `execute()` would compare
   * against a revision that no longer matches its own reservation, discard
   * a real completed effect as `stale_revision`, and never persist it —
   * silently losing an effect that already happened. Re-seeding a run
   * already in a TERMINAL state is harmless (terminal snapshots don't
   * change) and remains allowed for idempotent re-restoration.
   */
  seed(runId: string, record: RunRecord): Readonly<{ ok: true } | { ok: false; reason: "run_active_in_process" }> {
    const existing = this.#runs.get(runId);
    if (existing !== undefined && !TERMINAL_STATES.has(existing.snapshot.state)) {
      return { ok: false, reason: "run_active_in_process" };
    }
    this.#runs.set(runId, record);
    return { ok: true };
  }

  /**
   * Fires `#onRunPersisted` exactly once for a completed public command,
   * reading whatever the run's final state ended up as (whether the command
   * succeeded, failed, or left the run unchanged because it was rejected
   * before any mutation). Does nothing if no hook is configured, or if the
   * run was never created (a rejected `start` never reaches this point with
   * a runId the caller could have referenced anyway).
   *
   * Two commands racing on the SAME run (e.g. a concurrent `execute` and
   * `cancel`) can both reach this point observing the same final record —
   * one of them didn't actually cause it. This is intentional and safe: the
   * record itself is the run's one authoritative current state regardless
   * of which command's call triggered reading it, so persisting it twice is
   * an idempotent no-op from the store's perspective (the second call's
   * `expected_revision` will simply be behind by the time it's applied,
   * which the store SHALL treat as "a newer state is already durably
   * retained," not as an error — see `PersistedAgentRuntime#retain`).
   */
  #fireCompletedCommand(reference: AgentRunReference, command: CompletedRunCommand): void {
    if (!this.#onRunPersisted) return;
    const record = this.#runs.get(reference.run_id);
    // Guards against a cross-Workspace reference: `#runs` is keyed only by
    // run_id, so a denied cross-Workspace command must not leak another
    // Workspace's record to the hook just because the run_id happened to
    // resolve to it.
    if (record === undefined || record.snapshot.workspace_id !== reference.workspace_id) return;
    this.#onRunPersisted(reference.run_id, record, command);
  }

  async start(
    request: AgentRunStartRequest,
  ): Promise<AgentRuntimeResult<AgentRunReference>> {
    const startKey = scopedKey(request.workspace_id, request.idempotency_key);
    const fingerprint = stableFingerprint(request);
    const existing = this.#starts.get(startKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return failure(idempotencyConflict("start", request.idempotency_key));
      }
      return success(freezeReference(existing.runId, request.workspace_id));
    }

    const validation = validateStart(request, this.#clock.now());
    if (validation) return failure(validation);

    const contextMismatchFailure = validateTrustedContextBinding(request);
    if (contextMismatchFailure) return failure(contextMismatchFailure);

    const authorizationRequest = authorizationForStart(request);
    const authorization = await this.#authorizer.authorize(authorizationRequest);
    if (!authorization.ok) {
      return failure(authorizationDenied(authorization.failure.code));
    }
    if (!authorizationCovers(authorization.value, authorizationRequest)) {
      return failure(authorizationDenied("incomplete_authorization"));
    }

    const runId = this.#ids.next("run");
    const reference = freezeReference(runId, request.workspace_id);
    const resolvedVersions = Object.freeze({
      agent: `${request.agent.id}@${request.agent.version}`,
      policy: request.policy_version,
    });
    const approvalId = `approval:${runId}:1`;
    const requiresApproval = request.consequence_class === "high_consequence";
    const events = [
      this.#event(reference, 1, "run_requested", {
        operation_id: request.operation_id,
        actor_id: request.actor_id,
        purpose: request.purpose,
      }),
      this.#event(reference, 2, "run_resolved", {
        operation_id: request.operation_id,
        resolved_versions: resolvedVersions,
      }),
      this.#event(reference, 3, "authorization_requested", {
        operation_id: request.operation_id,
        consequence_class: request.consequence_class,
        policy_version: request.policy_version,
      }),
      this.#event(reference, 4, "authorization_granted", {
        operation_id: request.operation_id,
        policy_version: authorization.value.policy_version,
        decision: "allow",
        evidence: [...authorization.value.decision_evidence],
      }),
      requiresApproval
        ? this.#event(reference, 5, "approval_requested", {
            operation_id: request.operation_id,
            approval_id: approvalId,
            consequence_class: request.consequence_class,
          })
        : this.#event(reference, 5, "run_ready", {
            operation_id: request.operation_id,
          }),
    ] as const;
    const evidence = Object.freeze(events.map((event) => `event://${event.event_id}`));
    const snapshot = freezeSnapshot({
      schema_version: "1.0.0",
      run_id: runId,
      workspace_id: request.workspace_id,
      revision: 3,
      state: requiresApproval ? "awaiting_approval" : "ready",
      objective: request.purpose,
      consumed_budgets: Object.freeze({
        steps: 0,
        duration_seconds: 0,
        tool_calls: 0,
        retries: 0,
      }),
      pending_approval: requiresApproval
        ? Object.freeze({
            approval_id: approvalId,
            requested_action: request.purpose,
            consequence_class: request.consequence_class,
            required_permissions: Object.freeze(["agent:approve"]),
            evidence: Object.freeze([...evidence]),
          })
        : null,
      checkpoint: null,
      failure_class: null,
      evidence,
      updated_at: events[4].occurred_at,
    });

    this.#persist(runId, {
      snapshot,
      events: Object.freeze([...events]),
      startRequest: immutableCopy(request),
      startedAt: events[0].occurred_at,
      startFingerprint: fingerprint,
    });
    this.#starts.set(startKey, Object.freeze({ fingerprint, runId }));
    this.#fireCompletedCommand(reference, {
      kind: "start",
      idempotency_key: request.idempotency_key,
      expected_revision: null,
    });
    return success(reference);
  }

  async inspect(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunSnapshot>> {
    const authorized = await this.#authorizeRun(
      reference,
      access,
      "agent:read",
      "inspect Agent run",
      "advisory",
    );
    if (!authorized.ok) return authorized;
    const found = this.#find(reference);
    return found.ok ? success(found.value.snapshot) : found;
  }

  async execute(
    reference: AgentRunReference,
    execution: AgentRunExecution,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    const beforeRevision = this.#find(reference);
    const result = await this.#executeCommand(reference, execution);
    this.#fireCompletedCommand(reference, {
      kind: "execute",
      idempotency_key: execution.idempotency_key,
      expected_revision: beforeRevision.ok ? beforeRevision.value.snapshot.revision : null,
    });
    return result;
  }

  async #executeCommand(
    reference: AgentRunReference,
    execution: AgentRunExecution,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    const baseAuthorization = await this.#authorizeRun<AgentRunResult>(
      reference,
      execution,
      "agent:execute",
      "execute Agent run",
      "controlled_side_effect",
    );
    if (!baseAuthorization.ok) return baseAuthorization;

    const found = this.#find(reference);
    if (!found.ok) return found;
    const retainedAuthorization = await this.#authorizeRetainedExecution(
      reference,
      execution,
      found.value,
    );
    if (!retainedAuthorization.ok) return retainedAuthorization;

    const available = this.#find(reference);
    if (!available.ok) return available;
    if (
      !Number.isInteger(execution.expected_revision) ||
      execution.expected_revision < 0 ||
      execution.idempotency_key.trim().length === 0
    ) {
      return failure(invalidRequest("execute requires a non-negative expected revision and idempotency key"));
    }

    const commandKey = executionScopedKey(
      execution.workspace_id,
      reference.run_id,
      execution.idempotency_key,
    );
    const fingerprint = stableFingerprint(execution);
    const duplicate = this.#executions.get(commandKey);
    if (duplicate) {
      return duplicate.fingerprint === fingerprint
        ? success(duplicate.result)
        : failure(idempotencyConflict("execute", execution.idempotency_key));
    }
    if (execution.expected_revision !== available.value.snapshot.revision) {
      return failure(
        staleRevision(execution.expected_revision, available.value.snapshot.revision),
      );
    }
    if (available.value.snapshot.state !== "ready") {
      return failure(invalidTransition(available.value.snapshot.state, "execute"));
    }
    if (new Date(available.value.startRequest.deadline).valueOf() <= this.#clock.now().valueOf()) {
      return this.#finalizeExecutionFailure(
        reference,
        available.value,
        execution,
        runtimeFailure("orchestration", "timed_out", "Agent run deadline elapsed before execution."),
        commandKey,
        fingerprint,
      );
    }
    if (!this.#executor) {
      return failure({
        class: "infrastructure",
        code: "unavailable",
        message: "Agent run executor is unavailable.",
        retryable: true,
        evidence: [],
      });
    }

    let current = this.#appendEvent(reference, available.value, "step_proposed", {
      operation_id: execution.operation_id,
      actor_id: execution.actor_id,
      step: 1,
    });
    this.#transition(reference, current, "running", "step_authorized", {
      operation_id: execution.operation_id,
      actor_id: execution.actor_id,
      step: 1,
      evidence: [...retainedAuthorization.value.decision_evidence],
    });
    const running = this.#find(reference);
    if (!running.ok) return running;

    const abortController = new AbortController();
    this.#activeExecutions.set(reference.run_id, abortController);
    let observed: AgentRunExecutorResult;
    try {
      observed = await this.#executor.execute({
        ...immutableCopy({
          reference,
          start_request: running.value.startRequest,
          execution,
        }),
        signal: abortController.signal,
      });
    } catch {
      observed = {
        ok: false,
        failure: runtimeFailure(
          "infrastructure",
          "infrastructure_failure",
          "Agent run executor failed unexpectedly.",
          true,
        ),
      };
    } finally {
      this.#activeExecutions.delete(reference.run_id);
    }

    const reservedRevision = running.value.snapshot.revision;
    const active = this.#find(reference);
    if (!active.ok) return active;
    if (
      active.value.snapshot.state !== "running" ||
      active.value.snapshot.revision !== reservedRevision
    ) {
      if (active.value.result) {
        this.#executions.set(
          commandKey,
          Object.freeze({ fingerprint, result: active.value.result }),
        );
        return success(active.value.result);
      }
      return failure(
        staleRevision(reservedRevision, active.value.snapshot.revision),
      );
    }

    if (
      new Date(active.value.startRequest.deadline).valueOf() <=
      this.#clock.now().valueOf()
    ) {
      const lateEvidence = observed.ok
        ? []
        : [
            ...observed.failure.evidence,
            `late-executor-failure:${observed.failure.code}`,
          ];
      const timeout = runtimeFailure(
        "orchestration",
        "timed_out",
        "Agent execution completed after the retained deadline.",
        false,
        lateEvidence,
      );
      const withLateUsage =
        observed.ok && validUsage(observed.value.usage)
          ? this.#applyUsage(reference, active.value, observed.value)
          : active.value;
      return this.#finalizeExecutionFailure(
        reference,
        withLateUsage,
        execution,
        timeout,
        commandKey,
        fingerprint,
        observed.ok ? observed.value : undefined,
      );
    }

    if (!observed.ok) {
      // SPEC-606 §3: an unknown effect status suspends the run rather than
      // failing it — the outcome is unproven, not disproven, so a later
      // resume can reconcile it once the effect status becomes known.
      if (observed.failure.code === "unknown_effect") {
        return this.#suspendForUnknownEffect(
          reference,
          active.value,
          execution,
          observed.failure,
        );
      }
      return this.#finalizeExecutionFailure(
        reference,
        active.value,
        execution,
        observed.failure,
        commandKey,
        fingerprint,
      );
    }
    const invalidObservation = validateExecutionValue(
      observed.value,
      active.value.startRequest,
    );
    const withUsage = validUsage(observed.value.usage)
      ? this.#applyUsage(reference, active.value, observed.value)
      : active.value;
    if (invalidObservation) {
      return this.#finalizeExecutionFailure(
        reference,
        withUsage,
        execution,
        invalidObservation,
        commandKey,
        fingerprint,
        observed.value,
      );
    }

    current = this.#appendEvent(reference, withUsage, "step_observed", {
      operation_id: execution.operation_id,
      step: 1,
      evidence: [...observed.value.evidence],
    });
    this.#transition(reference, current, "validating", "run_validating", {
      operation_id: execution.operation_id,
    });
    const validating = this.#find(reference);
    if (!validating.ok) return validating;
    current = this.#appendEvent(reference, validating.value, "step_validated", {
      operation_id: execution.operation_id,
      step: 1,
      output_validated: true,
      evidence: [...observed.value.evidence],
    });
    // SPEC-606 §3: a side-effecting step is committed only once its effect
    // status is known. Reaching this point means the executor did not
    // report unknown_effect, so the step's effect status is known.
    current = this.#appendEvent(reference, current, "step_committed", {
      operation_id: execution.operation_id,
      step: 1,
      evidence: [...observed.value.evidence],
    });
    if (observed.value.cleanup_status === "completed") {
      current = this.#appendEvent(reference, current, "cleanup_completed", {
        operation_id: execution.operation_id,
        cleanup_status: "completed",
      });
    }
    this.#transition(reference, current, "completed", "run_completed", {
      operation_id: execution.operation_id,
      outcome: "completed",
      evidence: [...observed.value.evidence],
    });
    const completed = this.#find(reference);
    if (!completed.ok) return completed;
    const result = freezeRunResult({
      schema_version: "1.0.0",
      run_id: reference.run_id,
      workspace_id: reference.workspace_id,
      outcome: "completed",
      output: observed.value.output,
      failure_class: null,
      resolved_versions: observed.value.resolved_versions,
      rule_results: observed.value.rule_results,
      skill_usage: observed.value.skill_usage,
      tool_usage: observed.value.tool_usage,
      citations: observed.value.citations,
      uncertainty: observed.value.uncertainty,
      policy_events: observed.value.policy_events,
      usage: observed.value.usage,
      evidence: unique([...observed.value.evidence, ...completed.value.snapshot.evidence]),
      cleanup_status: observed.value.cleanup_status,
      knowledge_candidates: observed.value.knowledge_candidates,
      started_at: completed.value.startedAt,
      completed_at: completed.value.snapshot.updated_at,
    });
    this.#storeResult(reference.run_id, completed.value, result);
    this.#executions.set(commandKey, Object.freeze({ fingerprint, result }));
    return success(result);
  }

  async result(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    const authorized = await this.#authorizeRun<AgentRunResult>(
      reference,
      access,
      "agent:read",
      "read Agent run result",
      "advisory",
    );
    if (!authorized.ok) return authorized;
    const found = this.#find(reference);
    if (!found.ok) return found;
    return found.value.result
      ? success(found.value.result)
      : failure({
          class: "orchestration",
          code: "unavailable",
          message: "Agent run result is not terminally available.",
          retryable: true,
          evidence: [...found.value.snapshot.evidence],
        });
  }

  async approve(
    reference: AgentRunReference,
    approval: AgentRunApproval,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#command(
      "approve",
      reference,
      approval,
      "awaiting_approval",
      approval.decision === "approved" ? "ready" : "blocked",
      approval.decision === "approved" ? "step_authorized" : "run_blocked",
      "agent:approve",
      "approve Agent run",
      "controlled_side_effect",
    );
    this.#fireCompletedCommand(reference, {
      kind: "approve",
      idempotency_key: approval.idempotency_key,
      expected_revision: approval.expected_revision,
    });
    return result;
  }

  async resume(
    reference: AgentRunReference,
    checkpoint: AgentRunResume,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#command(
      "resume",
      reference,
      checkpoint,
      "suspended",
      "running",
      "run_resumed",
      "agent:resume",
      "resume Agent run",
      "reversible",
    );
    this.#fireCompletedCommand(reference, {
      kind: "resume",
      idempotency_key: checkpoint.idempotency_key,
      expected_revision: checkpoint.expected_revision,
    });
    return result;
  }

  async cancel(
    reference: AgentRunReference,
    cancellation: AgentRunCancellation,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#cancelCommand(reference, cancellation);
    this.#fireCompletedCommand(reference, {
      kind: "cancel",
      idempotency_key: cancellation.idempotency_key,
      expected_revision: cancellation.expected_revision,
    });
    return result;
  }

  async #cancelCommand(
    reference: AgentRunReference,
    cancellation: AgentRunCancellation,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    if (cancellation.evidence.length === 0) {
      return failure(invalidRequest("cancellation requires attributable evidence"));
    }
    const authorized = await this.#authorizeRun(
      reference,
      cancellation,
      "agent:cancel",
      "cancel Agent run",
      "reversible",
    );
    if (!authorized.ok) return authorized;
    const found = this.#find(reference);
    if (!found.ok) return found;
    if (cancellation.workspace_id !== reference.workspace_id) {
      return failure(workspaceDenied(reference.workspace_id));
    }

    const commandKey = commandScopedKey(
      "cancel",
      cancellation.workspace_id,
      reference.run_id,
      cancellation.idempotency_key,
    );
    const fingerprint = stableFingerprint(cancellation);
    const duplicate = this.#commands.get(commandKey);
    if (duplicate) {
      return duplicate.fingerprint === fingerprint
        ? success(duplicate.transition)
        : failure(idempotencyConflict("cancel", cancellation.idempotency_key));
    }
    if (cancellation.expected_revision !== found.value.snapshot.revision) {
      return failure(staleRevision(cancellation.expected_revision, found.value.snapshot.revision));
    }
    if (TERMINAL_STATES.has(found.value.snapshot.state)) {
      return failure(invalidTransition(found.value.snapshot.state, "cancel"));
    }

    const inFlightExecution = found.value.snapshot.state === "running";
    const activeController = this.#activeExecutions.get(reference.run_id);
    activeController?.abort();

    const transition = this.#transition(
      reference,
      found.value,
      "cancelled",
      "run_cancelled",
      {
        operation_id: cancellation.operation_id,
        actor_id: cancellation.actor_id,
        reason: cancellation.reason,
        evidence: [...cancellation.evidence],
      },
    );
    const terminal = this.#find(reference);
    if (!terminal.ok) return terminal;
    const result = freezeRunResult({
      schema_version: "1.0.0",
      run_id: reference.run_id,
      workspace_id: reference.workspace_id,
      outcome: "cancelled",
      output: null,
      failure_class: "orchestration",
      resolved_versions: {
        agent: `${found.value.startRequest.agent.id}@${found.value.startRequest.agent.version}`,
        policy: found.value.startRequest.policy_version,
      },
      rule_results: [],
      skill_usage: [],
      tool_usage: [],
      citations: [],
      uncertainty: {
        level: "high",
        reasons: [cancellation.reason],
      },
      policy_events: [],
      usage: usageFromSnapshot(terminal.value.snapshot),
      evidence: unique([
        ...cancellation.evidence,
        ...terminal.value.snapshot.evidence,
      ]),
      knowledge_candidates: [],
      // SPEC-606 §7d: cancellation during an in-flight step has an unreconciled
      // side effect until the executor's own cleanup observation is retained.
      cleanup_status: inFlightExecution ? "incomplete" : "not_required",
      started_at: terminal.value.startedAt,
      completed_at: terminal.value.snapshot.updated_at,
    });
    this.#storeResult(reference.run_id, terminal.value, result);
    this.#commands.set(commandKey, Object.freeze({ fingerprint, transition }));
    return success(transition);
  }

  async streamEvents(
    reference: AgentRunReference,
    cursor: AgentRunEventCursor,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunEventPage>> {
    if (cursor.schema_version !== "1.0.0") {
      return failure(invalidRequest("unsupported Agent Runtime cursor schema version"));
    }
    const authorized = await this.#authorizeRun(
      reference,
      access,
      "agent:read",
      "stream Agent run events",
      "advisory",
    );
    if (!authorized.ok) return authorized;
    const found = this.#find(reference);
    if (!found.ok) return found;
    if (
      !Number.isInteger(cursor.after_sequence) ||
      cursor.after_sequence < 0 ||
      !Number.isInteger(cursor.limit) ||
      cursor.limit < 1 ||
      cursor.limit > MAX_EVENT_PAGE_SIZE
    ) {
      return failure(
        invalidRequest(
          `event cursor requires after_sequence >= 0 and limit between 1 and ${MAX_EVENT_PAGE_SIZE}`,
        ),
      );
    }

    const events = found.value.events
      .filter((event) => event.sequence > cursor.after_sequence)
      .slice(0, cursor.limit);
    const first = events[0];
    const latest = found.value.events.at(-1)?.sequence ?? 0;
    const sequenceGap = first
      ? first.sequence !== cursor.after_sequence + 1
      : cursor.after_sequence > latest;
    const nextSequence = events.at(-1)?.sequence ?? cursor.after_sequence;
    return success(
      Object.freeze({
        schema_version: "1.0.0",
        events: Object.freeze([...events]),
        next_cursor: Object.freeze({
          schema_version: "1.0.0",
          after_sequence: nextSequence,
          limit: cursor.limit,
        }),
        sequence_gap: sequenceGap,
      }),
    );
  }

  #find(reference: AgentRunReference): AgentRuntimeResult<RunRecord> {
    if (reference.schema_version !== "1.0.0") {
      return failure(invalidRequest("unsupported Agent Runtime reference schema version"));
    }
    const record = this.#runs.get(reference.run_id);
    if (!record) {
      return failure({
        class: "orchestration",
        code: "not_found",
        message: `agent run ${reference.run_id} was not found`,
        retryable: false,
        evidence: [],
      });
    }
    if (record.snapshot.workspace_id !== reference.workspace_id) {
      return failure(workspaceDenied(reference.workspace_id));
    }
    return success(record);
  }

  #event(
    reference: AgentRunReference,
    sequence: number,
    type: AgentRunEvent["type"],
    payload: JsonObject,
  ): AgentRunEvent {
    return Object.freeze({
      schema_version: "1.0.0",
      event_id: this.#ids.next("event"),
      run_id: reference.run_id,
      workspace_id: reference.workspace_id,
      sequence,
      type,
      occurred_at: this.#clock.now().toISOString(),
      payload_schema: Object.freeze({
        id: "agent-run-event-payload",
        version: "1.0.0",
      }),
      payload: Object.freeze({ event_type: type, ...payload }),
    });
  }

  async #command(
    kind: "approve" | "resume",
    reference: AgentRunReference,
    command: AgentRunApproval | AgentRunResume,
    requiredState: AgentRunState,
    nextState: AgentRunState,
    eventType: AgentRunEvent["type"],
    permission: string,
    purpose: string,
    consequenceClass: ConsequenceClass,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const authorized = await this.#authorizeRun(
      reference,
      command,
      permission,
      purpose,
      consequenceClass,
    );
    if (!authorized.ok) return authorized;
    const found = this.#find(reference);
    if (!found.ok) return found;
    if (command.workspace_id !== reference.workspace_id) {
      return failure(workspaceDenied(reference.workspace_id));
    }
    const commandKey = commandScopedKey(
      kind,
      command.workspace_id,
      reference.run_id,
      command.idempotency_key,
    );
    const fingerprint = stableFingerprint(command);
    const duplicate = this.#commands.get(commandKey);
    if (duplicate) {
      return duplicate.fingerprint === fingerprint
        ? success(duplicate.transition)
        : failure(idempotencyConflict(kind, command.idempotency_key));
    }
    if (command.expected_revision !== found.value.snapshot.revision) {
      return failure(staleRevision(command.expected_revision, found.value.snapshot.revision));
    }
    if (TERMINAL_STATES.has(found.value.snapshot.state)) {
      return failure(invalidTransition(found.value.snapshot.state, kind));
    }
    if (found.value.snapshot.state !== requiredState) {
      return failure(invalidTransition(found.value.snapshot.state, kind));
    }
    if (kind === "approve") {
      const approval = command as AgentRunApproval;
      if (
        found.value.snapshot.pending_approval === null ||
        found.value.snapshot.pending_approval.approval_id !== approval.approval_id ||
        approval.evidence.length === 0
      ) {
        return failure(invalidRequest("approval must match the pending approval challenge and include evidence"));
      }
    } else {
      const resume = command as AgentRunResume;
      if (
        found.value.snapshot.checkpoint === null ||
        found.value.snapshot.checkpoint !== resume.checkpoint
      ) {
        return failure(invalidRequest("resume checkpoint must match the retained checkpoint"));
      }
    }

    const payload: JsonObject =
      kind === "approve"
        ? {
            operation_id: command.operation_id,
            actor_id: command.actor_id,
            approval_id: (command as AgentRunApproval).approval_id,
            decision: (command as AgentRunApproval).decision,
            reason: command.reason,
            evidence: [...(command as AgentRunApproval).evidence],
          }
        : {
            operation_id: command.operation_id,
            actor_id: command.actor_id,
            checkpoint: (command as AgentRunResume).checkpoint,
            reason: command.reason,
          };
    const transition = this.#transition(
      reference,
      found.value,
      nextState,
      eventType,
      payload,
    );
    if (nextState === "blocked") {
      const terminal = this.#find(reference);
      if (!terminal.ok) return terminal;
      const approval = command as AgentRunApproval;
      const result = freezeRunResult({
        schema_version: "1.0.0",
        run_id: reference.run_id,
        workspace_id: reference.workspace_id,
        outcome: "blocked",
        output: null,
        failure_class: "policy",
        resolved_versions: retainedResolvedVersions(found.value.startRequest),
        rule_results: [],
        skill_usage: [],
        tool_usage: [],
        citations: [],
        uncertainty: {
          level: "high",
          reasons: [approval.reason],
        },
        policy_events: [...approval.evidence],
        usage: usageFromSnapshot(terminal.value.snapshot),
        evidence: unique([
          ...approval.evidence,
          ...terminal.value.snapshot.evidence,
        ]),
        cleanup_status: "not_required",
        knowledge_candidates: [],
        started_at: terminal.value.startedAt,
        completed_at: terminal.value.snapshot.updated_at,
      });
      this.#storeResult(reference.run_id, terminal.value, result);
    }
    this.#commands.set(commandKey, Object.freeze({ fingerprint, transition }));
    return success(transition);
  }

  async #authorizeRun<Value>(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
    permission: string,
    purpose: string,
    consequenceClass: ConsequenceClass,
  ): Promise<AgentRuntimeResult<Value>> {
    if (
      reference.schema_version !== "1.0.0" ||
      access.schema_version !== "1.0.0" ||
      access.workspace_context.schema_version !== "1.0.0"
    ) {
      return failure(invalidRequest("unsupported Agent Runtime operation schema version"));
    }
    if (
      access.workspace_id !== reference.workspace_id ||
      access.workspace_context.workspace_id !== access.workspace_id ||
      access.workspace_context.actor_id !== access.actor_id ||
      access.workspace_context.policy_version !== access.policy_version
    ) {
      return failure(authorizationDenied("context_binding_mismatch"));
    }
    const authorizationRequest: WorkspaceAuthorizationRequest = Object.freeze({
      operation_id: access.operation_id,
      context: access.workspace_context,
      purpose,
      consequence_class: consequenceClass,
      required_permissions: Object.freeze([permission]),
      resource_refs: Object.freeze([
        `workspace:${reference.workspace_id}`,
        `agent-run:${reference.run_id}`,
      ]),
    });
    const authorization = await this.#authorizer.authorize(authorizationRequest);
    if (!authorization.ok) {
      return failure(authorizationDenied(authorization.failure.code));
    }
    if (!authorizationCovers(authorization.value, authorizationRequest)) {
      return failure(authorizationDenied("incomplete_authorization"));
    }
    return success(undefined as Value);
  }

  async #authorizeRetainedExecution(
    reference: AgentRunReference,
    execution: AgentRunExecution,
    record: RunRecord,
  ): Promise<AgentRuntimeResult<WorkspaceAuthorization>> {
    const request: WorkspaceAuthorizationRequest = Object.freeze({
      operation_id: execution.operation_id,
      context: execution.workspace_context,
      purpose: record.startRequest.purpose,
      consequence_class: record.startRequest.consequence_class,
      required_permissions: Object.freeze(["agent:execute"]),
      resource_refs: Object.freeze([
        `workspace:${reference.workspace_id}`,
        `agent-run:${reference.run_id}`,
        `agent:${record.startRequest.agent.id}@${record.startRequest.agent.version}`,
        ...(record.startRequest.allowed_skills ?? []).map(
          (skill) => `skill:${skill.id}@${skill.version}`,
        ),
        ...(record.startRequest.allowed_tools ?? []).map(
          (tool) => `tool:${tool.id}@${tool.version}`,
        ),
        ...inputResourceRefs(record.startRequest.input),
      ]),
    });
    const authorization = await this.#authorizer.authorize(request);
    if (!authorization.ok) {
      return failure(authorizationDenied(authorization.failure.code));
    }
    if (!authorizationCovers(authorization.value, request)) {
      return failure(authorizationDenied("incomplete_authorization"));
    }
    return success(authorization.value);
  }

  #appendEvent(
    reference: AgentRunReference,
    record: RunRecord,
    eventType: AgentRunEvent["type"],
    payload: JsonObject,
  ): RunRecord {
    const event = this.#event(
      reference,
      (record.events.at(-1)?.sequence ?? 0) + 1,
      eventType,
      payload,
    );
    const updated: RunRecord = {
      ...record,
      snapshot: freezeSnapshot({
        ...record.snapshot,
        evidence: Object.freeze([
          ...record.snapshot.evidence,
          `event://${event.event_id}`,
        ]),
        updated_at: event.occurred_at,
      }),
      events: Object.freeze([...record.events, event]),
    };
    this.#persist(reference.run_id, updated);
    return updated;
  }

  #storeResult(runId: string, record: RunRecord, result: AgentRunResult): void {
    this.#persist(runId, { ...record, result });
  }

  /**
   * SPEC-606 §2/§3: an unknown effect status suspends the run instead of
   * failing it. The run is non-terminal; `resume()` reconciles the
   * checkpoint once the effect status is known.
   */
  #suspendForUnknownEffect(
    reference: AgentRunReference,
    record: RunRecord,
    execution: AgentRunExecution,
    failureValue: AgentRunFailure,
  ): AgentRuntimeResult<AgentRunResult> {
    const checkpoint = `checkpoint:${reference.run_id}:unknown-effect:${execution.idempotency_key}`;
    this.#transition(
      reference,
      record,
      "suspended",
      "run_suspended",
      {
        operation_id: execution.operation_id,
        failure_class: failureValue.class,
        failure_code: failureValue.code,
        evidence: [...failureValue.evidence],
      },
      failureValue.class,
    );
    const suspended = this.#find(reference);
    if (suspended.ok) {
      this.#persist(reference.run_id, {
        ...suspended.value,
        snapshot: freezeSnapshot({ ...suspended.value.snapshot, checkpoint }),
      });
    }
    return failure({
      ...failureValue,
      evidence: [...failureValue.evidence, `checkpoint:${checkpoint}`],
    });
  }

  #applyUsage(
    reference: AgentRunReference,
    record: RunRecord,
    observed: AgentRunExecutorValue,
  ): RunRecord {
    const updated: RunRecord = {
      ...record,
      snapshot: freezeSnapshot({
        ...record.snapshot,
        consumed_budgets: {
          ...record.snapshot.consumed_budgets,
          ...observed.usage,
        },
        updated_at: this.#clock.now().toISOString(),
      }),
    };
    this.#persist(reference.run_id, updated);
    return updated;
  }

  #finalizeExecutionFailure(
    reference: AgentRunReference,
    record: RunRecord,
    execution: AgentRunExecution,
    failureValue: AgentRunFailure,
    commandKey: string,
    fingerprint: string,
    observation?: AgentRunExecutorValue,
  ): AgentRuntimeResult<AgentRunResult> {
    const state = terminalStateForFailure(failureValue);
    const eventType = terminalEventForState(state);
    const terminalInput =
      failureValue.code === "cleanup_failure"
        ? this.#appendEvent(reference, record, "cleanup_failed", {
            operation_id: execution.operation_id,
            cleanup_status: observation?.cleanup_status ?? "failed",
            evidence: observation?.evidence ?? [],
          })
        : record;
    this.#transition(
      reference,
      terminalInput,
      state,
      eventType,
      {
        operation_id: execution.operation_id,
        failure_class: failureValue.class,
        failure_code: failureValue.code,
        evidence: [...failureValue.evidence],
      },
      failureValue.class,
    );
    const terminal = this.#find(reference);
    if (!terminal.ok) return terminal;
    const result = freezeRunResult({
      schema_version: "1.0.0",
      run_id: reference.run_id,
      workspace_id: reference.workspace_id,
      outcome: outcomeForState(state),
      output: null,
      failure_class: failureValue.class,
      resolved_versions: retainedResolvedVersions(record.startRequest, observation),
      rule_results: observation?.rule_results ?? [],
      skill_usage: observation?.skill_usage ?? [],
      tool_usage: observation?.tool_usage ?? [],
      citations: observation?.citations ?? [],
      uncertainty: observation?.uncertainty ?? {
        level: "high",
        reasons: [failureValue.message],
      },
      policy_events: observation?.policy_events ?? [],
      usage: usageFromSnapshot(terminal.value.snapshot),
      evidence: unique([
        ...failureValue.evidence,
        ...(observation?.evidence ?? []),
        ...observedVersionEvidence(observation),
        ...terminal.value.snapshot.evidence,
      ]),
      cleanup_status: observation?.cleanup_status ?? "not_required",
      knowledge_candidates: observation?.knowledge_candidates ?? [],
      started_at: terminal.value.startedAt,
      completed_at: terminal.value.snapshot.updated_at,
    });
    this.#storeResult(reference.run_id, terminal.value, result);
    this.#executions.set(commandKey, Object.freeze({ fingerprint, result }));
    return success(result);
  }

  #transition(
    reference: AgentRunReference,
    record: RunRecord,
    nextState: AgentRunState,
    eventType: AgentRunEvent["type"],
    payload: JsonObject,
    failureClass?: AgentRunFailureClass,
  ): AgentRunTransition {
    const previous = record.snapshot;
    const event = this.#event(
      reference,
      (record.events.at(-1)?.sequence ?? 0) + 1,
      eventType,
      payload,
    );
    const transition = Object.freeze({
      schema_version: "1.0.0" as const,
      run_id: reference.run_id,
      workspace_id: reference.workspace_id,
      revision: previous.revision + 1,
      previous_state: previous.state,
      state: nextState,
      event_id: event.event_id,
    });
    const snapshot = freezeSnapshot({
      ...previous,
      revision: transition.revision,
      state: nextState,
      pending_approval: null,
      checkpoint: nextState === "running" ? null : (previous.checkpoint ?? null),
      failure_class:
        failureClass ?? terminalFailureClass(nextState) ?? previous.failure_class ?? null,
      evidence: Object.freeze([...previous.evidence, `event://${event.event_id}`]),
      updated_at: event.occurred_at,
    });
    this.#persist(reference.run_id, {
      ...record,
      snapshot,
      events: Object.freeze([...record.events, event]),
      ...(nextState === "cancelled" ? { cancellation: transition } : {}),
    });
    return transition;
  }
}

function terminalFailureClass(
  state: AgentRunState,
): AgentRunFailure["class"] | undefined {
  switch (state) {
    case "blocked":
      return "policy";
    case "cancelled":
    case "timed_out":
    case "failed":
      return "orchestration";
    default:
      return undefined;
  }
}

function validateStart(
  request: AgentRunStartRequest,
  now: Date,
): AgentRunFailure | undefined {
  if (request.schema_version !== "1.0.0") {
    return invalidRequest("unsupported Agent Runtime request schema version");
  }
  const requiredStrings = [
    request.operation_id,
    request.workspace_id,
    request.actor_id,
    request.agent.id,
    request.agent.version,
    request.purpose,
    request.policy_version,
    request.idempotency_key,
  ];
  if (requiredStrings.some((value) => value.trim().length === 0)) {
    return invalidRequest("start request identifiers, versions, purpose, and policy must be non-empty");
  }
  const versions = [
    request.agent,
    ...(request.allowed_skills ?? []),
    ...(request.allowed_tools ?? []),
  ];
  if (
    versions.some(
      (reference) =>
        !reference.id.trim() || !isSemanticVersion(reference.version),
    )
  ) {
    return invalidRequest("every Agent, Skill, and Tool reference requires an id and exact semantic version");
  }
  if (!isExactVersionPin(request.policy_version)) {
    return invalidRequest("policy_version must be an exact version pin");
  }
  const { budgets } = request;
  if (
    !positiveInteger(budgets.max_steps) ||
    !positiveInteger(budgets.max_duration_seconds)
  ) {
    return invalidRequest("max_steps and max_duration_seconds must be positive integers");
  }
  if (
    !nonNegativeInteger(budgets.max_tool_calls) ||
    !nonNegativeInteger(budgets.max_retries) ||
    !optionalNonNegativeInteger(budgets.max_tokens) ||
    !optionalNonNegativeFinite(budgets.max_cost) ||
    !optionalNonNegativeFinite(budgets.max_tool_cost) ||
    !optionalPositiveInteger(budgets.max_repeated_action_fingerprints) ||
    !optionalPositiveInteger(budgets.max_no_progress_iterations)
  ) {
    return invalidRequest("declared run budgets do not satisfy their required bounds");
  }
  const deadline = new Date(request.deadline);
  if (Number.isNaN(deadline.valueOf()) || deadline.valueOf() <= now.valueOf()) {
    return invalidRequest("deadline must be a valid instant in the future");
  }
  return undefined;
}

function validateTrustedContextBinding(
  request: AgentRunStartRequest,
): AgentRunFailure | undefined {
  const { workspace_context: context } = request;
  if (
    request.schema_version !== "1.0.0" ||
    context.schema_version !== "1.0.0" ||
    request.workspace_id !== context.workspace_id ||
    request.actor_id !== context.actor_id ||
    request.policy_version !== context.policy_version
  ) {
    return authorizationDenied("context_binding_mismatch");
  }
  return undefined;
}

function validateExecutionValue(
  value: AgentRunExecutorValue,
  start: AgentRunStartRequest,
): AgentRunFailure | undefined {
  if (!value.output_validated) {
    return runtimeFailure(
      "skill",
      "invalid_output",
      "Agent execution output did not pass contract validation.",
    );
  }
  if (value.evidence.length === 0) {
    return runtimeFailure(
      "skill",
      "invalid_output",
      "Agent execution cannot complete without evidence.",
    );
  }
  const satisfiedEvidence = new Set(value.satisfied_evidence_requirements);
  if (
    (start.evidence_requirements ?? []).some(
      (requirement) => !satisfiedEvidence.has(requirement),
    )
  ) {
    return runtimeFailure(
      "skill",
      "invalid_output",
      "Agent execution did not satisfy every retained evidence requirement.",
    );
  }
  const versions = Object.values(value.resolved_versions);
  if (
    versions.length === 0 ||
    versions.some((version) => !isExactVersionPin(version)) ||
    value.resolved_versions.agent !== `${start.agent.id}@${start.agent.version}` ||
    value.resolved_versions.policy !== start.policy_version
  ) {
    return runtimeFailure(
      "orchestration",
      "incompatible_version",
      "Agent execution returned unresolved or incompatible versions.",
    );
  }
  const allowedSkills = new Set(
    (start.allowed_skills ?? []).map((skill) => `${skill.id}@${skill.version}`),
  );
  if (value.skill_usage.some((skill) => !allowedSkills.has(skill))) {
    return runtimeFailure(
      "policy",
      "authorization_denied",
      "Agent execution used a Skill outside retained authority.",
    );
  }
  if (value.skill_usage.some((skill) => !versions.includes(skill))) {
    return runtimeFailure(
      "orchestration",
      "incompatible_version",
      "Agent execution did not bind every used Skill to resolved versions.",
    );
  }
  const allowedTools = new Set(
    (start.allowed_tools ?? []).map((tool) => `${tool.id}@${tool.version}`),
  );
  if (value.tool_usage.some((tool) => !allowedTools.has(tool))) {
    return runtimeFailure(
      "policy",
      "authorization_denied",
      "Agent execution used a Tool outside retained authority.",
    );
  }
  if (value.tool_usage.some((tool) => !versions.includes(tool))) {
    return runtimeFailure(
      "orchestration",
      "incompatible_version",
      "Agent execution did not bind every used Tool to resolved versions.",
    );
  }
  if (value.cleanup_status === "failed" || value.cleanup_status === "incomplete") {
    return runtimeFailure(
      "infrastructure",
      "cleanup_failure",
      "Agent execution cleanup did not complete safely.",
    );
  }
  const usage = value.usage;
  if (!validUsage(usage)) {
    return runtimeFailure(
      "orchestration",
      "invalid_output",
      "Agent execution returned invalid usage accounting.",
    );
  }
  if (
    usage.steps > start.budgets.max_steps ||
    usage.duration_seconds > start.budgets.max_duration_seconds ||
    usage.tool_calls > start.budgets.max_tool_calls ||
    usage.retries > start.budgets.max_retries ||
    exceedsOptional(usage.tokens, start.budgets.max_tokens) ||
    exceedsOptional(usage.cost, start.budgets.max_cost) ||
    exceedsOptional(usage.tool_cost, start.budgets.max_tool_cost) ||
    exceedsOptional(
      usage.repeated_action_fingerprints,
      start.budgets.max_repeated_action_fingerprints,
    )
  ) {
    return runtimeFailure(
      "orchestration",
      "budget_exhausted",
      "Agent execution exceeded a retained runtime budget.",
    );
  }
  if (
    exceedsOptional(usage.no_progress_iterations, start.budgets.max_no_progress_iterations)
  ) {
    return runtimeFailure(
      "orchestration",
      "no_progress",
      "Agent execution made no verifiable progress within the retained bound.",
    );
  }
  return undefined;
}

function validUsage(usage: AgentRunExecutorValue["usage"]): boolean {
  return (
    nonNegativeInteger(usage.steps) &&
    Number.isFinite(usage.duration_seconds) &&
    usage.duration_seconds >= 0 &&
    nonNegativeInteger(usage.tool_calls) &&
    nonNegativeInteger(usage.retries) &&
    optionalNonNegativeInteger(usage.tokens) &&
    optionalNonNegativeFinite(usage.cost) &&
    optionalNonNegativeFinite(usage.tool_cost) &&
    optionalNonNegativeInteger(usage.repeated_action_fingerprints) &&
    optionalNonNegativeInteger(usage.no_progress_iterations)
  );
}

function exceedsOptional(
  actual: number | undefined,
  maximum: number | undefined,
): boolean {
  return maximum !== undefined && (actual === undefined || actual > maximum);
}

function runtimeFailure(
  failureClass: AgentRunFailureClass,
  code: AgentRunFailure["code"],
  message: string,
  retryable = false,
  evidence: readonly string[] = [],
): AgentRunFailure {
  return {
    class: failureClass,
    code,
    message,
    retryable,
    evidence: [...evidence],
  };
}

function terminalStateForFailure(
  failureValue: AgentRunFailure,
): "failed" | "cancelled" | "timed_out" | "blocked" {
  if (failureValue.code === "cancelled") return "cancelled";
  if (failureValue.code === "timed_out") return "timed_out";
  if (
    failureValue.code === "authorization_denied" ||
    failureValue.class === "policy"
  ) {
    return "blocked";
  }
  return "failed";
}

function terminalEventForState(
  state: "failed" | "cancelled" | "timed_out" | "blocked",
): AgentRunEvent["type"] {
  switch (state) {
    case "failed":
      return "run_failed";
    case "cancelled":
      return "run_cancelled";
    case "timed_out":
      return "run_timed_out";
    case "blocked":
      return "run_blocked";
  }
}

function outcomeForState(
  state: "failed" | "cancelled" | "timed_out" | "blocked",
): AgentRunResult["outcome"] {
  return state;
}

function usageFromSnapshot(snapshot: AgentRunSnapshot): AgentRunResult["usage"] {
  const usage = snapshot.consumed_budgets;
  return {
    steps: usage.steps,
    duration_seconds: usage.duration_seconds,
    tool_calls: usage.tool_calls,
    retries: usage.retries,
    ...(usage.tokens === undefined ? {} : { tokens: usage.tokens }),
    ...(usage.cost === undefined ? {} : { cost: usage.cost }),
    ...(usage.tool_cost === undefined ? {} : { tool_cost: usage.tool_cost }),
  };
}

function retainedResolvedVersions(
  start: AgentRunStartRequest,
  observation?: AgentRunExecutorValue,
): Readonly<Record<string, string>> {
  const retained: Record<string, string> = {
    agent: `${start.agent.id}@${start.agent.version}`,
    policy: start.policy_version,
  };
  for (const [key, version] of Object.entries(
    observation?.resolved_versions ?? {},
  )) {
    if (
      key !== "agent" &&
      key !== "policy" &&
      isExactVersionPin(version)
    ) {
      retained[key] = version;
    }
  }
  return retained;
}

function observedVersionEvidence(
  observation?: AgentRunExecutorValue,
): string[] {
  return Object.entries(observation?.resolved_versions ?? {}).map(
    ([key, version]) => `observed-version:${key}=${version}`,
  );
}

function authorizationForStart(
  request: AgentRunStartRequest,
): WorkspaceAuthorizationRequest {
  return Object.freeze({
    operation_id: request.operation_id,
    context: request.workspace_context,
    purpose: request.purpose,
    consequence_class: request.consequence_class,
    required_permissions: Object.freeze(["agent:execute"]),
    resource_refs: Object.freeze([
      `workspace:${request.workspace_id}`,
      `agent:${request.agent.id}@${request.agent.version}`,
      ...(request.allowed_skills ?? []).map(
        (skill) => `skill:${skill.id}@${skill.version}`,
      ),
      ...(request.allowed_tools ?? []).map(
        (tool) => `tool:${tool.id}@${tool.version}`,
      ),
      ...inputResourceRefs(request.input),
    ]),
  });
}

/**
 * Treat explicitly named input references as authority-bearing resources.
 * Nested objects are supported so an Agent cannot hide a resource reference
 * below a wrapper object and bypass the retained authorization decision.
 */
function inputResourceRefs(input: JsonObject): string[] {
  const references: string[] = [];

  function collect(value: unknown, key?: string): void {
    if (key?.endsWith("_ref") && typeof value === "string" && value.trim()) {
      references.push(`input:${value}`);
      return;
    }
    if (key?.endsWith("_refs") && Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string" && entry.trim()) {
          references.push(`input:${entry}`);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        collect(child, childKey);
      }
    }
  }

  collect(input);
  return unique(references);
}

function authorizationCovers(
  authorization: WorkspaceAuthorization,
  request: WorkspaceAuthorizationRequest,
): boolean {
  if (authorization.policy_version !== request.context.policy_version) {
    return false;
  }
  const effectivePermissions = new Set(authorization.effective_permissions);
  const authorizedResources = new Set(authorization.authorized_resource_refs);
  return (
    request.required_permissions.every((permission) =>
      effectivePermissions.has(permission),
    ) &&
    request.resource_refs.every((resource) => authorizedResources.has(resource))
  );
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isSemanticVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isExactVersionPin(value: string): boolean {
  return (
    isSemanticVersion(value) ||
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      value,
    )
  );
}

function nonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function optionalNonNegativeInteger(value: number | undefined): boolean {
  return value === undefined || nonNegativeInteger(value);
}

function optionalPositiveInteger(value: number | undefined): boolean {
  return value === undefined || positiveInteger(value);
}

function optionalNonNegativeFinite(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function success<Value>(value: Value): AgentRuntimeResult<Value> {
  return Object.freeze({ ok: true, value });
}

function failure<Value>(failureValue: AgentRunFailure): AgentRuntimeResult<Value> {
  return Object.freeze({ ok: false, failure: freezeFailure(failureValue) });
}

function freezeFailure(value: AgentRunFailure): AgentRunFailure {
  return Object.freeze({ ...value, evidence: Object.freeze([...value.evidence]) });
}

function freezeReference(runId: string, workspaceId: string): AgentRunReference {
  return Object.freeze({
    schema_version: "1.0.0",
    run_id: runId,
    workspace_id: workspaceId,
  });
}

function freezeSnapshot(value: AgentRunSnapshot): AgentRunSnapshot {
  return Object.freeze({
    ...value,
    consumed_budgets: Object.freeze({ ...value.consumed_budgets }),
    evidence: Object.freeze([...value.evidence]),
  });
}

function freezeRunResult(value: AgentRunResult): AgentRunResult {
  return immutableCopy(value);
}

function scopedKey(workspaceId: string, key: string): string {
  return `${workspaceId}\u0000${key}`;
}

function commandScopedKey(
  kind: "approve" | "resume" | "cancel",
  workspaceId: string,
  runId: string,
  key: string,
): string {
  return `${kind}\u0000${workspaceId}\u0000${runId}\u0000${key}`;
}

function executionScopedKey(
  workspaceId: string,
  runId: string,
  key: string,
): string {
  return `execute\u0000${workspaceId}\u0000${runId}\u0000${key}`;
}

function stableFingerprint(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function invalidRequest(message: string): AgentRunFailure {
  return {
    class: "orchestration",
    code: "invalid_request",
    message,
    retryable: false,
    evidence: [],
  };
}

function idempotencyConflict(kind: string, key: string): AgentRunFailure {
  return {
    class: "orchestration",
    code: "idempotency_conflict",
    message: `${kind} idempotency key ${key} was already used for different input`,
    retryable: false,
    evidence: [],
  };
}

function staleRevision(expected: number, actual: number): AgentRunFailure {
  return {
    class: "orchestration",
    code: "stale_revision",
    message: `expected revision ${expected}, current revision is ${actual}`,
    retryable: true,
    evidence: [],
  };
}

function invalidTransition(state: AgentRunState, operation: string): AgentRunFailure {
  return invalidRequest(`${operation} is not valid from ${state}`);
}

function workspaceDenied(workspaceId: string): AgentRunFailure {
  return {
    class: "policy",
    code: "authorization_denied",
    message: `access from Workspace ${workspaceId} is denied`,
    retryable: false,
    evidence: [],
  };
}

function authorizationDenied(reason: string): AgentRunFailure {
  return {
    class: "policy",
    code: "authorization_denied",
    message: "Workspace authorization denied.",
    retryable: false,
    evidence: [`authorization:${reason}`],
  };
}
