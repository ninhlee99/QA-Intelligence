import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../../src/runtime/executor.js";
import { SchemaValidator, type SchemaObject } from "../../src/schema/schema-validator.js";

const RESULT_SCHEMA_ID =
  "https://qa-intelligence.local/schemas/agent-run-result.schema.json";
const resultValidator = readFile("schemas/agent-run-result.schema.json", "utf8")
  .then((source) => new SchemaValidator([JSON.parse(source) as SchemaObject]));

async function assertValidResult(value: unknown): Promise<void> {
  const validator = await resultValidator;
  assert.equal(
    validator.validate(RESULT_SCHEMA_ID, value).ok,
    true,
    JSON.stringify(value),
  );
}

class FixedClock implements Clock {
  readonly #time: Date;

  constructor(time: string) {
    this.#time = new Date(time);
  }

  now(): Date {
    return new Date(this.#time);
  }
}

class MutableClock implements Clock {
  #time: Date;

  constructor(time: string) {
    this.#time = new Date(time);
  }

  now(): Date {
    return new Date(this.#time);
  }

  set(time: string): void {
    this.#time = new Date(time);
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
    policy_version: "policy@1.0.0",
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

function runtime(
  authorizer = new AuthorizerStub(),
  executor?: AgentRunExecutor,
): InMemoryAgentRuntime {
  return new InMemoryAgentRuntime(
    new FixedClock("2026-08-03T00:00:00.000Z"),
    new SequenceIdFactory(),
    authorizer,
    executor,
  );
}

class ExecutorStub implements AgentRunExecutor {
  readonly inputs: AgentRunExecutorInput[] = [];
  readonly #result: AgentRunExecutorResult;

  constructor(result: AgentRunExecutorResult) {
    this.#result = result;
  }

  execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    this.inputs.push(input);
    return Promise.resolve(this.#result);
  }
}

class DeferredExecutor implements AgentRunExecutor {
  readonly started: Promise<void>;
  #signalStarted!: () => void;
  #complete!: (result: AgentRunExecutorResult) => void;
  readonly #completion: Promise<AgentRunExecutorResult>;

  constructor() {
    this.started = new Promise((resolve) => {
      this.#signalStarted = resolve;
    });
    this.#completion = new Promise((resolve) => {
      this.#complete = resolve;
    });
  }

  execute(): Promise<AgentRunExecutorResult> {
    this.#signalStarted();
    return this.#completion;
  }

  complete(result: AgentRunExecutorResult): void {
    this.#complete(result);
  }
}

function successfulExecution(): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output: { assessment_id: "assessment-001", verdict: "changes_required" },
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: "requirement-review-agent@1.0.0",
        skill: "assess-requirement-quality@1.0.0",
        policy: "policy@1.0.0",
      },
      rule_results: ["rule:requirement-quality:indeterminate"],
      skill_usage: ["assess-requirement-quality@1.0.0"],
      tool_usage: [],
      citations: ["REQ-1@1.0.0"],
      uncertainty: {
        level: "high",
        reasons: ["response-time threshold is missing"],
      },
      policy_events: ["authorization:allow"],
      usage: {
        steps: 1,
        duration_seconds: 1,
        tool_calls: 0,
        retries: 0,
      },
      evidence: ["evidence://assessment-001"],
      cleanup_status: "not_required",
    },
  };
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
    policy_version: "policy@1.0.0",
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
    policy_version: "policy@1.0.0",
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

test("execute owns completion and exposes the retained authoritative result", async () => {
  const authorizer = new AuthorizerStub();
  const executor = new ExecutorStub(successfulExecution());
  const agentRuntime = runtime(authorizer, executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const execution = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "operation-execute" }),
    expected_revision: 3,
    idempotency_key: "execute-1",
  });

  assert.equal(execution.ok, true, JSON.stringify(execution));
  if (!execution.ok) return;
  assert.equal(execution.value.outcome, "completed");
  assert.equal(execution.value.output?.verdict, "changes_required");
  assert.equal(execution.value.failure_class, null);
  await assertValidResult(execution.value);
  assert.equal(executor.inputs.length, 1);
  assert.equal(executor.inputs[0]?.start_request.purpose, "Review requirement REQ-1");
  assert.equal(
    authorizer.requests[0]?.resource_refs.includes("input:REQ-1@1.0.0"),
    true,
  );
  assert.equal(
    authorizer.requests.at(-1)?.resource_refs.includes("input:REQ-1@1.0.0"),
    true,
  );

  const inspected = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(inspected.ok, true);
  if (inspected.ok) {
    assert.equal(inspected.value.state, "completed");
    assert.equal(inspected.value.revision, 6);
  }

  const retained = await agentRuntime.result(started.value, accessRequest());
  assert.equal(retained.ok, true);
  if (retained.ok) assert.strictEqual(retained.value, execution.value);
});

