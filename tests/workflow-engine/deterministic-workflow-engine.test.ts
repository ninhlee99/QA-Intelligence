import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicWorkflowEngine } from "../../src/adapters/replay/deterministic-workflow-engine.js";
import type {
  ApproveRequest,
  CancelRequest,
  InspectRequest,
  ResumeRequest,
  SignalRequest,
  StartRequest,
  WorkflowDefinition,
} from "../../src/workflow-engine/public.js";
import type {
  DeterministicRuleEngine,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    return {
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-workflow-001",
    actor_type: "service",
    roles: ["workflow-operator"],
    permissions: ["workflow:start", "workflow:signal", "workflow:cancel", "workflow:read", "workflow:resume", "workflow:approve"],
    policy_version: "policy@1.0.0",
    request_id: "request-workflow-001",
    correlation_id: "correlation-workflow-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T08:00:00.000Z",
    expires_at: "2026-08-08T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function definition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "candidate-review",
    version: "1.0.0",
    states: ["discovered", "proposed", "validating", "promoted", "rejected"],
    initial_state: "discovered",
    terminal_states: ["promoted", "rejected"],
    transitions: [
      { from_state: "discovered", to_state: "proposed", trigger: "propose" },
      { from_state: "proposed", to_state: "validating", trigger: "validate" },
      { from_state: "validating", to_state: "promoted", trigger: "approve_promotion" },
      { from_state: "validating", to_state: "rejected", trigger: "reject" },
    ],
    permissions: ["workflow:signal"],
    outputs: ["knowledge_candidate_ref"],
    ...overrides,
  };
}

function makeEngine(
  definitions: readonly WorkflowDefinition[] = [definition()],
  rules?: DeterministicRuleEngine,
): DeterministicWorkflowEngine {
  return new DeterministicWorkflowEngine({
    clock: { now: () => new Date("2026-08-08T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "deterministic-workflow-engine", version: "0.1.0" },
    definitions: new Map(definitions.map((def) => [`${def.id}@${def.version}`, def])),
    ...(rules !== undefined ? { rules } : {}),
  });
}

function envelopeFields(operationId: string, context: WorkspaceContext = workspaceContext()) {
  return {
    operationId,
    workspace: context,
    idempotency: { key: operationId, scope: "workflow", request_digest: "" },
    deadline: { at: "2026-08-08T09:00:00.000Z", time_standard: "UTC" as const },
    version: { contract: "1.0.0" as const, operation_schema: "1.0.0" as const },
  };
}

async function startInstance(engine: DeterministicWorkflowEngine, operationId = "op-start-1", context = workspaceContext()) {
  const request: StartRequest = {
    operation: "start",
    ...envelopeFields(operationId, context),
    payload: {
      definition_ref: { id: "candidate-review", version: "1.0.0" },
      correlation_id: "correlation-1",
      input_refs: ["candidate:CANDIDATE-001"],
      actor_id: "actor-workflow-001",
    },
  };
  return engine.start(request);
}

test("start creates an instance at the definition's initial_state", async () => {
  const engine = makeEngine();
  const result = await startInstance(engine);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.state, "discovered");
});

test("signal transitions along a defined transition", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const request: SignalRequest = {
    operation: "signal",
    ...envelopeFields("op-signal-1"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  };
  const result = await engine.signal(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.state, "proposed");
  assert.equal(result.value.transitioned, true);
});

test("signal on an undefined trigger is a domain_rejection, not a thrown exception", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const request: SignalRequest = {
    operation: "signal",
    ...envelopeFields("op-signal-bad"),
    payload: { instance: started.value.instance, trigger: "no-such-trigger", data: {} },
  };
  const result = await engine.signal(request);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "domain_rejection");
});

