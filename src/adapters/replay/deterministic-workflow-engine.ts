import {
  workflowRequestDigest,
  type ApproveRequest,
  type CancelRequest,
  type DescriptorRequest,
  type HumanTask,
  type InspectRequest,
  type ResumeRequest,
  type SignalRequest,
  type StartRequest,
  type WorkflowDefinition,
  type WorkflowEngine,
  type WorkflowEngineFailure,
  type WorkflowEngineOperation,
  type WorkflowEngineOperationMap,
  type WorkflowEngineProvider,
  type WorkflowEngineRequest,
  type WorkflowEngineResult,
  type WorkflowHistoryEntry,
  type WorkflowInstanceIdentity,
  type WorkflowRuntimeState,
} from "../../workflow-engine/public.js";
import type {
  DeterministicRuleEngine,
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

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: WorkflowEngineProvider;
  definitions: ReadonlyMap<string, WorkflowDefinition>;
  /** SPEC-304 §2: guard evaluation is delegated to SPEC-104's rule engine — this adapter never evaluates domain policy itself. */
  rules?: DeterministicRuleEngine;
}>;

type InstanceRecord = Readonly<{
  definition: WorkflowDefinition;
  runtime: WorkflowRuntimeState;
  cancelled: boolean;
}>;

type OperationRecord<Operation extends WorkflowEngineOperation> = Readonly<{
  digest: string;
  result: WorkflowEngineResult<Operation>;
}>;

const PERMISSION_BY_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  descriptor: "workflow:read",
  start: "workflow:start",
  signal: "workflow:signal",
  approve: "workflow:approve",
  cancel: "workflow:cancel",
  inspect: "workflow:read",
  resume: "workflow:resume",
});

function definitionKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function instanceKey(instance: WorkflowInstanceIdentity): string {
  return `${instance.workflow_id}:${instance.instance_id}`;
}

/**
 * SPEC-304 §9's required "deterministic clock/queue/action substitute":
 * proves start/signal/approve/cancel/inspect/resume lifecycle, idempotent
 * transitions, duplicate-delivery safety, cancellation, authorization, and
 * history immutability without a real durable store or scheduler — mirrors
 * `DeterministicExecutionEngine`'s role for SPEC-504. Never throws for a
 * domain-level failure — a normal `WorkflowEngineResult` with `ok:false`
 * (ADR-016 §4's pattern, restated here for a different seam).
 */
