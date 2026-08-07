import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryPluginRegistry } from "../../src/plugins/registry.js";
import type { PluginDescriptor } from "../../src/plugins/public.js";

function clock() {
  return { now: () => new Date("2026-08-06T08:30:00.000Z") };
}

function validDescriptor(overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  return {
    id: "git-plugin",
    version: "0.1.0",
    status: "discovered",
    interfaces: ["SPEC-503", "SPEC-409"],
    capabilities: ["repository_metadata"],
    permissions: ["git:read"],
    configuration_schema: "schemas/plugin.schema.json",
    supported_environments: ["test"],
    compatibility: [],
    owner: "Platform Engineering",
    integrity: { algorithm: "sha256", digest: "0".repeat(64) },
    ...overrides,
  };
}

test("register rejects a descriptor that fails schema validation (SPEC-405 §4)", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  const result = await registry.register({
    descriptor: { ...validDescriptor(), owner: undefined as unknown as string },
    idempotency_key: "register-1",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_descriptor");
});

test("register is idempotent under the same idempotency key", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  const descriptor = validDescriptor();

  const first = await registry.register({ descriptor, idempotency_key: "register-idem-1" });
  const second = await registry.register({ descriptor, idempotency_key: "register-idem-1" });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value, second.value);
});

test("registering the same plugin id+version twice under different idempotency keys is a conflict, not a silent overwrite", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  const descriptor = validDescriptor();
  await registry.register({ descriptor, idempotency_key: "register-conflict-1" });

  const result = await registry.register({ descriptor, idempotency_key: "register-conflict-2" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "already_registered");
});

test("a freshly registered plugin cannot be resolved until enabled (SPEC-305 §4: installation SHALL NOT imply enablement)", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  await registry.register({
    descriptor: validDescriptor({ status: "discovered" }),
    idempotency_key: "resolve-1",
  });

  const resolved = await registry.resolve({ interface: "SPEC-503", capability: "repository_metadata", environment: "test" });

  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  if (!resolved.ok) return;
  assert.deepEqual(resolved.value, []);
});

test("enabling a plugin makes it resolvable; disabling removes it from resolution (SPEC-405 §4)", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  const descriptor = validDescriptor();
  await registry.register({ descriptor, idempotency_key: "enable-1" });

  const enabled = await registry.setEnablement({
    plugin_id: descriptor.id,
    version: descriptor.version,
    enabled: true,
    actor_id: "actor-1",
    reason: "activate for testing",
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled));
  if (!enabled.ok) return;
  assert.equal(enabled.value.status, "enabled");

  const resolvedWhileEnabled = await registry.resolve({ interface: "SPEC-503", capability: "repository_metadata", environment: "test" });
  assert.equal(resolvedWhileEnabled.ok, true);
  if (!resolvedWhileEnabled.ok) return;
  assert.equal(resolvedWhileEnabled.value.length, 1);

  const disabled = await registry.setEnablement({
    plugin_id: descriptor.id,
    version: descriptor.version,
    enabled: false,
    actor_id: "actor-1",
    reason: "deactivate",
  });
  assert.equal(disabled.ok, true);
  if (!disabled.ok) return;
  assert.equal(disabled.value.status, "disabled");

  const resolvedWhileDisabled = await registry.resolve({ interface: "SPEC-503", capability: "repository_metadata", environment: "test" });
  assert.equal(resolvedWhileDisabled.ok, true);
  if (!resolvedWhileDisabled.ok) return;
  assert.deepEqual(resolvedWhileDisabled.value, []);
});

test("retired plugins cannot be re-enabled or resolved (SPEC-405 §4)", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());
  const descriptor = validDescriptor();
  await registry.register({ descriptor, idempotency_key: "retire-1" });
  await registry.setEnablement({ plugin_id: descriptor.id, version: descriptor.version, enabled: true, actor_id: "actor-1", reason: "activate" });

  const retired = await registry.retire({ plugin_id: descriptor.id, version: descriptor.version, actor_id: "actor-1", reason: "deprecated" });
  assert.equal(retired.ok, true, JSON.stringify(retired));
  if (!retired.ok) return;
  assert.equal(retired.value.status, "retired");

  const reEnableAttempt = await registry.setEnablement({ plugin_id: descriptor.id, version: descriptor.version, enabled: true, actor_id: "actor-1", reason: "reactivate" });
  assert.equal(reEnableAttempt.ok, false);
  if (reEnableAttempt.ok) return;
  assert.equal(reEnableAttempt.failure.code, "unsupported_transition");

  const resolved = await registry.resolve({ interface: "SPEC-503", capability: "repository_metadata", environment: "test" });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.deepEqual(resolved.value, []);
});

test("operations against an unregistered plugin fail closed with not_found", async () => {
  const registry = await InMemoryPluginRegistry.create(clock());

  const result = await registry.setEnablement({ plugin_id: "unknown-plugin", version: "1.0.0", enabled: true, actor_id: "actor-1", reason: "n/a" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_found");
});