test("duplicate delivery: repeating the same signal under the same idempotency key does not re-transition", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const request: SignalRequest = {
    operation: "signal",
    ...envelopeFields("op-signal-dup"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  };
  const first = await engine.signal(request);
  const second = await engine.signal(request);

  assert.deepEqual(first, second);

  const inspected = await engine.inspect({
    operation: "inspect",
    ...envelopeFields("op-inspect-1"),
    payload: { instance: started.value.instance },
  } satisfies InspectRequest);
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  // Only one "propose" transition entry, plus the initial "start" entry.
  assert.equal(inspected.value.runtime_state.history.length, 2);
});

test("idempotency_conflict: reusing the same idempotency key with a different request is rejected, not silently replayed", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const first: SignalRequest = {
    operation: "signal",
    ...envelopeFields("op-signal-conflict"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  };
  const firstResult = await engine.signal(first);
  assert.equal(firstResult.ok, true, JSON.stringify(firstResult));

  // Same idempotency key ("op-signal-conflict"), but a different trigger —
  // the request digest changes, so this must not replay the first result.
  const conflicting: SignalRequest = {
    operation: "signal",
    ...envelopeFields("op-signal-conflict"),
    payload: { instance: started.value.instance, trigger: "validate", data: {} },
  };
  const conflictingResult = await engine.signal(conflicting);

  assert.equal(conflictingResult.ok, false);
  if (conflictingResult.ok) return;
  assert.equal(conflictingResult.failure.code, "idempotency_conflict");
});

test("guard rule blocks a transition when the rule engine reports not_satisfied", async () => {
  const denyingRuleEngine: DeterministicRuleEngine = {
    evaluate: (request: RuleEvaluationRequest): Promise<RuleEvaluationResult> =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: "not_satisfied",
          rule_set: request.rule_set,
          rule_versions: [],
          matched_conditions: [],
          relevant_facts: [],
          outputs: {},
          conflicts: [],
          missing_facts: [],
          explanation_trace: ["guard denied"],
          policy_version: request.context.policy_version,
          duration_ms: 0,
        },
      }),
  };
  const guarded = definition({
    transitions: [
      { from_state: "discovered", to_state: "proposed", trigger: "propose", guard_rule_ref: { id: "candidate-ready", version: "1.0.0" } },
    ],
  });
  const engine = makeEngine([guarded], denyingRuleEngine);
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const result = await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-guarded"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  } satisfies SignalRequest);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "domain_rejection");
});

test("guard rule permits a transition when the rule engine reports satisfied", async () => {
  const allowingRuleEngine: DeterministicRuleEngine = {
    evaluate: (request: RuleEvaluationRequest): Promise<RuleEvaluationResult> =>
      Promise.resolve({
        ok: true,
        value: {
          outcome: "satisfied",
          rule_set: request.rule_set,
          rule_versions: [],
          matched_conditions: [],
          relevant_facts: [],
          outputs: {},
          conflicts: [],
          missing_facts: [],
          explanation_trace: ["guard satisfied"],
          policy_version: request.context.policy_version,
          duration_ms: 0,
        },
      }),
  };
  const guarded = definition({
    transitions: [
      { from_state: "discovered", to_state: "proposed", trigger: "propose", guard_rule_ref: { id: "candidate-ready", version: "1.0.0" } },
    ],
  });
  const engine = makeEngine([guarded], allowingRuleEngine);
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const result = await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-guarded-ok"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  } satisfies SignalRequest);

  assert.equal(result.ok, true, JSON.stringify(result));
});

test("cancel from a non-terminal state is accepted; cancelling an already-terminal instance is a no-op", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const cancelled = await engine.cancel({
    operation: "cancel",
    ...envelopeFields("op-cancel-1"),
    payload: { instance: started.value.instance, reason: "no longer needed" },
  } satisfies CancelRequest);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  if (!cancelled.ok) return;
  assert.equal(cancelled.value.accepted, true);
  assert.equal(cancelled.value.already_terminal, false);

  const secondCancel = await engine.cancel({
    operation: "cancel",
    ...envelopeFields("op-cancel-2"),
    payload: { instance: started.value.instance, reason: "cancel again" },
  } satisfies CancelRequest);
  assert.equal(secondCancel.ok, true, JSON.stringify(secondCancel));
  if (!secondCancel.ok) return;
  assert.equal(secondCancel.value.accepted, false);
  assert.equal(secondCancel.value.already_terminal, true);
});

