import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import type { AgentRunStartRequest } from "../../src/runtime/public.js";
import type { AgentRunAccessRequest } from "../../src/runtime/public.js";
import {
  InMemoryAgentRuntime,
  type Clock,
  type IdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

class FixedClock implements Clock {
  readonly #time: Date;

  constructor(time: string) {
    this.#time = new Date(time);
  }

  now(): Date {
    return new Date(this.#time);
  }
}

class SequenceIdFactory implements IdFactory {
  #run = 0;
  #event = 0;

  next(kind: "run" | "event"): string {
    if (kind === "run") {
      this.#run += 1;
      return `run-${this.#run}`;
    }
    this.#event += 1;
    return `event-${this.#event}`;
  }
}

class AuthorizerStub implements WorkspaceAuthorizer {
  readonly requests: WorkspaceAuthorizationRequest[] = [];
  #result: WorkspaceAuthorizationResult | undefined;

  constructor(result?: WorkspaceAuthorizationResult) {
    this.#result = result;
  }

  setResult(result: WorkspaceAuthorizationResult | undefined): void {
    this.#result = result;
  }

  authorize(
    request: WorkspaceAuthorizationRequest,
  ): Promise<WorkspaceAuthorizationResult> {
    this.requests.push(request);
    return Promise.resolve(
      this.#result ?? {
        ok: true,
        value: {
          policy_version: request.context.policy_version,
          effective_permissions: [...request.required_permissions],
          authorized_resource_refs: [...request.resource_refs],
          decision_evidence: ["authorization:allow"],
        },
      },
    );
  }
}

function workspaceContext(
  overrides: Partial<WorkspaceContext> = {},
): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    actor_type: "human",
    roles: ["agent-operator"],
    permissions: ["agent:execute"],
    policy_version: "policy-1",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-02T23:00:00.000Z",
    expires_at: "2026-08-03T01:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function runtime(authorizer = new AuthorizerStub()): InMemoryAgentRuntime {
  return new InMemoryAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    authorizer,
  );
}

function startRequest(
  overrides: Partial<AgentRunStartRequest> = {},
): AgentRunStartRequest {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    workspace_context: workspaceContext(),
    agent: { id: "requirement-review-agent", version: "1.0.0" },
    purpose: "Review requirement REQ-1",
    consequence_class: "advisory",
    input: { requirement_ref: "REQ-1@1.0.0" },
    policy_version: "policy-1",
    budgets: {
      max_steps: 10,
      max_duration_seconds: 60,
      max_tool_calls: 5,
      max_retries: 1,
    },
    deadline: "2026-08-03T01:00:00.000Z",
    idempotency_key: "start-1",
    ...overrides,
  };
}

function accessRequest(
  overrides: Partial<AgentRunAccessRequest> = {},
): AgentRunAccessRequest {
  return {
    schema_version: "1.0.0",
    operation_id: "operation-access",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    policy_version: "policy-1",
    workspace_context: workspaceContext(),
    ...overrides,
  };
}

test("start creates the canonical ready snapshot and immutable ordered events", async () => {
  const authorizer = new AuthorizerStub();
  const agentRuntime = runtime(authorizer);

  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const inspected = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  assert.equal(inspected.value.state, "ready");
  assert.equal(inspected.value.revision, 3);
  assert.equal(inspected.value.objective, "Review requirement REQ-1");

  const page = await agentRuntime.streamEvents(started.value, {
    schema_version: "1.0.0",
    after_sequence: 0,
    limit: 10,
  }, accessRequest());
  assert.equal(page.ok, true);
  if (!page.ok) return;
  assert.deepEqual(
    page.value.events.map((event) => event.type),
    [
      "run_requested",
      "run_resolved",
      "authorization_requested",
      "authorization_granted",
      "run_ready",
    ],
  );
  assert.deepEqual(
    page.value.events.map((event) => event.sequence),
    [1, 2, 3, 4, 5],
  );
  assert.ok(page.value.events.every((event) => Object.isFrozen(event)));
  assert.ok(page.value.events.every((event) => Object.isFrozen(event.payload)));
  assert.equal(authorizer.requests.length, 3);
  assert.deepEqual(authorizer.requests[0]?.required_permissions, ["agent:execute"]);
  assert.deepEqual(authorizer.requests[1]?.required_permissions, ["agent:read"]);
  assert.deepEqual(authorizer.requests[2]?.required_permissions, ["agent:read"]);
});

