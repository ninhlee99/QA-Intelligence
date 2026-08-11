import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../../src/adapters/playwright/playwright-execution-engine.js";
import { ExecuteBrowserTest } from "../../src/execution/execute-browser-test.js";
import { BrowserTestRuntimeExecutor } from "../../src/execution/runtime-executor.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T08:00:00.000Z";
const WORKSPACE_ID = "workspace-browser-test-001";
const AGENT = { id: "browser-test-execution-agent", version: "0.1.0" } as const;
const SKILL = { id: "execute-browser-test", version: "0.1.0" } as const;
const TEST_CASE_REF = "TC-DEMO-001@1.0.0";

const clock = { now: (): Date => new Date(NOW) };

class RuntimeSequenceIds implements RuntimeIdFactory {
  #run = 0;
  #event = 0;

  next(kind: "run" | "event"): string {
    if (kind === "run") return `run-${++this.#run}`;
    return `event-${++this.#event}`;
  }
}

function context(): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-001",
    actor_type: "human",
    roles: ["execution-operator"],
    permissions: ["agent:execute", "agent:read", "execution:read", "execution:execute", "execution:cancel", "execution:cleanup"],
    policy_version: "test-policy@0.1.0",
    request_id: "request-browser-test-001",
    correlation_id: "correlation-browser-test-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T07:00:00.000Z",
    expires_at: "2026-08-07T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return {
    ...unsigned,
    integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)),
  };
}

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

test("executes a Browser Test through the runtime, dispatched by Agent id, driving a real browser", async () => {
  const permissions = [
    "agent:execute",
    "agent:read",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
  ];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });

  const fixtureUrl = `data:text/html,${encodeURIComponent("<html><body><h1>Runtime fixture</h1></body></html>")}`;
  const plans: ReadonlyMap<string, PlaywrightExecutionPlan> = new Map([
    [
      TEST_CASE_REF,
      {
        url: fixtureUrl,
        assert: (cleaned) => hasAccessibleText(cleaned, "Runtime fixture"),
      },
    ],
  ]);
  const engine = new PlaywrightExecutionEngine({
    clock,
    authorizer,
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
  const skill = new ExecuteBrowserTest({ engine, clock, provider_ref: "playwright-execution-engine@0.1.0" });

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new BrowserTestRuntimeExecutor({ skill, expected_agent: AGENT, expected_skill: SKILL }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  const workspaceContext = context();
  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Execute a governed browser test without changing test intent.",
    consequence_class: "reversible",
    input: { test_case_ref: TEST_CASE_REF, environment_ref: "dev-fixture" },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "browser-test-start-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const access = {
    schema_version: "1.0.0" as const,
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
  };
  const executed = await runtime.execute(started.value, {
    ...access,
    expected_revision: 3,
    idempotency_key: "browser-test-execute-001",
  });

  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed");
  assert.equal(executed.value.failure_class, null);
  assert.equal(executed.value.output?.outcome, "passed");
  assert.equal(executed.value.output?.state, "completed");
  assert.deepEqual(executed.value.skill_usage, ["execute-browser-test@0.1.0"]);
});

test("a flaky ExecutionRecord.outcome round-trips through the runtime executor's JSON output unchanged, with usage.retries staying 0", async () => {
  const permissions = [
    "agent:execute",
    "agent:read",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
  ];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });

  const fixtureUrl = `data:text/html,${encodeURIComponent("<html><body><h1>Runtime fixture</h1></body></html>")}`;
  let call = 0;
  const sequence = [false, true, true]; // 2 passes + 1 fail across 3 trials -> flaky
  const flakyPlan: PlaywrightExecutionPlan = {
    url: fixtureUrl,
    assert: () => sequence[Math.min(call++, sequence.length - 1)] ?? false,
  };
  const plans: ReadonlyMap<string, PlaywrightExecutionPlan> = new Map([
    [TEST_CASE_REF, flakyPlan],
    [`${TEST_CASE_REF}:trial-2`, flakyPlan],
    [`${TEST_CASE_REF}:trial-3`, flakyPlan],
  ]);
  const engine = new PlaywrightExecutionEngine({
    clock,
    authorizer,
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
  const skill = new ExecuteBrowserTest({ engine, clock, provider_ref: "playwright-execution-engine@0.1.0" });

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new BrowserTestRuntimeExecutor({ skill, expected_agent: AGENT, expected_skill: SKILL }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  const workspaceContext = context();
  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Exercise a flaky ExecutionRecord.outcome round-trip.",
    consequence_class: "reversible",
    input: { test_case_ref: TEST_CASE_REF, environment_ref: "dev-fixture" },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "browser-test-flaky-start-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const executed = await runtime.execute(started.value, {
    schema_version: "1.0.0",
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
    expected_revision: 3,
    idempotency_key: "browser-test-flaky-execute-001",
  });

  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed");
  assert.equal(executed.value.output?.outcome, "flaky");
  assert.equal(executed.value.usage.retries, 0, "flake-detection trials are internal to the Skill, not surfaced as Runtime-level retries");
});

test("an unregistered Agent id fails closed instead of silently dispatching to the wrong executor", async () => {
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions: ["agent:execute", "agent:read"] },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });
  const executor = new CompositeAgentRunExecutor(new Map());
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context();

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Exercise the unmatched-executor path.",
    consequence_class: "reversible",
    input: {},
    allowed_skills: [SKILL],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "browser-test-unmatched-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const executed = await runtime.execute(started.value, {
    schema_version: "1.0.0",
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
    expected_revision: 3,
    idempotency_key: "browser-test-unmatched-execute-001",
  });
  // `runtime.execute` returning `ok: true` means the runtime itself
  // operated correctly (SPEC-508 §4) — an unmatched Agent id is a governed
  // domain outcome (`outcome: "failed"`, `failure_class: "orchestration"`),
  // not a transport-level error.
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "failed");
  assert.equal(executed.value.failure_class, "orchestration");
});

function hasAccessibleText(node: import("../../src/dom-cleaner/public.js").CleanedDomNode, expected: string): boolean {
  if (node.text === expected || node.accessible_name === expected) return true;
  return node.children.some((child) => hasAccessibleText(child, expected));
}