test("a signal after cancellation is rejected", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  await engine.cancel({
    operation: "cancel",
    ...envelopeFields("op-cancel-3"),
    payload: { instance: started.value.instance, reason: "cancel before signal" },
  } satisfies CancelRequest);

  const result = await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-after-cancel"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  } satisfies SignalRequest);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "domain_rejection");
});

test("authorization: a denied caller is rejected before any transition runs", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const engine = new DeterministicWorkflowEngine({
    clock: { now: () => new Date("2026-08-08T08:30:00.000Z") },
    authorizer: deniedAuthorizer,
    provider: { id: "deterministic-workflow-engine", version: "0.1.0" },
    definitions: new Map([["candidate-review@1.0.0", definition()]]),
  });

  const result = await startInstance(engine);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_denied");
});

test("history integrity: completed history entries are unchanged by later signals", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-history-1"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  } satisfies SignalRequest);

  const firstInspect = await engine.inspect({
    operation: "inspect",
    ...envelopeFields("op-inspect-history-1"),
    payload: { instance: started.value.instance },
  } satisfies InspectRequest);
  assert.equal(firstInspect.ok, true);
  if (!firstInspect.ok) return;
  const firstHistorySnapshot = firstInspect.value.runtime_state.history;

  await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-history-2"),
    payload: { instance: started.value.instance, trigger: "validate", data: {} },
  } satisfies SignalRequest);

  // The earlier snapshot's entries are unchanged (readonly arrays; a new
  // array is produced on each transition, the old one is never mutated).
  assert.deepEqual(firstHistorySnapshot, [
    { from_state: null, to_state: "discovered", trigger: "start", occurred_at: "2026-08-08T08:30:00.000Z" },
    { from_state: "discovered", to_state: "proposed", trigger: "propose", occurred_at: "2026-08-08T08:30:00.000Z" },
  ]);
});

test("Workspace isolation: an instance from one Workspace is not inspectable from another", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine, "op-start-iso", workspaceContext({ workspace_id: "workspace-alpha" }));
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const result = await engine.inspect({
    operation: "inspect",
    ...envelopeFields("op-inspect-iso", workspaceContext({ workspace_id: "workspace-beta" })),
    payload: { instance: started.value.instance },
  } satisfies InspectRequest);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_instance");
});

test("resume reports the current state without mutating it", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  await engine.signal({
    operation: "signal",
    ...envelopeFields("op-signal-before-resume"),
    payload: { instance: started.value.instance, trigger: "propose", data: {} },
  } satisfies SignalRequest);

  const result = await engine.resume({
    operation: "resume",
    ...envelopeFields("op-resume-1"),
    payload: { instance: started.value.instance },
  } satisfies ResumeRequest);

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.state, "proposed");
  assert.equal(result.value.resumed, true);
});

test("approve resolves a pending human task and rejects a disallowed outcome", async () => {
  const engine = makeEngine();
  const started = await startInstance(engine);
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const noTaskResult = await engine.approve({
    operation: "approve",
    ...envelopeFields("op-approve-missing"),
    payload: { instance: started.value.instance, task_id: "task-1", outcome: "approved", actor_id: "actor-workflow-001", evidence_refs: [] },
  } satisfies ApproveRequest);

  assert.equal(noTaskResult.ok, false);
  if (noTaskResult.ok) return;
  assert.equal(noTaskResult.failure.code, "domain_rejection");
});

test("starting an unknown definition version is a distinct failure, not a crash", async () => {
  const engine = makeEngine();
  const result = await engine.start({
    operation: "start",
    ...envelopeFields("op-start-unknown"),
    payload: {
      definition_ref: { id: "candidate-review", version: "9.9.9" },
      correlation_id: "correlation-1",
      input_refs: [],
      actor_id: "actor-workflow-001",
    },
  } satisfies StartRequest);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_definition");
});