export class DeterministicWorkflowEngine implements WorkflowEngine {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: WorkflowEngineProvider;
  readonly #definitions: ReadonlyMap<string, WorkflowDefinition>;
  readonly #rules: DeterministicRuleEngine | undefined;
  readonly #instances = new Map<string, InstanceRecord>();
  readonly #operations = new Map<string, OperationRecord<WorkflowEngineOperation>>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = dependencies.provider;
    this.#definitions = dependencies.definitions;
    this.#rules = dependencies.rules;
  }

  async descriptor(request: DescriptorRequest): Promise<WorkflowEngineResult<"descriptor">> {
    const authorized = await this.#authorize(request, "descriptor");
    if (!authorized.ok) return this.#deny(request, "descriptor", authorized.failure);
    return this.#envelope(request, "descriptor", {
      ok: true,
      value: {
        supported_contract_versions: ["1.0.0"],
        supported_operations: ["descriptor", "start", "signal", "approve", "cancel", "inspect", "resume"],
        deterministic: true,
        health: "healthy",
        capacity: {},
      },
    });
  }

  async start(request: StartRequest): Promise<WorkflowEngineResult<"start">> {
    const authorized = await this.#authorize(request, "start");
    if (!authorized.ok) return this.#deny(request, "start", authorized.failure);

    const idempotencyResult = this.#checkIdempotency(request, "start");
    if (idempotencyResult !== undefined) return idempotencyResult;

    const definition = this.#definitions.get(definitionKey(request.payload.definition_ref.id, request.payload.definition_ref.version));
    if (definition === undefined) {
      return this.#recordAndReturn(request, "start", {
        ok: false,
        failure: unknownDefinitionFailure(request.payload.definition_ref.id, request.payload.definition_ref.version),
      });
    }

    const instance: WorkflowInstanceIdentity = { workflow_id: definition.id, instance_id: request.operationId };
    const runtime: WorkflowRuntimeState = {
      definition_ref: request.payload.definition_ref,
      workspace_id: request.workspace.workspace_id,
      correlation_id: request.payload.correlation_id,
      state: definition.initial_state,
      history: [{ from_state: null, to_state: definition.initial_state, trigger: "start", occurred_at: this.#clock.now().toISOString() }],
      pending_human_tasks: [],
      actor_id: request.payload.actor_id,
      input_refs: request.payload.input_refs,
      output_refs: [],
      deadline: definition.timeout_seconds !== undefined ? new Date(this.#clock.now().valueOf() + definition.timeout_seconds * 1000).toISOString() : null,
      failure_context: null,
    };
    this.#instances.set(instanceKey(instance), { definition, runtime, cancelled: false });

    return this.#recordAndReturn(request, "start", {
      ok: true,
      value: { instance, state: runtime.state, resolved_versions: { workflow: definitionKey(definition.id, definition.version) } },
    });
  }

  async signal(request: SignalRequest): Promise<WorkflowEngineResult<"signal">> {
    const authorized = await this.#authorize(request, "signal");
    if (!authorized.ok) return this.#deny(request, "signal", authorized.failure);

    const idempotencyResult = this.#checkIdempotency(request, "signal");
    if (idempotencyResult !== undefined) return idempotencyResult;

    const found = this.#requireInstance(request.payload.instance, request.workspace);
    if (!found.ok) return this.#recordAndReturn(request, "signal", found);
    const record = found.value;

    if (record.cancelled || record.definition.terminal_states.includes(record.runtime.state)) {
      return this.#recordAndReturn(request, "signal", {
        ok: false,
        failure: domainRejectionFailure(`Instance "${instanceKey(request.payload.instance)}" is already terminal or cancelled.`),
      });
    }

    const transition = record.definition.transitions.find(
      (candidate) => candidate.from_state === record.runtime.state && candidate.trigger === request.payload.trigger,
    );
    if (transition === undefined) {
      return this.#recordAndReturn(request, "signal", {
        ok: false,
        failure: domainRejectionFailure(`No transition from state "${record.runtime.state}" on trigger "${request.payload.trigger}".`),
      });
    }

    if (transition.guard_rule_ref !== undefined) {
      const guardPassed = await this.#evaluateGuard(request, transition.guard_rule_ref, record.runtime);
      if (!guardPassed.ok) return this.#recordAndReturn(request, "signal", guardPassed);
      if (!guardPassed.value) {
        return this.#recordAndReturn(request, "signal", {
          ok: false,
          failure: domainRejectionFailure(`Guard rule "${transition.guard_rule_ref.id}@${transition.guard_rule_ref.version}" did not permit this transition.`),
        });
      }
    }

    const historyEntry: WorkflowHistoryEntry = {
      from_state: record.runtime.state,
      to_state: transition.to_state,
      trigger: request.payload.trigger,
      occurred_at: this.#clock.now().toISOString(),
    };
    const updatedRuntime: WorkflowRuntimeState = {
      ...record.runtime,
      state: transition.to_state,
      history: [...record.runtime.history, historyEntry],
    };
    this.#instances.set(instanceKey(request.payload.instance), { ...record, runtime: updatedRuntime });

    return this.#recordAndReturn(request, "signal", { ok: true, value: { state: transition.to_state, transitioned: true } });
  }

  async approve(request: ApproveRequest): Promise<WorkflowEngineResult<"approve">> {
    const authorized = await this.#authorize(request, "approve");
    if (!authorized.ok) return this.#deny(request, "approve", authorized.failure);

    const idempotencyResult = this.#checkIdempotency(request, "approve");
    if (idempotencyResult !== undefined) return idempotencyResult;

    const found = this.#requireInstance(request.payload.instance, request.workspace);
    if (!found.ok) return this.#recordAndReturn(request, "approve", found);
    const record = found.value;

    const task = record.runtime.pending_human_tasks.find((candidate) => candidate.task_id === request.payload.task_id);
    if (task === undefined) {
      return this.#recordAndReturn(request, "approve", {
        ok: false,
        failure: domainRejectionFailure(`No pending human task "${request.payload.task_id}" on this instance.`),
      });
    }
    if (!task.allowed_outcomes.includes(request.payload.outcome)) {
      return this.#recordAndReturn(request, "approve", {
        ok: false,
        failure: domainRejectionFailure(`Outcome "${request.payload.outcome}" is not among task "${task.task_id}"'s allowed outcomes.`),
      });
    }

    const updatedRuntime: WorkflowRuntimeState = {
      ...record.runtime,
      pending_human_tasks: record.runtime.pending_human_tasks.filter((candidate) => candidate.task_id !== task.task_id),
    };
    this.#instances.set(instanceKey(request.payload.instance), { ...record, runtime: updatedRuntime });

    return this.#recordAndReturn(request, "approve", { ok: true, value: { state: updatedRuntime.state, task_resolved: true } });
  }

  async cancel(request: CancelRequest): Promise<WorkflowEngineResult<"cancel">> {
    const authorized = await this.#authorize(request, "cancel");
    if (!authorized.ok) return this.#deny(request, "cancel", authorized.failure);

    const found = this.#requireInstance(request.payload.instance, request.workspace);
    if (!found.ok) return this.#envelope(request, "cancel", found);
    const record = found.value;

    if (record.cancelled || record.definition.terminal_states.includes(record.runtime.state)) {
      return this.#envelope(request, "cancel", { ok: true, value: { accepted: false, already_terminal: true } });
    }

    this.#instances.set(instanceKey(request.payload.instance), { ...record, cancelled: true });
    return this.#envelope(request, "cancel", { ok: true, value: { accepted: true, already_terminal: false } });
  }

  async inspect(request: InspectRequest): Promise<WorkflowEngineResult<"inspect">> {
    const authorized = await this.#authorize(request, "inspect");
    if (!authorized.ok) return this.#deny(request, "inspect", authorized.failure);

    const found = this.#requireInstance(request.payload.instance, request.workspace);
    if (!found.ok) return this.#envelope(request, "inspect", found);
    return this.#envelope(request, "inspect", { ok: true, value: { runtime_state: found.value.runtime } });
  }

  async resume(request: ResumeRequest): Promise<WorkflowEngineResult<"resume">> {
    const authorized = await this.#authorize(request, "resume");
    if (!authorized.ok) return this.#deny(request, "resume", authorized.failure);

    const found = this.#requireInstance(request.payload.instance, request.workspace);
    if (!found.ok) return this.#envelope(request, "resume", found);
    // §5: "recovery resumes from durable state" — this in-memory adapter
    // proves the contract shape: resuming an already-loaded instance
    // reports its current state without mutating it. Real durability
    // (surviving a process restart) is a separate adapter's scope.
    return this.#envelope(request, "resume", { ok: true, value: { state: found.value.runtime.state, resumed: true } });
  }

  async #evaluateGuard(
    request: SignalRequest,
    guardRuleRef: Readonly<{ id: string; version: string }>,
    runtime: WorkflowRuntimeState,
  ): Promise<Readonly<{ ok: true; value: boolean }> | Readonly<{ ok: false; failure: WorkflowEngineFailure }>> {
    if (this.#rules === undefined) {
      return {
        ok: false,
        failure: orchestrationDefectFailure(`Transition declares guard_rule_ref "${guardRuleRef.id}@${guardRuleRef.version}" but no rule engine was configured.`),
      };
    }
    const evaluation = await this.#rules.evaluate({
      evaluation_id: `${request.operationId}:guard`,
      context: request.workspace,
      rule_set: guardRuleRef,
      effective_at: this.#clock.now().toISOString(),
      facts: { workflow: { state: runtime.state, correlation_id: runtime.correlation_id } } as JsonObject,
      fact_provenance: [runtime.correlation_id],
      requested_decisions: ["workflow_transition_guard"],
      trace_level: "summary",
    });
    if (!evaluation.ok) {
      return { ok: false, failure: dependencyFailureFrom(evaluation.failure.code, evaluation.failure.message, evaluation.failure.retryable) };
    }
    return { ok: true, value: evaluation.value.outcome === "satisfied" };
  }

  #requireInstance(
    instance: WorkflowInstanceIdentity,
    workspace: WorkspaceContext,
  ): Readonly<{ ok: true; value: InstanceRecord }> | Readonly<{ ok: false; failure: WorkflowEngineFailure }> {
    const record = this.#instances.get(instanceKey(instance));
    if (record === undefined || record.runtime.workspace_id !== workspace.workspace_id) {
      return { ok: false, failure: unknownInstanceFailure(instance) };
    }
    return { ok: true, value: record };
  }

  /** Returns a cached result for a previously-seen idempotency key, or `undefined` if this is a new request. */
  #checkIdempotency<Operation extends WorkflowEngineOperation>(
    request: WorkflowEngineRequest<Operation>,
    operation: Operation,
  ): WorkflowEngineResult<Operation> | undefined {
    const key = `${request.workspace.workspace_id}:${operation}:${request.idempotency.key}`;
    const digest = workflowRequestDigest(request);
    const existing = this.#operations.get(key);
    if (existing === undefined) return undefined;
    if (existing.digest !== digest) {
      return this.#envelope(request, operation, {
        ok: false,
        failure: {
          code: "idempotency_conflict",
          retryable: false,
          responsible_domain: "caller",
          message: "A different request was already retained for this idempotency key.",
          details: {},
          diagnostic_evidence_refs: [],
        },
      });
    }
    return existing.result as WorkflowEngineResult<Operation>;
  }

  #recordAndReturn<Operation extends WorkflowEngineOperation>(
    request: WorkflowEngineRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: WorkflowEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: WorkflowEngineFailure }>,
  ): WorkflowEngineResult<Operation> {
    const result = this.#envelope(request, operation, outcome);
    const key = `${request.workspace.workspace_id}:${operation}:${request.idempotency.key}`;
    this.#operations.set(key, { digest: workflowRequestDigest(request), result: result as WorkflowEngineResult<WorkflowEngineOperation> });
    return result;
  }

  #envelope<Operation extends WorkflowEngineOperation>(
    request: WorkflowEngineRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: WorkflowEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: WorkflowEngineFailure }>,
  ): WorkflowEngineResult<Operation> {
    const now = this.#clock.now();
    const envelope = {
      operation,
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
      warnings: [],
      evidence: [],
    };
    return { ...envelope, ...outcome } as WorkflowEngineResult<Operation>;
  }

  #deny<Operation extends WorkflowEngineOperation>(
    request: WorkflowEngineRequest<Operation>,
    operation: Operation,
    authorizationFailure: WorkspaceAuthorizationFailure,
  ): WorkflowEngineResult<Operation> {
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

  async #authorize(
    request: Readonly<{ workspace: WorkspaceContext; operationId: string }>,
    operation: string,
  ): Promise<WorkspaceAuthorizationResult> {
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operationId,
      context: request.workspace,
      purpose: `workflow-engine:${operation}`,
      consequence_class: "reversible",
      required_permissions: [PERMISSION_BY_OPERATION[operation] ?? "workflow:signal"],
      resource_refs: [`workspace:${request.workspace.workspace_id}`],
    };
    return this.#authorizer.authorize(authorizationRequest);
  }
}

function unknownDefinitionFailure(id: string, version: string): WorkflowEngineFailure {
  return {
    code: "unknown_definition",
    retryable: false,
    responsible_domain: "caller",
    message: `No registered workflow definition "${id}@${version}".`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function unknownInstanceFailure(instance: WorkflowInstanceIdentity): WorkflowEngineFailure {
  return {
    code: "unknown_instance",
    retryable: false,
    responsible_domain: "caller",
    message: `No instance "${instanceKey(instance)}" in this Workspace.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function domainRejectionFailure(message: string): WorkflowEngineFailure {
  return { code: "domain_rejection", retryable: false, responsible_domain: "policy", message, details: {}, diagnostic_evidence_refs: [] };
}

function orchestrationDefectFailure(message: string): WorkflowEngineFailure {
  return { code: "orchestration_defect", retryable: false, responsible_domain: "engine", message, details: {}, diagnostic_evidence_refs: [] };
}

function dependencyFailureFrom(code: string, message: string, retryable: boolean): WorkflowEngineFailure {
  return {
    code: retryable ? "transient_dependency_failure" : "permanent_dependency_failure",
    retryable,
    responsible_domain: "dependency",
    message: `Guard rule evaluation failed (${code}): ${message}`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}