test("duplicate start returns the same run without duplicating lifecycle events", async () => {
  const agentRuntime = runtime();

  const first = await agentRuntime.start(startRequest());
  const duplicate = await agentRuntime.start(startRequest());
  assert.deepEqual(duplicate, first);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const events = await agentRuntime.streamEvents(first.value, {
    schema_version: "1.0.0",
    after_sequence: 0,
    limit: 100,
  }, accessRequest());
  assert.equal(events.ok, true);
  if (!events.ok) return;
  assert.equal(events.value.events.length, 5);
});

test("same Workspace idempotency key rejects a different start payload", async () => {
  const agentRuntime = runtime();
  await agentRuntime.start(startRequest());

  const conflict = await agentRuntime.start(
    startRequest({ purpose: "A different objective" }),
  );

  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.failure.code, "idempotency_conflict");
});

test("start rejects invalid budgets, expired deadlines, and incomplete version references", async () => {
  const invalidRequests: readonly AgentRunStartRequest[] = [
    startRequest({
      budgets: {
        max_steps: 0,
        max_duration_seconds: 60,
        max_tool_calls: 5,
        max_retries: 1,
      },
    }),
    startRequest({ deadline: "2026-08-03T00:00:00.000Z" }),
    startRequest({ agent: { id: "requirement-review-agent", version: "latest" } }),
    startRequest({ schema_version: "2.0.0" as "1.0.0" }),
    startRequest({
      allowed_skills: [{ id: "assess-requirement-quality", version: "" }],
    }),
  ];

  for (const request of invalidRequests) {
    const result = await runtime().start(request);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "invalid_request");
  }
});

test("start accepts zero-valued consumable budgets", async () => {
  const result = await runtime().start(
    startRequest({
      budgets: {
        max_steps: 1,
        max_duration_seconds: 1,
        max_tool_calls: 0,
        max_retries: 0,
        max_tokens: 0,
        max_cost: 0,
        max_tool_cost: 0,
      },
    }),
  );

  assert.equal(result.ok, true);
});

test("start fails closed before creating a run when authorization is denied", async () => {
  const authorizer = new AuthorizerStub({
    ok: false,
    failure: {
      code: "insufficient_permission",
      message: "provider detail must not be exposed",
      retryable: false,
      evidence: ["secret://provider-token"],
    },
  });
  const agentRuntime = runtime(authorizer);

  const denied = await agentRuntime.start(startRequest());

  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.failure.class, "policy");
  assert.equal(denied.failure.code, "authorization_denied");
  assert.equal(denied.failure.message, "Workspace authorization denied.");
  assert.deepEqual(denied.failure.evidence, [
    "authorization:insufficient_permission",
  ]);
  assert.equal(authorizer.requests.length, 1);
});

test("start rejects an allow decision that omits required permission or resources", async () => {
  const authorizer = new AuthorizerStub({
    ok: true,
    value: {
      policy_version: "policy-1",
      effective_permissions: ["agent:execute"],
      authorized_resource_refs: [],
      decision_evidence: ["authorization:allow"],
    },
  });

  const result = await runtime(authorizer).start(startRequest());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "authorization_denied");
    assert.deepEqual(result.failure.evidence, [
      "authorization:incomplete_authorization",
    ]);
  }
});

test("read and control operations authorize before observing or mutating a run", async () => {
  const authorizer = new AuthorizerStub();
  const agentRuntime = runtime(authorizer);
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  authorizer.setResult({
    ok: false,
    failure: {
      code: "insufficient_permission",
      message: "denied",
      retryable: false,
      evidence: [],
    },
  });
  const deniedRead = await agentRuntime.inspect(started.value, accessRequest());
  const deniedCancel = await agentRuntime.cancel(started.value, {
    ...accessRequest({ operation_id: "denied-cancel" }),
    expected_revision: 3,
    reason: "must not mutate",
    evidence: ["evidence://denied-cancel"],
    idempotency_key: "denied-cancel",
  });
  assert.equal(deniedRead.ok, false);
  assert.equal(deniedCancel.ok, false);

  authorizer.setResult(undefined);
  const snapshot = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(snapshot.ok, true);
  if (snapshot.ok) assert.equal(snapshot.value.state, "ready");
  const events = await agentRuntime.streamEvents(
    started.value,
    { schema_version: "1.0.0", after_sequence: 0, limit: 100 },
    accessRequest(),
  );
  assert.equal(events.ok, true);
  if (events.ok) assert.equal(events.value.events.length, 5);
});

