import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import { UiSurfaceDiscoveryRuntimeExecutor } from "../../src/discovery/runtime-executor.js";
import type { SemanticUiElement } from "../../src/discovery/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T08:00:00.000Z";
const WORKSPACE_ID = "workspace-ui-discovery-001";
const AGENT = { id: "ui-surface-discovery-agent", version: "0.1.0" } as const;
const SKILL = { id: "discover-ui-surface", version: "0.1.0" } as const;

const clock = { now: (): Date => new Date(NOW) };

class RuntimeSequenceIds implements RuntimeIdFactory {
  #run = 0;
  #event = 0;

  next(kind: "run" | "event"): string {
    if (kind === "run") return `run-${++this.#run}`;
    return `event-${++this.#event}`;
  }
}

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function context(permissions: readonly string[]): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-001",
    actor_type: "human",
    roles: ["discovery-operator"],
    permissions: [...permissions],
    policy_version: "test-policy@0.1.0",
    request_id: "request-ui-discovery-001",
    correlation_id: "correlation-ui-discovery-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T07:00:00.000Z",
    expires_at: "2026-08-07T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return { ...unsigned, integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)) };
}

function findByName(elements: readonly SemanticUiElement[], name: string): SemanticUiElement | undefined {
  return elements.find((element) => element.accessible_name === name);
}

test("discovers a Semantic UI Map (page/field/action) from a real page through the runtime", async () => {
  const permissions = ["agent:execute", "agent:read", "discovery:observe"];
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

  const fixtureUrl = `data:text/html,${encodeURIComponent(
    '<html><body><h1>Login</h1><input aria-label="Username"/><button aria-label="Sign in">Sign in</button></body></html>',
  )}`;

  const skill = new DiscoverUiSurface({ clock, authorizer });
  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new UiSurfaceDiscoveryRuntimeExecutor({
          skill,
          expected_agent: AGENT,
          expected_skill: SKILL,
          engine_ref: "playwright-dom-pipeline@0.1.0",
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  const workspaceContext = context(permissions);
  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Discover the semantic UI surface of a fixture login page.",
    consequence_class: "advisory",
    input: { url: fixtureUrl },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "ui-discovery-start-001",
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
    idempotency_key: "ui-discovery-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

  const output = executed.value.output as { elements: SemanticUiElement[] } | null;
  assert.ok(output, "expected a Semantic UI Map output");
  const elements = output!.elements;
  assert.ok(elements.length > 0, "expected at least one discovered element");

  const usernameField = findByName(elements, "Username");
  assert.ok(usernameField, "expected a Field for the Username input");
  assert.equal(usernameField!.kind, "field");

  const signInAction = findByName(elements, "Sign in");
  assert.ok(signInAction, "expected an Action for the Sign in button");
  assert.equal(signInAction!.kind, "action");
});

test("an unauthorized actor is denied before any browser is launched", async () => {
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

  let browserLaunched = false;
  const skill = new DiscoverUiSurface({
    clock,
    authorizer,
    launchBrowser: async () => {
      browserLaunched = true;
      throw new Error("should never be called");
    },
  });
  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [AGENT.id, new UiSurfaceDiscoveryRuntimeExecutor({ skill, expected_agent: AGENT, expected_skill: SKILL, engine_ref: "playwright-dom-pipeline@0.1.0" })],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(["agent:execute", "agent:read"]);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Exercise the denied-authorization path.",
    consequence_class: "advisory",
    input: { url: "data:text/html,<html></html>" },
    allowed_skills: [SKILL],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "ui-discovery-denied-001",
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
    idempotency_key: "ui-discovery-denied-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "blocked");
  assert.equal(executed.value.failure_class, "policy");
  assert.equal(browserLaunched, false, "a denied call SHALL NOT launch a browser");
});
