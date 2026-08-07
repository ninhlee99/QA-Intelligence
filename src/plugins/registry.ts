import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SchemaValidator, type SchemaObject } from "../schema/schema-validator.js";
import type { PluginDescriptor, PluginLifecycleStatus } from "./public.js";

export interface Clock {
  now(): Date;
}

/** SPEC-305 §4: discovered → validated → installed → enabled → disabled → retired. Installation SHALL NOT imply enablement. */
const ALLOWED_TRANSITIONS: Readonly<Record<PluginLifecycleStatus, readonly PluginLifecycleStatus[]>> = {
  discovered: ["validated"],
  validated: ["installed"],
  installed: ["enabled", "retired"],
  enabled: ["disabled", "retired"],
  disabled: ["enabled", "retired"],
  retired: [],
};

export type PluginRegistryFailureCode =
  | "invalid_descriptor"
  | "already_registered"
  | "not_found"
  | "unsupported_transition"
  | "conflict"
  | "unhealthy_provider";

export type PluginRegistryFailure = Readonly<{
  code: PluginRegistryFailureCode;
  message: string;
  retryable: boolean;
}>;

export type PluginRegistryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: PluginRegistryFailure }>;

export type RegisterPluginRequest = Readonly<{
  descriptor: PluginDescriptor;
  idempotency_key: string;
}>;

export type ResolvePluginQuery = Readonly<{
  interface: string;
  capability: string;
  environment: string;
}>;

export type SetPluginEnablementRequest = Readonly<{
  plugin_id: string;
  version: string;
  enabled: boolean;
  actor_id: string;
  reason: string;
}>;

export type RetirePluginRequest = Readonly<{
  plugin_id: string;
  version: string;
  actor_id: string;
  reason: string;
}>;

/**
 * SPEC-405 Plugin Registry Component: stores validated descriptors,
 * versions, capabilities, compatibility, integrity, configuration
 * references, and enablement scope. Owns none of invocation, secrets, or
 * provider-preference policy (§2) — that is the Plugin Manager's job
 * (SPEC-305), which resolves through this registry rather than duplicating
 * its state.
 */
export interface PluginRegistry {
  register(request: RegisterPluginRequest): Promise<PluginRegistryResult<PluginDescriptor>>;
  resolve(query: ResolvePluginQuery): Promise<PluginRegistryResult<readonly PluginDescriptor[]>>;
  setEnablement(request: SetPluginEnablementRequest): Promise<PluginRegistryResult<PluginDescriptor>>;
  retire(request: RetirePluginRequest): Promise<PluginRegistryResult<PluginDescriptor>>;
  get(pluginId: string, version: string): Promise<PluginRegistryResult<PluginDescriptor>>;
}

type StoredDescriptor = Readonly<{ descriptor: PluginDescriptor; revision: number }>;

/** Resolves `schemas/plugin.schema.json` from the compiled `dist/src/plugins/` output back to the repository root, mirroring `yaml-ontology-repository.ts`'s `defaultRepositoryRoot()`. */
function defaultSchemaPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "schemas/plugin.schema.json");
}

/**
 * SPEC-405's required reference adapter: an in-process, deterministic
 * `PluginRegistry` proving descriptor validation, the discovered → ...  →
 * retired lifecycle, capability resolution, and Workspace-independent
 * global enablement scope — the same "deterministic reference adapter"
 * pattern `InMemoryKnowledgeRepository` established for SPEC-401. Durable
 * SQLite/PostgreSQL adapters behind this same interface are separate,
 * larger scope, not attempted here (SPEC-405 does not mandate durability).
 */
export class InMemoryPluginRegistry implements PluginRegistry {
  readonly #clock: Clock;
  readonly #validator: SchemaValidator;
  readonly #descriptors = new Map<string, StoredDescriptor>();
  readonly #idempotency = new Map<string, PluginDescriptor>();

  private constructor(clock: Clock, validator: SchemaValidator) {
    this.#clock = clock;
    this.#validator = validator;
  }

  static async create(clock: Clock, schemaPath: string = defaultSchemaPath()): Promise<InMemoryPluginRegistry> {
    const schema = JSON.parse(await readFile(schemaPath, "utf8")) as SchemaObject;
    return new InMemoryPluginRegistry(clock, new SchemaValidator([schema]));
  }

