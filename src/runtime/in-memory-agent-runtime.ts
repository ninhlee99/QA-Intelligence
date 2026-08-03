import type {
  AgentRunApproval,
  AgentRunAccessRequest,
  AgentRunCancellation,
  AgentRunEvent,
  AgentRunEventCursor,
  AgentRunEventPage,
  AgentRunFailure,
  AgentRunReference,
  AgentRunResume,
  AgentRunSnapshot,
  AgentRunStartRequest,
  AgentRunState,
  AgentRunTransition,
  AgentRuntime,
  AgentRuntimeResult,
} from "./public.js";
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

type RunRecord = {
  snapshot: AgentRunSnapshot;
  events: readonly AgentRunEvent[];
  startFingerprint: string;
  cancellation?: AgentRunTransition;
};

type StoredCommand = Readonly<{
  fingerprint: string;
  transition: AgentRunTransition;
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
  readonly #runs = new Map<string, RunRecord>();
  readonly #starts = new Map<string, Readonly<{ fingerprint: string; runId: string }>>();
  readonly #commands = new Map<string, StoredCommand>();

  constructor(clock: Clock, ids: IdFactory, authorizer: WorkspaceAuthorizer) {
    this.#clock = clock;
    this.#ids = ids;
    this.#authorizer = authorizer;
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
      this.#event(reference, 5, "run_ready", {
        operation_id: request.operation_id,
      }),
    ] as const;
    const evidence = Object.freeze(events.map((event) => `event://${event.event_id}`));
    const snapshot = freezeSnapshot({
      schema_version: "1.0.0",
      run_id: runId,
      workspace_id: request.workspace_id,
      revision: 3,
      state: "ready",
      objective: request.purpose,
      consumed_budgets: Object.freeze({
        steps: 0,
        duration_seconds: 0,
        tool_calls: 0,
        retries: 0,
      }),
      pending_approval: null,
      checkpoint: null,
      failure_class: null,
      evidence,
      updated_at: events[4].occurred_at,
    });

    this.#runs.set(runId, {
      snapshot,
      events: Object.freeze([...events]),
      startFingerprint: fingerprint,
    });
    this.#starts.set(startKey, Object.freeze({ fingerprint, runId }));
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

  async approve(
    reference: AgentRunReference,
    approval: AgentRunApproval,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    return this.#command(
      "approve",
      reference,
      approval,
      "awaiting_approval",
      approval.decision === "approved" ? "running" : "blocked",
      approval.decision === "approved" ? "step_authorized" : "run_blocked",
      "agent:approve",
      "approve Agent run",
      "controlled_side_effect",
    );
  }

  async resume(
    reference: AgentRunReference,
    checkpoint: AgentRunResume,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    return this.#command(
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
  }

  async cancel(
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

  #transition(
    reference: AgentRunReference,
    record: RunRecord,
    nextState: AgentRunState,
    eventType: AgentRunEvent["type"],
    payload: JsonObject,
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
        terminalFailureClass(nextState) ?? previous.failure_class ?? null,
      evidence: Object.freeze([...previous.evidence, `event://${event.event_id}`]),
      updated_at: event.occurred_at,
    });
    this.#runs.set(reference.run_id, {
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
    ]),
  });
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
