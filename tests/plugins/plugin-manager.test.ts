import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicPlugin, type ScriptedPluginScenario } from "../../src/adapters/replay/deterministic-plugin.js";
import { PluginManager } from "../../src/plugins/manager.js";
import { InMemoryPluginRegistry } from "../../src/plugins/registry.js";
import type { PluginDescriptor } from "../../src/plugins/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

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
    workspace_id: "workspace-manager-001",
    actor_id: "actor-manager-001",
    actor_type: "service",
    roles: ["plugin-operator"],
    permissions: ["plugin:invoke"],
    policy_version: "policy@1.0.0",
    request_id: "request-manager-001",
    correlation_id: "correlation-manager-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function descriptorFor(id: string): PluginDescriptor {
  return {
    id,
    version: "0.1.0",
    status: "discovered",
    interfaces: ["SPEC-503"],
    capabilities: ["capability-a"],
    permissions: ["plugin:invoke"],
    configuration_schema: "schemas/plugin.schema.json",
    supported_environments: ["test"],
    compatibility: [],
    owner: "Platform Engineering",
    integrity: { algorithm: "sha256", digest: "0".repeat(64) },
  };
}

function scenarios(): ReadonlyMap<string, ScriptedPluginScenario> {
  return new Map([["capability-a", { outcome: "success", output: { result: "ok" } }]]);
}

function makeDeterministicPlugin(id: string): DeterministicPlugin {
  return new DeterministicPlugin({
    clock: { now: () => new Date("2026-08-06T08:30:00.000Z") },
    authorizer: new AllowingAuthorizer(),
    provider: { id, version: "0.1.0" },
    descriptor: descriptorFor(id),
    scenarios: scenarios(),
  });
}

async function setup(
  pluginIds: readonly string[],
): Promise<{ registry: InMemoryPluginRegistry; manager: PluginManager; plugins: ReadonlyMap<string, DeterministicPlugin> }> {
  const registry = await InMemoryPluginRegistry.create({ now: () => new Date("2026-08-06T08:30:00.000Z") });
  const plugins = new Map(pluginIds.map((id) => [id, makeDeterministicPlugin(id)]));
  const instances = pluginIds.map((id) => ({
    plugin_id: id,
    version: "0.1.0",
    plugin: plugins.get(id) as DeterministicPlugin,
  }));
  for (const id of pluginIds) {
    await registry.register({ descriptor: descriptorFor(id), idempotency_key: `register-${id}` });
    await registry.setEnablement({ plugin_id: id, version: "0.1.0", enabled: true, actor_id: "actor-1", reason: "activate for test" });
  }
  return { registry, manager: new PluginManager(registry, instances), plugins };
}

test("invoke resolves the single enabled plugin matching interface/capability/environment and routes through it", async () => {
  const { manager, plugins } = await setup(["plugin-a"]);
  const plugin = plugins.get("plugin-a") as DeterministicPlugin;

  const initialized = await plugin.initialize({
    operation: "initialize",
    operationId: "op-init-1",
    workspace: workspaceContext(),
    idempotency: { key: "init-1", scope: "initialize", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: { configuration: {}, secret_refs: [] },
  });
  assert.equal(initialized.ok, true, JSON.stringify(initialized));
  if (!initialized.ok) return;

  const result = await manager.invoke({
    operationId: "op-invoke-1",
    workspace: workspaceContext(),
    interface: "SPEC-503",
    capability: "capability-a",
    environment: "test",
    instance_ref: initialized.value.instance_ref,
    input: {},
    idempotency_key: "invoke-1",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "success");
  assert.deepEqual(result.value.output, { result: "ok" });
});

test("resolving a capability with zero enabled plugins fails closed (SPEC-305 §5: no fallback to unverified preference)", async () => {
  const { manager } = await setup([]);

  const result = await manager.invoke({
    operationId: "op-invoke-none",
    workspace: workspaceContext(),
    interface: "SPEC-503",
    capability: "capability-a",
    environment: "test",
    instance_ref: "instance:unused",
    input: {},
    idempotency_key: "invoke-none",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_capability");
});

test("resolving a capability with more than one enabled matching plugin fails closed instead of guessing (SPEC-305 §5)", async () => {
  const { manager } = await setup(["plugin-a", "plugin-b"]);

  const result = await manager.invoke({
    operationId: "op-invoke-ambiguous",
    workspace: workspaceContext(),
    interface: "SPEC-503",
    capability: "capability-a",
    environment: "test",
    instance_ref: "instance:unused",
    input: {},
    idempotency_key: "invoke-ambiguous",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_capability");
  assert.match(result.failure.message, /Ambiguous/);
});

test("cancel and dispose route to the exact plugin_id@version instance, not a resolved capability match", async () => {
  const { manager } = await setup(["plugin-a"]);

  const cancelResult = await manager.cancel({
    operationId: "op-cancel-1",
    workspace: workspaceContext(),
    plugin_id: "plugin-a",
    plugin_version: "0.1.0",
    instance_ref: "instance:x",
    reason: "test cancel",
  });
  assert.equal(cancelResult.ok, true, JSON.stringify(cancelResult));

  const disposeResult = await manager.dispose({
    operationId: "op-dispose-1",
    workspace: workspaceContext(),
    plugin_id: "plugin-a",
    plugin_version: "0.1.0",
    instance_ref: "instance:x",
  });
  assert.equal(disposeResult.ok, true, JSON.stringify(disposeResult));

  const unknownPlugin = await manager.cancel({
    operationId: "op-cancel-unknown",
    workspace: workspaceContext(),
    plugin_id: "plugin-does-not-exist",
    plugin_version: "0.1.0",
    instance_ref: "instance:x",
    reason: "test cancel",
  });
  assert.equal(unknownPlugin.ok, false);
  if (unknownPlugin.ok) return;
  assert.equal(unknownPlugin.failure.code, "instance_unavailable");
});
