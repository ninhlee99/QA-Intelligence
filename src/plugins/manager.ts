import type {
  CancelValue,
  DisposeValue,
  InvokeValue,
  Plugin,
  PluginDescriptor,
  PluginFailure,
  PluginFailureCode,
} from "./public.js";
import type { PluginRegistry, ResolvePluginQuery } from "./registry.js";
import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";

export type PluginManagerResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: PluginFailure }>;

export type InvokeCapabilityRequest = Readonly<{
  operationId: string;
  workspace: WorkspaceContext;
  interface: string;
  capability: string;
  environment: string;
  instance_ref: string;
  input: JsonObject;
  idempotency_key: string;
}>;

export type CancelCapabilityRequest = Readonly<{
  operationId: string;
  workspace: WorkspaceContext;
  plugin_id: string;
  plugin_version: string;
  instance_ref: string;
  reason: string;
}>;

export type DisposeCapabilityRequest = Readonly<{
  operationId: string;
  workspace: WorkspaceContext;
  plugin_id: string;
  plugin_version: string;
  instance_ref: string;
}>;

/** A live, initialized `Plugin` instance the Manager can route invocations through, keyed by the registry's plugin_id@version. */
export type RegisteredPluginInstance = Readonly<{
  plugin_id: string;
  version: string;
  plugin: Plugin;
}>;

const CONTRACT_VERSION = { contract: "1.0.0", operation_schema: "1.0.0" } as const;

function deadline(): Readonly<{ at: string; time_standard: "UTC" }> {
  return { at: new Date(Date.now() + 60_000).toISOString(), time_standard: "UTC" };
}

/**
 * SPEC-305 Plugin Manager: discovers, validates, authorizes, activates,
 * invokes, observes, and retires provider adapters without letting them own
 * core policy (§1). This module owns collaboration/routing only —
 * descriptor storage and the discovered→...→retired lifecycle belong to
 * `PluginRegistry` (SPEC-405, §31 "SPEC-305 owns plugin collaboration
 * architecture... SPEC-405 owns registry implementation responsibility").
 * Capability resolution (§5) never falls back to unverified provider
 * preference: if `PluginRegistry.resolve` returns zero or multiple
 * candidates for a (interface, capability, environment) query, that is a
 * caller-visible failure, not a guess.
 */
export class PluginManager {
  readonly #registry: PluginRegistry;
  readonly #instances: ReadonlyMap<string, Plugin>;

  constructor(registry: PluginRegistry, instances: readonly RegisteredPluginInstance[]) {
    this.#registry = registry;
    this.#instances = new Map(instances.map((instance) => [instanceKey(instance.plugin_id, instance.version), instance.plugin]));
  }

  async invoke(request: InvokeCapabilityRequest): Promise<PluginManagerResult<InvokeValue>> {
    const resolved = await this.#resolveOne({
      interface: request.interface,
      capability: request.capability,
      environment: request.environment,
    });
    if (!resolved.ok) return resolved;
    const { descriptor, plugin } = resolved.value;

    const result = await plugin.invoke({
      operation: "invoke",
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: { key: request.idempotency_key, scope: `plugin:${descriptor.id}:invoke`, request_digest: "" },
      deadline: deadline(),
      version: CONTRACT_VERSION,
      payload: { instance_ref: request.instance_ref, capability: request.capability, input: request.input },
    });
    if (!result.ok) return managerFailure(result.failure);
    return { ok: true, value: result.value };
  }

  async cancel(request: CancelCapabilityRequest): Promise<PluginManagerResult<CancelValue>> {
    const plugin = this.#instances.get(instanceKey(request.plugin_id, request.plugin_version));
    if (plugin === undefined) return { ok: false, failure: unresolvedPluginFailure(request.plugin_id, request.plugin_version) };

    const result = await plugin.cancel({
      operation: "cancel",
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: { key: `cancel:${request.instance_ref}`, scope: `plugin:${request.plugin_id}:cancel`, request_digest: "" },
      deadline: deadline(),
      version: CONTRACT_VERSION,
      payload: { instance_ref: request.instance_ref, reason: request.reason },
    });
    if (!result.ok) return managerFailure(result.failure);
    return { ok: true, value: result.value };
  }

  async dispose(request: DisposeCapabilityRequest): Promise<PluginManagerResult<DisposeValue>> {
    const plugin = this.#instances.get(instanceKey(request.plugin_id, request.plugin_version));
    if (plugin === undefined) return { ok: false, failure: unresolvedPluginFailure(request.plugin_id, request.plugin_version) };

    const result = await plugin.dispose({
      operation: "dispose",
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: { key: `dispose:${request.instance_ref}`, scope: `plugin:${request.plugin_id}:dispose`, request_digest: "" },
      deadline: deadline(),
      version: CONTRACT_VERSION,
      payload: { instance_ref: request.instance_ref },
    });
    if (!result.ok) return managerFailure(result.failure);
    return { ok: true, value: result.value };
  }

  async #resolveOne(
    query: ResolvePluginQuery,
  ): Promise<
    | Readonly<{ ok: true; value: Readonly<{ descriptor: PluginDescriptor; plugin: Plugin }> }>
    | Readonly<{ ok: false; failure: PluginFailure }>
  > {
    const resolved = await this.#registry.resolve(query);
    if (!resolved.ok) {
      return { ok: false, failure: registryFailure("unsupported_capability", resolved.failure.message) };
    }
    if (resolved.value.length === 0) {
      return {
        ok: false,
        failure: registryFailure(
          "unsupported_capability",
          `No enabled plugin implements interface "${query.interface}" capability "${query.capability}" for environment "${query.environment}".`,
        ),
      };
    }
    if (resolved.value.length > 1) {
      // SPEC-305 §5: "Plugins SHALL NOT be selected from unverified model
      // preference" — an ambiguous match is a configuration error the
      // caller/operator must resolve (e.g. narrow enablement scope), not
      // something this Manager guesses at by picking the first result.
      return {
        ok: false,
        failure: registryFailure(
          "unsupported_capability",
          `Ambiguous plugin resolution: ${resolved.value.length} enabled plugins match interface "${query.interface}" capability "${query.capability}" for environment "${query.environment}".`,
        ),
      };
    }

    const descriptor = resolved.value[0] as PluginDescriptor;
    const plugin = this.#instances.get(instanceKey(descriptor.id, descriptor.version));
    if (plugin === undefined) {
      return { ok: false, failure: unresolvedPluginFailure(descriptor.id, descriptor.version) };
    }
    return { ok: true, value: { descriptor, plugin } };
  }
}

function instanceKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

function managerFailure(failure: PluginFailure): PluginManagerResult<never> {
  return { ok: false, failure };
}

function registryFailure(code: PluginFailureCode, message: string): PluginFailure {
  return {
    code,
    retryable: false,
    responsible_domain: "manager",
    message,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function unresolvedPluginFailure(pluginId: string, version: string): PluginFailure {
  return registryFailure("instance_unavailable", `No initialized plugin instance for "${pluginId}@${version}".`);
}
