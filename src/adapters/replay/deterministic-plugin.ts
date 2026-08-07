import {
  pluginInvocationDigest,
  type CancelRequest,
  type DescriptorRequest,
  type DisposeRequest,
  type HealthRequest,
  type InitializeRequest,
  type InvokeRequest,
  type Plugin,
  type PluginDescriptor,
  type PluginFailure,
  type PluginOperation,
  type PluginOperationMap,
  type PluginProvider,
  type PluginRequest,
  type PluginResult,
  type ValidateConfigurationRequest,
} from "../../plugins/public.js";
import type {
  JsonObject,
  WorkspaceAuthorizationFailure,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

/**
 * One scripted invocation's scenario, keyed by `capability`: whether
 * `validateConfiguration`/`initialize` succeed, and what `invoke` returns.
 * Mirrors `ScriptedExecutionScenario`'s "script by identity, not by literal
 * request" shape from `deterministic-execution-engine.ts`.
 */
export type ScriptedPluginScenario = Readonly<{
  configuration_valid?: boolean;
  configuration_errors?: readonly string[];
  outcome: "success" | "failure" | "partial";
  output?: JsonObject;
  diagnostics?: readonly string[];
  evidence?: readonly string[];
  retryable?: boolean;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  authorizer: WorkspaceAuthorizer;
  provider: PluginProvider;
  descriptor: PluginDescriptor;
  scenarios: ReadonlyMap<string, ScriptedPluginScenario>;
}>;

type InvokeRecord = Readonly<{
  digest: string;
  result: PluginResult<"invoke">;
}>;

const PERMISSION_BY_OPERATION: Readonly<Record<string, string>> = Object.freeze({
  descriptor: "plugin:read",
  validateConfiguration: "plugin:read",
  initialize: "plugin:initialize",
  health: "plugin:read",
  invoke: "plugin:invoke",
  cancel: "plugin:cancel",
  dispose: "plugin:dispose",
});

/**
 * SPEC-503 §8's required "deterministic fake/replay adapter exercising the
 * same contract" every production plugin needs. Never throws for a
 * domain-level failure — a normal `PluginResult` with `ok:false`, matching
 * every other adapter seam in this repository (ADR-016 §4's pattern).
 */
export class DeterministicPlugin implements Plugin {
  readonly #clock: Clock;
  readonly #authorizer: WorkspaceAuthorizer;
  readonly #provider: PluginProvider;
  readonly #descriptor: PluginDescriptor;
  readonly #scenarios: ReadonlyMap<string, ScriptedPluginScenario>;
  readonly #instances = new Set<string>();
  readonly #invocations = new Map<string, InvokeRecord>();
  readonly #cancelled = new Set<string>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#authorizer = dependencies.authorizer;
    this.#provider = dependencies.provider;
    this.#descriptor = dependencies.descriptor;
    this.#scenarios = dependencies.scenarios;
  }

  async descriptor(request: DescriptorRequest): Promise<PluginResult<"descriptor">> {
    const authorized = await this.#authorize(request, "descriptor");
    if (!authorized.ok) return this.#deny(request, "descriptor", authorized.failure);
    return this.#envelope(request, "descriptor", {
      ok: true,
      value: {
        descriptor: this.#descriptor,
        supported_contract_versions: ["1.0.0"],
        health: "healthy",
      },
    });
  }

  async validateConfiguration(
    request: ValidateConfigurationRequest,
  ): Promise<PluginResult<"validateConfiguration">> {
    const authorized = await this.#authorize(request, "validateConfiguration");
    if (!authorized.ok) return this.#deny(request, "validateConfiguration", authorized.failure);

    const scenario = this.#scenarios.get("configure");
    return this.#envelope(request, "validateConfiguration", {
      ok: true,
      value: {
        valid: scenario?.configuration_valid ?? true,
        errors: scenario?.configuration_errors ?? [],
      },
    });
  }

  async initialize(request: InitializeRequest): Promise<PluginResult<"initialize">> {
    const authorized = await this.#authorize(request, "initialize");
    if (!authorized.ok) return this.#deny(request, "initialize", authorized.failure);

    const instanceRef = `instance:${request.workspace.workspace_id}:${request.operationId}`;
    this.#instances.add(instanceRef);
    return this.#envelope(request, "initialize", {
      ok: true,
      value: { instance_ref: instanceRef, resolved_versions: { plugin: this.#descriptor.version } },
    });
  }

  async health(request: HealthRequest): Promise<PluginResult<"health">> {
    const authorized = await this.#authorize(request, "health");
    if (!authorized.ok) return this.#deny(request, "health", authorized.failure);

    if (!this.#instances.has(request.payload.instance_ref)) {
      return this.#envelope(request, "health", {
        ok: false,
        failure: unavailableInstance(request.payload.instance_ref),
      });
    }
    return this.#envelope(request, "health", {
      ok: true,
      value: { health: "healthy", capabilities: this.#descriptor.capabilities, capacity: {} },
    });
  }

  async invoke(request: InvokeRequest): Promise<PluginResult<"invoke">> {
    const authorized = await this.#authorize(request, "invoke");
    if (!authorized.ok) return this.#deny(request, "invoke", authorized.failure);

    if (!this.#instances.has(request.payload.instance_ref)) {
      return this.#envelope(request, "invoke", {
        ok: false,
        failure: unavailableInstance(request.payload.instance_ref),
      });
    }

    const invocationKey = invocationStateKey(request);
    const digest = pluginInvocationDigest(request);
    const existing = this.#invocations.get(invocationKey);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        return this.#envelope(request, "invoke", {
          ok: false,
          failure: {
            code: "idempotency_conflict",
            retryable: false,
            responsible_domain: "caller",
            message: "A different invoke request was already retained for this idempotency key.",
            details: {},
            diagnostic_evidence_refs: [],
          },
        });
      }
      return existing.result;
    }

    const scenario = this.#scenarios.get(request.payload.capability);
    if (scenario === undefined) {
      const result = this.#envelope(request, "invoke", {
        ok: false,
        failure: unscriptedFailure(request.payload.capability),
      });
      this.#invocations.set(invocationKey, { digest, result });
      return result;
    }

    let result: PluginResult<"invoke">;
    if (this.#cancelled.has(instanceCancellationKey(request.workspace.workspace_id, request.payload.instance_ref))) {
      result = this.#envelope(request, "invoke", {
        ok: true,
        value: {
          outcome: "partial",
          output: {},
          diagnostics: ["cancelled before completion"],
          evidence: scenario.evidence ?? [],
          retryable: false,
        },
      });
    } else {
      result = this.#envelope(request, "invoke", {
        ok: true,
        value: {
          outcome: scenario.outcome,
          output: scenario.output ?? {},
          diagnostics: scenario.diagnostics ?? [],
          evidence: scenario.evidence ?? [],
          retryable: scenario.retryable ?? false,
        },
      });
    }

    this.#invocations.set(invocationKey, { digest, result });
    return result;
  }

  async cancel(request: CancelRequest): Promise<PluginResult<"cancel">> {
    const authorized = await this.#authorize(request, "cancel");
    if (!authorized.ok) return this.#deny(request, "cancel", authorized.failure);

    this.#cancelled.add(instanceCancellationKey(request.workspace.workspace_id, request.payload.instance_ref));
    return this.#envelope(request, "cancel", { ok: true, value: { accepted: true, already_terminal: false } });
  }

  async dispose(request: DisposeRequest): Promise<PluginResult<"dispose">> {
    const authorized = await this.#authorize(request, "dispose");
    if (!authorized.ok) return this.#deny(request, "dispose", authorized.failure);

    this.#instances.delete(request.payload.instance_ref);
    return this.#envelope(request, "dispose", { ok: true, value: { disposed: true, residual_resources: [] } });
  }

  async #authorize(
    request: Readonly<{ workspace: WorkspaceContext; operationId: string }>,
    operation: string,
  ): Promise<WorkspaceAuthorizationResult> {
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operationId,
      context: request.workspace,
      purpose: `plugin:${operation}`,
      consequence_class: "reversible",
      required_permissions: [PERMISSION_BY_OPERATION[operation] ?? "plugin:invoke"],
      resource_refs: [`workspace:${request.workspace.workspace_id}`],
    };
    return this.#authorizer.authorize(authorizationRequest);
  }

  #envelope<Operation extends PluginOperation>(
    request: PluginRequest<Operation>,
    operation: Operation,
    outcome:
      | Readonly<{ ok: true; value: PluginOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: PluginFailure }>,
  ): PluginResult<Operation> {
    const now = this.#clock.now();
    const envelope = {
      operation,
      operationId: request.operationId,
      workspace: request.workspace,
      idempotency: request.idempotency,
      deadline: request.deadline,
      version: request.version,
      provider: this.#provider,
      timing: { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 },
      warnings: [],
      evidence: outcome.ok && "evidence" in outcome.value ? (outcome.value as { evidence?: readonly string[] }).evidence ?? [] : [],
    };
    return { ...envelope, ...outcome } as PluginResult<Operation>;
  }

  #deny<Operation extends PluginOperation>(
    request: PluginRequest<Operation>,
    operation: Operation,
    authorizationFailure: WorkspaceAuthorizationFailure,
  ): PluginResult<Operation> {
    return this.#envelope(request, operation, {
      ok: false,
      failure: {
        code: "workspace_denied",
        retryable: false,
        responsible_domain: "workspace",
        message: authorizationFailure.message,
        details: {},
        diagnostic_evidence_refs: [],
      },
    });
  }
}

function invocationStateKey(request: InvokeRequest): string {
  return `${request.workspace.workspace_id}:${request.payload.instance_ref}:${request.idempotency.key}`;
}

function instanceCancellationKey(workspaceId: string, instanceRef: string): string {
  return `${workspaceId}:${instanceRef}`;
}

function unavailableInstance(instanceRef: string): PluginFailure {
  return {
    code: "instance_unavailable",
    retryable: false,
    responsible_domain: "caller",
    message: `No initialized instance for ${instanceRef}.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}

function unscriptedFailure(capability: string): PluginFailure {
  return {
    code: "unsupported_capability",
    retryable: false,
    responsible_domain: "caller",
    message: `No scripted scenario for capability ${capability}.`,
    details: {},
    diagnostic_evidence_refs: [],
  };
}
