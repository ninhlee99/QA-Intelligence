import assert from "node:assert/strict";
import test from "node:test";

import {
  DeterministicPlugin,
  type ScriptedPluginScenario,
} from "../../../src/adapters/replay/deterministic-plugin.js";
import type { InitializeRequest, InvokeRequest } from "../../../src/plugins/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";
import { runPluginContract } from "../../plugins/plugin-contract.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest) {
    return {
      ok: true as const,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-plugin-001",
    actor_id: "actor-plugin-001",
    actor_type: "service",
    roles: ["plugin-operator"],
    permissions: ["plugin:invoke"],
    policy_version: "policy@1.0.0",
    request_id: "request-plugin-001",
    correlation_id: "correlation-plugin-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function initializeRequestFor(operationId: string): InitializeRequest {
  return {
    operation: "initialize",
    operationId,
    workspace: workspaceContext(),
    idempotency: { key: `init:${operationId}`, scope: "initialize", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { configuration: {}, secret_refs: [] },
  };
}

function invokeRequestFor(instanceRef: string, operationId: string, outcome: "success" | "failure"): InvokeRequest {
  return {
    operation: "invoke",
    operationId,
    workspace: workspaceContext(),
    idempotency: { key: `invoke:${operationId}`, scope: "invoke", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: instanceRef, capability: `capability-${outcome}`, input: {} },
  };
}

function makePlugin(scenarios: ReadonlyMap<string, ScriptedPluginScenario>): DeterministicPlugin {
  return new DeterministicPlugin({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "deterministic-plugin", version: "0.1.0" },
    descriptor: {
      id: "deterministic-plugin",
      version: "0.1.0",
      status: "enabled",
      interfaces: ["SPEC-503"],
      capabilities: ["capability-success", "capability-failure"],
      permissions: ["plugin:invoke"],
      configuration_schema: "schemas/plugin.schema.json",
      supported_environments: ["test"],
      compatibility: [],
      owner: "Platform Engineering",
      integrity: { algorithm: "sha256", digest: "0".repeat(64) },
    },
    scenarios,
  });
}

function contractScenarios(): ReadonlyMap<string, ScriptedPluginScenario> {
  return new Map([
    ["capability-success", { outcome: "success", output: { result: "ok" } }],
    ["capability-failure", { outcome: "failure", diagnostics: ["scripted failure"] }],
  ]);
}

runPluginContract("deterministic-plugin", {
  makePlugin: () => makePlugin(contractScenarios()),
  workspaceContext,
  initializeRequestFor,
  invokeRequestFor,
});

test("invoke against an unscripted capability fails closed instead of throwing", async () => {
  const plugin = makePlugin(new Map());
  const initialized = await plugin.initialize(initializeRequestFor("op-init-unscripted"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await plugin.invoke(
    invokeRequestFor(initialized.value.instance_ref, "op-invoke-unscripted", "success"),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_capability");
});

test("a different invoke request reusing the same idempotency key is a conflict, not a silent replace", async () => {
  const plugin = makePlugin(contractScenarios());
  const initialized = await plugin.initialize(initializeRequestFor("op-init-conflict"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const first = invokeRequestFor(initialized.value.instance_ref, "op-invoke-conflict", "success");
  const second = { ...first, payload: { ...first.payload, capability: "capability-failure" } };

  const firstResult = await plugin.invoke(first);
  const secondResult = await plugin.invoke(second);

  assert.equal(firstResult.ok, true, JSON.stringify(firstResult));
  assert.equal(secondResult.ok, false);
  if (secondResult.ok) return;
  assert.equal(secondResult.failure.code, "idempotency_conflict");
});

test("cancel is cooperative: a cancelled invocation reports a partial outcome instead of throwing", async () => {
  const plugin = makePlugin(contractScenarios());
  const initialized = await plugin.initialize(initializeRequestFor("op-init-cancel"));
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const cancelResult = await plugin.cancel({
    operation: "cancel",
    operationId: "op-cancel-1",
    workspace: workspaceContext(),
    idempotency: { key: "k-cancel-1", scope: "cancel", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { instance_ref: initialized.value.instance_ref, reason: "caller requested cancellation" },
  });
  assert.equal(cancelResult.ok, true, JSON.stringify(cancelResult));
  if (!cancelResult.ok) return;
  assert.equal(cancelResult.value.accepted, true);

  const invoked = await plugin.invoke(
    invokeRequestFor(initialized.value.instance_ref, "op-invoke-after-cancel", "success"),
  );
  assert.equal(invoked.ok, true, JSON.stringify(invoked));
  if (!invoked.ok) return;
  assert.equal(invoked.value.outcome, "partial");
});

test("authorization denial fails closed without exposing scripted evidence", async () => {
  const denyingAuthorizer: WorkspaceAuthorizer = {
    async authorize() {
      return {
        ok: false as const,
        failure: { code: "insufficient_permission" as const, message: "denied", retryable: false, evidence: [] },
      };
    },
  };
  const plugin = new DeterministicPlugin({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: denyingAuthorizer,
    provider: { id: "deterministic-plugin", version: "0.1.0" },
    descriptor: {
      id: "deterministic-plugin",
      version: "0.1.0",
      status: "enabled",
      interfaces: ["SPEC-503"],
      capabilities: ["capability-success"],
      permissions: ["plugin:invoke"],
      configuration_schema: "schemas/plugin.schema.json",
      supported_environments: ["test"],
      compatibility: [],
      owner: "Platform Engineering",
      integrity: { algorithm: "sha256", digest: "0".repeat(64) },
    },
    scenarios: contractScenarios(),
  });

  const result = await plugin.initialize(initializeRequestFor("op-init-denied"));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_denied");
  assert.deepEqual(result.evidence, []);
});