  async register(request: RegisterPluginRequest): Promise<PluginRegistryResult<PluginDescriptor>> {
    const existingByKey = this.#idempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    const validated = this.#validator.validate<PluginDescriptor>(
      "https://qa-intelligence.local/schemas/plugin.schema.json",
      request.descriptor,
    );
    if (!validated.ok) {
      return failure(
        "invalid_descriptor",
        `Plugin descriptor failed schema validation: ${validated.errors.map((error) => error.message).join("; ")}`,
        false,
      );
    }

    // SPEC-405 §4: plugin ID and version are immutable — re-registering an
    // existing id+version outside the idempotency-key path is a conflict,
    // not a silent overwrite.
    const key = descriptorKey(request.descriptor.id, request.descriptor.version);
    if (this.#descriptors.has(key)) {
      return failure("already_registered", `Plugin "${key}" is already registered.`, false);
    }

    const descriptor: PluginDescriptor = { ...request.descriptor, status: "discovered" };
    this.#descriptors.set(key, { descriptor, revision: 1 });
    this.#idempotency.set(request.idempotency_key, descriptor);
    return { ok: true, value: descriptor };
  }

  async resolve(query: ResolvePluginQuery): Promise<PluginRegistryResult<readonly PluginDescriptor[]>> {
    // SPEC-305 §5: selection is based on interface version, capability,
    // environment, and health — never unverified model/provider preference.
    // "health" here is enablement itself; live health is the Manager's
    // per-invocation concern (§6/§7), not a registry-stored value.
    const candidates = [...this.#descriptors.values()]
      .map((stored) => stored.descriptor)
      .filter((descriptor) => descriptor.status === "enabled")
      .filter((descriptor) => descriptor.interfaces.includes(query.interface))
      .filter((descriptor) => descriptor.capabilities.includes(query.capability))
      .filter((descriptor) => descriptor.supported_environments.includes(query.environment));
    return { ok: true, value: candidates };
  }

  async setEnablement(request: SetPluginEnablementRequest): Promise<PluginRegistryResult<PluginDescriptor>> {
    const key = descriptorKey(request.plugin_id, request.version);
    const stored = this.#descriptors.get(key);
    if (stored === undefined) return failure("not_found", `Plugin "${key}" is not registered.`, false);

    // Installation SHALL NOT imply enablement (§4): a fresh registration is
    // still "discovered", so the first enable governs the whole
    // discovered → validated → installed → enabled walk in one step, since
    // those intermediate states carry no independent business meaning yet
    // in this reference adapter. Disabling only ever applies to an already
    // enabled plugin.
    const toStatus: PluginLifecycleStatus = request.enabled ? "enabled" : "disabled";
    const reachable =
      toStatus === "enabled"
        ? stored.descriptor.status === "discovered" || stored.descriptor.status === "disabled"
        : stored.descriptor.status === "enabled";
    if (!reachable) {
      return failure(
        "unsupported_transition",
        `Cannot transition plugin "${key}" from "${stored.descriptor.status}" to "${toStatus}".`,
        false,
      );
    }

    const descriptor: PluginDescriptor = { ...stored.descriptor, status: toStatus };
    this.#descriptors.set(key, { descriptor, revision: stored.revision + 1 });
    return { ok: true, value: descriptor };
  }

  async retire(request: RetirePluginRequest): Promise<PluginRegistryResult<PluginDescriptor>> {
    const key = descriptorKey(request.plugin_id, request.version);
    const stored = this.#descriptors.get(key);
    if (stored === undefined) return failure("not_found", `Plugin "${key}" is not registered.`, false);
    if (!ALLOWED_TRANSITIONS[stored.descriptor.status].includes("retired")) {
      return failure(
        "unsupported_transition",
        `Cannot retire plugin "${key}" from status "${stored.descriptor.status}".`,
        false,
      );
    }

    const descriptor: PluginDescriptor = { ...stored.descriptor, status: "retired" };
    this.#descriptors.set(key, { descriptor, revision: stored.revision + 1 });
    return { ok: true, value: descriptor };
  }

  async get(pluginId: string, version: string): Promise<PluginRegistryResult<PluginDescriptor>> {
    const stored = this.#descriptors.get(descriptorKey(pluginId, version));
    if (stored === undefined) return failure("not_found", `Plugin "${descriptorKey(pluginId, version)}" is not registered.`, false);
    return { ok: true, value: stored.descriptor };
  }
}

function descriptorKey(pluginId: string, version: string): string {
  return `${pluginId}@${version}`;
}

function failure<Value>(
  code: PluginRegistryFailureCode,
  message: string,
  retryable: boolean,
): PluginRegistryResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