test("execute fails closed unless authority covers the retained Agent and Skill", async () => {
  const authorizer = new AuthorizerStub();
  const executor = new ExecutorStub(successfulExecution());
  const agentRuntime = runtime(authorizer, executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
      allowed_tools: [{ id: "requirements-reader", version: "1.0.0" }],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  authorizer.setResult({
    ok: true,
    value: {
      policy_version: "policy@1.0.0",
      effective_permissions: ["agent:execute"],
      authorized_resource_refs: [
        "workspace:workspace-alpha",
        "agent-run:run-1",
        "agent:requirement-review-agent@1.0.0",
        "input:REQ-1@1.0.0",
      ],
      decision_evidence: ["authorization:incomplete"],
    },
  });

  const denied = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "operation-execute-denied" }),
    expected_revision: 3,
    idempotency_key: "execute-denied",
  });

  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.failure.code, "authorization_denied");
  assert.equal(executor.inputs.length, 0);
  assert.deepEqual(authorizer.requests.at(-1)?.resource_refs, [
    "workspace:workspace-alpha",
    "agent-run:run-1",
    "agent:requirement-review-agent@1.0.0",
    "skill:assess-requirement-quality@1.0.0",
    "tool:requirements-reader@1.0.0",
    "input:REQ-1@1.0.0",
  ]);
});

test("execute and result deny cross-Workspace access before observing a retained run", async () => {
  const executor = new ExecutorStub(successfulExecution());
  const agentRuntime = runtime(new AuthorizerStub(), executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const crossWorkspaceAccess = accessRequest({
    workspace_id: "workspace-beta",
    workspace_context: workspaceContext({ workspace_id: "workspace-beta" }),
  });
  const deniedExecution = await agentRuntime.execute(started.value, {
    ...crossWorkspaceAccess,
    expected_revision: 3,
    idempotency_key: "cross-workspace-execute",
  });
  const deniedResult = await agentRuntime.result(
    started.value,
    crossWorkspaceAccess,
  );

  assert.equal(deniedExecution.ok, false);
  if (!deniedExecution.ok) {
    assert.equal(deniedExecution.failure.code, "authorization_denied");
  }
  assert.equal(deniedResult.ok, false);
  if (!deniedResult.ok) {
    assert.equal(deniedResult.failure.code, "authorization_denied");
  }
  assert.equal(executor.inputs.length, 0);
});

test("execute enforces revision and idempotency without re-running the Skill", async () => {
  const executor = new ExecutorStub(successfulExecution());
  const agentRuntime = runtime(new AuthorizerStub(), executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const stale = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "operation-execute-stale" }),
    expected_revision: 2,
    idempotency_key: "execute-stale",
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.failure.code, "stale_revision");
  assert.equal(executor.inputs.length, 0);

  const command = {
    ...accessRequest({ operation_id: "operation-execute" }),
    expected_revision: 3,
    idempotency_key: "execute-1",
  } as const;
  const first = await agentRuntime.execute(started.value, command);
  const duplicate = await agentRuntime.execute(started.value, command);
  const conflict = await agentRuntime.execute(started.value, {
    ...command,
    operation_id: "operation-execute-changed",
  });

  assert.equal(first.ok, true);
  assert.deepEqual(duplicate, first);
  assert.equal(executor.inputs.length, 1);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.failure.code, "idempotency_conflict");
});