test("read access fails closed on context binding or incomplete authorization coverage", async () => {
  const authorizer = new AuthorizerStub();
  const agentRuntime = runtime(authorizer);
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const mismatched = await agentRuntime.inspect(
    started.value,
    accessRequest({ actor_id: "actor-2" }),
  );
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) {
    assert.deepEqual(mismatched.failure.evidence, [
      "authorization:context_binding_mismatch",
    ]);
  }

  authorizer.setResult({
    ok: true,
    value: {
      policy_version: "policy-1",
      effective_permissions: ["agent:read"],
      authorized_resource_refs: ["workspace:workspace-alpha"],
      decision_evidence: ["authorization:allow"],
    },
  });
  const incomplete = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(incomplete.ok, false);
  if (!incomplete.ok) {
    assert.deepEqual(incomplete.failure.evidence, [
      "authorization:incomplete_authorization",
    ]);
  }
});

test("start rejects workspace, actor, and policy mismatches before authorization", async () => {
  const mismatches: readonly AgentRunStartRequest[] = [
    startRequest({ workspace_id: "workspace-beta" }),
    startRequest({ actor_id: "actor-2" }),
    startRequest({ policy_version: "policy-2" }),
  ];

  for (const request of mismatches) {
    const authorizer = new AuthorizerStub();
    const result = await runtime(authorizer).start(request);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.class, "policy");
      assert.equal(result.failure.code, "authorization_denied");
    }
    assert.equal(authorizer.requests.length, 0);
  }
});

test("inspect and control deny a reference or command from another Workspace", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const deniedInspect = await agentRuntime.inspect(
    { ...started.value, workspace_id: "workspace-beta" },
    accessRequest(),
  );
  assert.equal(deniedInspect.ok, false);
  if (!deniedInspect.ok) {
    assert.equal(deniedInspect.failure.code, "authorization_denied");
  }

  const deniedCancel = await agentRuntime.cancel(started.value, {
    ...accessRequest({
      operation_id: "operation-cancel-cross-workspace",
      workspace_id: "workspace-beta",
      actor_id: "actor-2",
    }),
    expected_revision: 3,
    reason: "Unauthorized cancellation",
    evidence: ["evidence://cross-workspace-cancel"],
    idempotency_key: "cancel-cross-workspace",
  });
  assert.equal(deniedCancel.ok, false);
  if (!deniedCancel.ok) {
    assert.equal(deniedCancel.failure.code, "authorization_denied");
  }
});

test("cancel checks revision, transitions once, and is idempotent on retry", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const stale = await agentRuntime.cancel(started.value, {
    ...accessRequest({ operation_id: "operation-cancel-stale" }),
    expected_revision: 2,
    reason: "Stale request",
    evidence: ["evidence://stale-cancel"],
    idempotency_key: "cancel-stale",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.failure.code, "stale_revision");

  const cancellation = {
    ...accessRequest({ operation_id: "operation-cancel" }),
    expected_revision: 3,
    reason: "Operator stopped the run",
    evidence: ["evidence://operator-cancel"],
    idempotency_key: "cancel-1",
  } as const;
  const cancelled = await agentRuntime.cancel(started.value, cancellation);
  const duplicate = await agentRuntime.cancel(started.value, cancellation);
  assert.deepEqual(duplicate, cancelled);
  assert.equal(cancelled.ok, true);
  if (!cancelled.ok) return;
  assert.deepEqual(cancelled.value, {
    schema_version: "1.0.0",
    run_id: "run-1",
    workspace_id: "workspace-alpha",
    revision: 4,
    previous_state: "ready",
    state: "cancelled",
    event_id: "event-6",
  });

  const inspected = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  assert.equal(inspected.value.state, "cancelled");
  assert.equal(inspected.value.revision, 4);

  const events = await agentRuntime.streamEvents(started.value, {
    schema_version: "1.0.0",
    after_sequence: 0,
    limit: 100,
  }, accessRequest());
  assert.equal(events.ok, true);
  if (!events.ok) return;
  assert.equal(events.value.events.length, 6);
  assert.equal(events.value.events.at(-1)?.type, "run_cancelled");
});

