import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryOperationStore } from "../../src/adapters/memory/in-memory-operation-store.js";
import { orchestrateOperation, type OrchestrationDependencies } from "../../src/runtime-orchestration/orchestrate.js";
import type { DispatchCapability, OrchestrateOperationRequest } from "../../src/runtime-orchestration/public.js";
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

class SatisfiedRuleEngine implements DeterministicRuleEngine {
  async evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    return {
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
        explanation_trace: ["transition satisfied"],
        policy_version: request.context.policy_version,
        duration_ms: 0,
      },
    };
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-orchestration-001",
    actor_type: "service",
    roles: ["orchestrator"],
    permissions: ["orchestration:dispatch"],
    policy_version: "policy@1.0.0",
    request_id: "request-orchestration-001",
    correlation_id: "correlation-orchestration-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T09:00:00.000Z",
    expires_at: "2026-08-08T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function countingCapability(): { capability: DispatchCapability; callCount: () => number } {
  let calls = 0;
  const capability: DispatchCapability = {
    capability_ref: { id: "test-capability", version: "1.0.0" },
    dispatch: async (_context, input) => {
      calls += 1;
      return { ok: true, value: { echoed: input["value"] ?? null } };
    },
  };
  return { capability, callCount: () => calls };
}

function failingCapability(): DispatchCapability {
  return {
    capability_ref: { id: "failing-capability", version: "1.0.0" },
    dispatch: async () => ({ ok: false, failure: { reason: "dispatch always fails in this test" } }),
  };
}

function makeDependencies(
  capabilities: readonly DispatchCapability[],
  rules: DeterministicRuleEngine = new SatisfiedRuleEngine(),
  authorizer: WorkspaceAuthorizer = new AllowingAuthorizer(),
): OrchestrationDependencies {
  return {
    authorizer,
    operationStore: new InMemoryOperationStore({ now: () => new Date("2026-08-08T09:30:00.000Z") }),
    capabilities: new Map(capabilities.map((cap) => [`${cap.capability_ref.id}@${cap.capability_ref.version}`, cap])),
    rules,
    clock: { now: () => new Date("2026-08-08T09:30:00.000Z") },
    producer: { id: "runtime-orchestration-test", version: "0.1.0" },
  };
}

function baseRequest(overrides: Partial<OrchestrateOperationRequest> = {}): OrchestrateOperationRequest {
  return {
    context: workspaceContext(),
    workspace_id: "workspace-alpha",
    owner: "actor-orchestration-001",
    deadline: "2026-08-08T10:00:00.000Z",
    capability_ref: { id: "test-capability", version: "1.0.0" },
    input: { value: "hello" },
    transition_rule_set: { id: "transition-rules", version: "1.0.0" },
    idempotency_key: "idem-orchestrate-1",
    ...overrides,
  };
}

test("a successful orchestration finalizes the operation with outcome completed", async () => {
  const { capability } = countingCapability();
  const dependencies = makeDependencies([capability]);

  const result = await orchestrateOperation(dependencies, baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.state, "finalized");
  assert.equal(result.value.outcome, "completed");
});

test("duplicate delivery: repeat calls with the same idempotency_key return the same operation and dispatch only once", async () => {
  const { capability, callCount } = countingCapability();
  const dependencies = makeDependencies([capability]);
  const request = baseRequest();

  const first = await orchestrateOperation(dependencies, request);
  const second = await orchestrateOperation(dependencies, request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value, second.value);
  assert.equal(callCount(), 1);
});

test("policy denial: authorization failure short-circuits before any dispatch", async () => {
  const { capability, callCount } = countingCapability();
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const dependencies = makeDependencies([capability], new SatisfiedRuleEngine(), deniedAuthorizer);

  const result = await orchestrateOperation(dependencies, baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_denied");
  assert.equal(callCount(), 0);
});

test("partial failure: a dispatch that fails still produces an operation record with outcome failed", async () => {
  const dependencies = makeDependencies([failingCapability()]);

  const result = await orchestrateOperation(
    dependencies,
    baseRequest({ capability_ref: { id: "failing-capability", version: "1.0.0" } }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "dispatch_failure");

  const record = dependencies.operationStore.get("workspace-alpha", `${baseRequest().idempotency_key}:failing-capability`);
  assert.notEqual(record, undefined);
  assert.equal(record?.outcome, "failed");
});

test("unknown capability is a distinct failure, not a crash", async () => {
  const dependencies = makeDependencies([]);
  const result = await orchestrateOperation(dependencies, baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_capability");
});

test("empty input is rejected before dispatch", async () => {
  const { capability, callCount } = countingCapability();
  const dependencies = makeDependencies([capability]);

  const result = await orchestrateOperation(dependencies, baseRequest({ input: {} }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_input");
  assert.equal(callCount(), 0);
});

test("recovery: operationStore.get after a completed orchestration reproduces the same finalized record", async () => {
  const { capability } = countingCapability();
  const dependencies = makeDependencies([capability]);
  const request = baseRequest();

  const result = await orchestrateOperation(dependencies, request);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  const recovered = dependencies.operationStore.get("workspace-alpha", `${request.idempotency_key}:test-capability`);
  assert.deepEqual(recovered, result.value);
});

test("auditability: a completed operation carries a non-empty evidence trail", async () => {
  const { capability } = countingCapability();
  const dependencies = makeDependencies([capability]);

  const result = await orchestrateOperation(dependencies, baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.ok(result.value.evidence.length > 0);
});

test("Workspace isolation: a workspace_id/context mismatch is rejected before any dispatch", async () => {
  const { capability, callCount } = countingCapability();
  const dependencies = makeDependencies([capability]);

  const result = await orchestrateOperation(
    dependencies,
    baseRequest({ workspace_id: "workspace-beta", context: workspaceContext({ workspace_id: "workspace-alpha" }) }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_denied");
  assert.equal(callCount(), 0);
});

test("transition denial: an unsatisfied rule outcome blocks finalization", async () => {
  const { capability } = countingCapability();
  const unsatisfiedRuleEngine: DeterministicRuleEngine = {
    evaluate: async (request) => ({
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
        explanation_trace: ["transition rules denied this outcome"],
        policy_version: request.context.policy_version,
        duration_ms: 0,
      },
    }),
  };
  const dependencies = makeDependencies([capability], unsatisfiedRuleEngine);

  const result = await orchestrateOperation(dependencies, baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "transition_denied");
});