test("invalid output, exhausted budgets, and incomplete cleanup cannot complete a run", async () => {
  const base = successfulExecution();
  assert.ok(base.ok);
  const scenarios: readonly Readonly<{
    name: string;
    result: AgentRunExecutorResult;
    failure_class: string;
    outcome?: "failed" | "blocked";
  }>[] = [
    {
      name: "invalid-output",
      result: {
        ok: true,
        value: { ...base.value, output_validated: false },
      },
      failure_class: "skill",
    },
    {
      name: "budget-exhausted",
      result: {
        ok: true,
        value: {
          ...base.value,
          usage: { ...base.value.usage, steps: 11 },
        },
      },
      failure_class: "orchestration",
    },
    {
      name: "cleanup-incomplete",
      result: {
        ok: true,
        value: { ...base.value, cleanup_status: "incomplete" },
      },
      failure_class: "infrastructure",
    },
    {
      name: "unauthorized-tool",
      result: {
        ok: true,
        value: { ...base.value, tool_usage: ["undeclared-tool@1.0.0"] },
      },
      failure_class: "policy",
      outcome: "blocked",
    },
    {
      name: "missing-required-evidence",
      result: {
        ok: true,
        value: { ...base.value, satisfied_evidence_requirements: [] },
      },
      failure_class: "skill",
    },
    {
      name: "policy-version-mismatch",
      result: {
        ok: true,
        value: {
          ...base.value,
          resolved_versions: {
            ...base.value.resolved_versions,
            policy: "other-policy@1.0.0",
          },
        },
      },
      failure_class: "orchestration",
    },
    {
      name: "unbound-skill-version",
      result: {
        ok: true,
        value: {
          ...base.value,
          resolved_versions: {
            agent: "requirement-review-agent@1.0.0",
            policy: "policy@1.0.0",
          },
        },
      },
      failure_class: "orchestration",
    },
  ];

  for (const scenario of scenarios) {
    const agentRuntime = runtime(
      new AuthorizerStub(),
      new ExecutorStub(scenario.result),
    );
    const started = await agentRuntime.start(
      startRequest({
        operation_id: `start-${scenario.name}`,
        idempotency_key: `start-${scenario.name}`,
        allowed_skills: [
          { id: "assess-requirement-quality", version: "1.0.0" },
        ],
        ...(scenario.name === "missing-required-evidence"
          ? { evidence_requirements: ["assessment-schema"] }
          : {}),
      }),
    );
    assert.equal(started.ok, true);
    if (!started.ok) continue;

    const execution = await agentRuntime.execute(started.value, {
      ...accessRequest({ operation_id: `execute-${scenario.name}` }),
      expected_revision: 3,
      idempotency_key: `execute-${scenario.name}`,
    });

    assert.equal(execution.ok, true, scenario.name);
    if (!execution.ok) continue;
    assert.equal(execution.value.outcome, scenario.outcome ?? "failed", scenario.name);
    assert.equal(execution.value.failure_class, scenario.failure_class, scenario.name);
    assert.equal(execution.value.output, null, scenario.name);
    await assertValidResult(execution.value);
    if (scenario.name === "budget-exhausted") {
      assert.equal(execution.value.usage.steps, 11);
    }
    if (scenario.name === "cleanup-incomplete") {
      assert.equal(execution.value.cleanup_status, "incomplete");
      assert.equal(
        execution.value.evidence.includes("evidence://assessment-001"),
        true,
      );
      assert.deepEqual(execution.value.skill_usage, [
        "assess-requirement-quality@1.0.0",
      ]);
    }
    const inspected = await agentRuntime.inspect(started.value, accessRequest());
    assert.equal(inspected.ok, true);
    if (inspected.ok) {
      assert.equal(inspected.value.state, scenario.outcome ?? "failed", scenario.name);
    }
  }
});

test("execute records a terminal timeout when the retained deadline elapses", async () => {
  const mutableClock = new MutableClock("2026-08-03T00:00:00.000Z");
  const executor = new ExecutorStub(successfulExecution());
  const agentRuntime = new InMemoryAgentRuntime(
    mutableClock,
    new SequenceIdFactory(),
    new AuthorizerStub(),
    executor,
  );
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
      deadline: "2026-08-03T00:30:00.000Z",
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  mutableClock.set("2026-08-03T00:30:00.000Z");

  const timedOut = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "operation-execute-timeout" }),
    expected_revision: 3,
    idempotency_key: "execute-timeout",
  });

  assert.equal(timedOut.ok, true);
  if (!timedOut.ok) return;
  assert.equal(timedOut.value.outcome, "timed_out");
  assert.equal(timedOut.value.failure_class, "orchestration");
  await assertValidResult(timedOut.value);
  assert.equal(executor.inputs.length, 0);
  const snapshot = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(snapshot.ok, true);
  if (snapshot.ok) assert.equal(snapshot.value.state, "timed_out");
});

test("execute rejects a second writer after the first reserves the run", async () => {
  const executor = new DeferredExecutor();
  const agentRuntime = runtime(new AuthorizerStub(), executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const first = agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "execute-first-writer" }),
    expected_revision: 3,
    idempotency_key: "execute-first-writer",
  });
  await executor.started;

  const second = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "execute-second-writer" }),
    expected_revision: 3,
    idempotency_key: "execute-second-writer",
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.failure.code, "stale_revision");

  executor.complete(successfulExecution());
  const completed = await first;
  assert.equal(completed.ok, true);
  if (completed.ok) assert.equal(completed.value.outcome, "completed");
});