test("the same command idempotency key is independent across runs", async () => {
  const agentRuntime = runtime();
  const first = await agentRuntime.start(startRequest());
  const second = await agentRuntime.start(
    startRequest({
      operation_id: "operation-2",
      idempotency_key: "start-2",
      purpose: "Review requirement REQ-2",
    }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const firstCancellation = await agentRuntime.cancel(first.value, {
    ...accessRequest({ operation_id: "cancel-operation-1" }),
    expected_revision: 3,
    reason: "Stop first",
    evidence: ["evidence://cancel-first"],
    idempotency_key: "shared-cancel-key",
  });
  const secondCancellation = await agentRuntime.cancel(second.value, {
    ...accessRequest({ operation_id: "cancel-operation-2" }),
    expected_revision: 3,
    reason: "Stop second",
    evidence: ["evidence://cancel-second"],
    idempotency_key: "shared-cancel-key",
  });

  assert.equal(firstCancellation.ok, true);
  assert.equal(secondCancellation.ok, true);
});

test("terminal runs are immutable and approve or resume reject non-canonical states", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const invalidApproval = await agentRuntime.approve(started.value, {
    ...accessRequest({ operation_id: "operation-approve" }),
    expected_revision: 3,
    approval_id: "approval-1",
    decision: "approved",
    reason: "Approved",
    evidence: ["evidence://approval-1"],
    idempotency_key: "approve-1",
  });
  assert.equal(invalidApproval.ok, false);
  if (!invalidApproval.ok) {
    assert.equal(invalidApproval.failure.code, "invalid_request");
  }

  const invalidResume = await agentRuntime.resume(started.value, {
    ...accessRequest({ operation_id: "operation-resume" }),
    expected_revision: 3,
    checkpoint: "checkpoint-1",
    reason: "Resume",
    idempotency_key: "resume-1",
  });
  assert.equal(invalidResume.ok, false);
  if (!invalidResume.ok) {
    assert.equal(invalidResume.failure.code, "invalid_request");
  }

  const cancelled = await agentRuntime.cancel(started.value, {
    ...accessRequest({ operation_id: "operation-cancel" }),
    expected_revision: 3,
    reason: "Stop",
    evidence: ["evidence://cancel"],
    idempotency_key: "cancel-1",
  });
  assert.equal(cancelled.ok, true);
  const secondCancellation = await agentRuntime.cancel(started.value, {
    ...accessRequest({ operation_id: "operation-cancel-again" }),
    expected_revision: 4,
    reason: "Stop again",
    evidence: ["evidence://cancel-again"],
    idempotency_key: "cancel-2",
  });
  assert.equal(secondCancellation.ok, false);
  if (!secondCancellation.ok) {
    assert.equal(secondCancellation.failure.code, "invalid_request");
  }

  const inspected = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  assert.equal(inspected.value.state, "cancelled");
  assert.equal(inspected.value.revision, 4);
});

test("event paging is bounded, ordered, resumable, and reports cursor gaps", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const first = await agentRuntime.streamEvents(started.value, {
    schema_version: "1.0.0",
    after_sequence: 0,
    limit: 2,
  }, accessRequest());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(first.value.events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(first.value.next_cursor, {
    schema_version: "1.0.0",
    after_sequence: 2,
    limit: 2,
  });
  assert.equal(first.value.sequence_gap, false);

  const second = await agentRuntime.streamEvents(
    started.value,
    first.value.next_cursor,
    accessRequest(),
  );
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.deepEqual(second.value.events.map((event) => event.sequence), [3, 4]);

  const beyondKnownSequence = await agentRuntime.streamEvents(started.value, {
    schema_version: "1.0.0",
    after_sequence: 99,
    limit: 2,
  }, accessRequest());
  assert.equal(beyondKnownSequence.ok, true);
  if (!beyondKnownSequence.ok) return;
  assert.deepEqual(beyondKnownSequence.value.events, []);
  assert.equal(beyondKnownSequence.value.sequence_gap, true);

  const unbounded = await agentRuntime.streamEvents(started.value, {
    schema_version: "1.0.0",
    after_sequence: 0,
    limit: 101,
  }, accessRequest());
  assert.equal(unbounded.ok, false);
  if (!unbounded.ok) assert.equal(unbounded.failure.code, "invalid_request");
});

test("read boundaries reject unsupported reference and cursor schema versions", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(startRequest());
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const badReference = await agentRuntime.inspect(
    { ...started.value, schema_version: "2.0.0" as "1.0.0" },
    accessRequest(),
  );
  const badCursor = await agentRuntime.streamEvents(
    started.value,
    {
      schema_version: "2.0.0" as "1.0.0",
      after_sequence: 0,
      limit: 1,
    },
    accessRequest(),
  );

  assert.equal(badReference.ok, false);
  assert.equal(badCursor.ok, false);
  if (!badReference.ok) assert.equal(badReference.failure.code, "invalid_request");
  if (!badCursor.ok) assert.equal(badCursor.failure.code, "invalid_request");
});