test("a cancellation during awaited execution wins over the late observation", async () => {
  const executor = new DeferredExecutor();
  const agentRuntime = runtime(new AuthorizerStub(), executor);
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const executing = agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "execute-before-cancel" }),
    expected_revision: 3,
    idempotency_key: "execute-before-cancel",
  });
  await executor.started;

  const cancelled = await agentRuntime.cancel(started.value, {
    ...accessRequest({ operation_id: "cancel-during-execute" }),
    expected_revision: 4,
    reason: "Operator cancellation wins.",
    evidence: ["evidence://cancel-during-execute"],
    idempotency_key: "cancel-during-execute",
  });
  assert.equal(cancelled.ok, true);
  executor.complete(successfulExecution());
  const final = await executing;

  assert.equal(final.ok, true);
  if (!final.ok) return;
  assert.equal(final.value.outcome, "cancelled");
  assert.equal(final.value.output, null);
  await assertValidResult(final.value);
  const snapshot = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(snapshot.ok, true);
  if (snapshot.ok) assert.equal(snapshot.value.state, "cancelled");
});

test("an observation crossing the deadline is retained as timed out, never completed", async () => {
  const mutableClock = new MutableClock("2026-08-03T00:00:00.000Z");
  const executor: AgentRunExecutor = {
    execute(): Promise<AgentRunExecutorResult> {
      mutableClock.set("2026-08-03T00:31:00.000Z");
      return Promise.resolve(successfulExecution());
    },
  };
  const agentRuntime = new InMemoryAgentRuntime(
    mutableClock,
    new SequenceIdFactory(),
    new AuthorizerStub(),
    executor,
  );
  const started = await agentRuntime.start(
    startRequest({
      allowed_skills: [
        { id: "assess-requirement-quality", version: "1.0.0" },
      ],
      deadline: "2026-08-03T00:30:00.000Z",
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;

  const timedOut = await agentRuntime.execute(started.value, {
    ...accessRequest({ operation_id: "execute-crosses-deadline" }),
    expected_revision: 3,
    idempotency_key: "execute-crosses-deadline",
  });

  assert.equal(timedOut.ok, true);
  if (!timedOut.ok) return;
  assert.equal(timedOut.value.outcome, "timed_out");
  assert.equal(timedOut.value.usage.steps, 1);
  assert.equal(
    timedOut.value.evidence.includes("evidence://assessment-001"),
    true,
  );
  await assertValidResult(timedOut.value);
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
    startRequest({
      policy_version: "latest",
      workspace_context: workspaceContext({ policy_version: "latest" }),
    }),
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
      policy_version: "policy@1.0.0",
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
      policy_version: "policy@1.0.0",
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
    startRequest({ policy_version: "policy@2.0.0" }),
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

  const result = await agentRuntime.result(started.value, accessRequest());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.outcome, "cancelled");
    assert.equal(result.value.failure_class, "orchestration");
    assert.equal(result.value.output, null);
    assert.equal(result.value.evidence.includes("evidence://operator-cancel"), true);
    await assertValidResult(result.value);
  }
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

test("a rejected high-consequence approval retains an authoritative blocked result", async () => {
  const agentRuntime = runtime();
  const started = await agentRuntime.start(
    startRequest({
      consequence_class: "high_consequence",
      purpose: "Review a high-consequence requirement",
    }),
  );
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const pending = await agentRuntime.inspect(started.value, accessRequest());
  assert.equal(pending.ok, true);
  if (!pending.ok || pending.value.pending_approval === null) return;
  assert.equal(pending.value.state, "awaiting_approval");

  const rejected = await agentRuntime.approve(started.value, {
    ...accessRequest({ operation_id: "reject-high-consequence" }),
    expected_revision: 3,
    approval_id: pending.value.pending_approval.approval_id,
    decision: "rejected",
    reason: "Required human approval was not granted.",
    evidence: ["approval-evidence://rejected"],
    idempotency_key: "reject-high-consequence",
  });
  assert.equal(rejected.ok, true);

  const result = await agentRuntime.result(started.value, accessRequest());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.outcome, "blocked");
  assert.equal(result.value.failure_class, "policy");
  assert.equal(
    result.value.evidence.includes("approval-evidence://rejected"),
    true,
  );
  await assertValidResult(result.value);
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
