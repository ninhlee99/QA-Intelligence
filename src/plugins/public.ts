import { createHash } from "node:crypto";

import { stableStringify } from "../shared/stable-stringify.js";
import type { JsonObject, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-503 Plugin Contract: the provider-neutral lifecycle, capability,
 * permission, health, invocation, and evidence protocol every plugin
 * (Git per SPEC-409, Playwright per SPEC-407, or any future provider)
 * implements so the Core Platform, Plugin Manager (SPEC-305), and Plugin
 * Registry (SPEC-405) never depend on a provider SDK directly. Mirrors the
 * request/result envelope and idempotency-digest pattern
 * `src/execution-engine/public.ts` established for SPEC-504, adapted to
 * SPEC-503 §3's distinct, provider-agnostic lifecycle
 * (validate/initialize/health/invoke/cancel/dispose) instead of a fixed
 * execution-specific operation set — a Plugin's own invocation payloads and
 * capability vocabulary are declared by its descriptor, not this contract,
 * since SPEC-503 §1 makes this module the single source of truth for the
 * protocol shared across every plugin kind, not any one plugin's domain.
 */

export type PluginLifecycleStatus =
  | "discovered"
  | "validated"
  | "installed"
  | "enabled"
  | "disabled"
  | "retired";

/** SPEC-503 §2: identity, version, interface versions, capabilities, permissions, configuration schema, environments, compatibility, integrity, owner, support lifecycle. */
export type PluginDescriptor = Readonly<{
  id: string;
  version: string;
  status: PluginLifecycleStatus;
  interfaces: readonly string[];
  capabilities: readonly string[];
  permissions: readonly string[];
  configuration_schema: string;
  supported_environments: readonly string[];
  compatibility: readonly VersionReference[];
  owner: string;
  integrity: Readonly<{ algorithm: string; digest: string }>;
}>;

export type PluginOperation = "descriptor" | "validateConfiguration" | "initialize" | "health" | "invoke" | "cancel" | "dispose";

export type PluginIdempotency = Readonly<{
  key: string;
  scope: string;
  request_digest: string;
}>;

export type PluginDeadline = Readonly<{
  at: string;
  time_standard: "UTC";
}>;

export type PluginContractVersion = Readonly<{
  contract: "1.0.0";
  operation_schema: "1.0.0";
}>;

export type DescriptorPayload = Readonly<{
  required_capabilities: readonly string[];
}>;

export type DescriptorValue = Readonly<{
  descriptor: PluginDescriptor;
  supported_contract_versions: readonly string[];
  health: "healthy" | "degraded" | "unavailable";
}>;

export type ValidateConfigurationPayload = Readonly<{
  configuration: JsonObject;
}>;

export type ValidateConfigurationValue = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

/** SPEC-503 §3: "receive only approved Workspace-scoped configuration and secret references." */
export type InitializePayload = Readonly<{
  configuration: JsonObject;
  secret_refs: readonly string[];
}>;

export type InitializeValue = Readonly<{
  instance_ref: string;
  resolved_versions: Readonly<Record<string, string>>;
}>;

export type HealthPayload = Readonly<{
  instance_ref: string;
}>;

export type HealthValue = Readonly<{
  health: "healthy" | "degraded" | "unavailable";
  capabilities: readonly string[];
  capacity: JsonObject;
}>;

/** SPEC-503 §4: typed input is opaque to this contract — the invoking capability's own schema governs shape. */
export type InvokePayload = Readonly<{
  instance_ref: string;
  capability: string;
  input: JsonObject;
}>;

export type PluginInvocationOutcome = "success" | "failure" | "partial";

export type InvokeValue = Readonly<{
  outcome: PluginInvocationOutcome;
  output: JsonObject;
  diagnostics: readonly string[];
  evidence: readonly string[];
  retryable: boolean;
}>;

export type CancelPayload = Readonly<{
  instance_ref: string;
  reason: string;
}>;

export type CancelValue = Readonly<{
  accepted: boolean;
  already_terminal: boolean;
}>;

export type DisposePayload = Readonly<{
  instance_ref: string;
}>;

export type DisposeValue = Readonly<{
  disposed: boolean;
  residual_resources: readonly string[];
}>;

export interface PluginOperationMap {
  readonly descriptor: Readonly<{ request: DescriptorPayload; value: DescriptorValue }>;
  readonly validateConfiguration: Readonly<{ request: ValidateConfigurationPayload; value: ValidateConfigurationValue }>;
  readonly initialize: Readonly<{ request: InitializePayload; value: InitializeValue }>;
  readonly health: Readonly<{ request: HealthPayload; value: HealthValue }>;
  readonly invoke: Readonly<{ request: InvokePayload; value: InvokeValue }>;
  readonly cancel: Readonly<{ request: CancelPayload; value: CancelValue }>;
  readonly dispose: Readonly<{ request: DisposePayload; value: DisposeValue }>;
}

export type PluginRequest<Operation extends PluginOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  workspace: WorkspaceContext;
  idempotency: PluginIdempotency;
  deadline: PluginDeadline;
  version: PluginContractVersion;
  payload: PluginOperationMap[Operation]["request"];
}>;

export type DescriptorRequest = PluginRequest<"descriptor">;
export type ValidateConfigurationRequest = PluginRequest<"validateConfiguration">;
export type InitializeRequest = PluginRequest<"initialize">;
export type HealthRequest = PluginRequest<"health">;
export type InvokeRequest = PluginRequest<"invoke">;
export type CancelRequest = PluginRequest<"cancel">;
export type DisposeRequest = PluginRequest<"dispose">;

/** SPEC-503 §6/§7: keeps plugin, permission, compatibility, and platform failure classes distinct. */
export type PluginFailureCode =
  | "invalid_request"
  | "unsupported_version"
  | "unsupported_capability"
  | "workspace_denied"
  | "policy_denied"
  | "invalid_configuration"
  | "incompatible_interface"
  | "instance_unavailable"
  | "deadline_exceeded"
  | "cancelled"
  | "idempotency_conflict"
  | "provider_failure"
  | "dispose_incomplete";

export type PluginFailure = Readonly<{
  code: PluginFailureCode;
  retryable: boolean;
  responsible_domain: "caller" | "workspace" | "policy" | "manager" | "plugin" | "infrastructure";
  message: string;
  details: JsonObject;
  diagnostic_evidence_refs: readonly string[];
}>;

export type PluginProvider = Readonly<{
  id: string;
  version: string;
}>;

export type PluginTiming = Readonly<{
  started_at: string;
  completed_at: string;
  duration_ms: number;
}>;

type PluginResultEnvelope<Operation extends PluginOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  workspace: WorkspaceContext;
  idempotency: PluginIdempotency;
  deadline: PluginDeadline;
  version: PluginContractVersion;
  provider: PluginProvider;
  timing: PluginTiming;
  warnings: readonly string[];
  evidence: readonly string[];
}>;

export type PluginResult<Operation extends PluginOperation> =
  PluginResultEnvelope<Operation> &
    (
      | Readonly<{ ok: true; value: PluginOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: PluginFailure }>
    );

export interface Plugin {
  descriptor(request: DescriptorRequest): Promise<PluginResult<"descriptor">>;
  validateConfiguration(request: ValidateConfigurationRequest): Promise<PluginResult<"validateConfiguration">>;
  initialize(request: InitializeRequest): Promise<PluginResult<"initialize">>;
  health(request: HealthRequest): Promise<PluginResult<"health">>;
  invoke(request: InvokeRequest): Promise<PluginResult<"invoke">>;
  cancel(request: CancelRequest): Promise<PluginResult<"cancel">>;
  dispose(request: DisposeRequest): Promise<PluginResult<"dispose">>;
}

/** Canonical digest binding excludes only the digest field itself (mirrors executionRequestDigest). */
export function pluginInvocationDigest<Operation extends PluginOperation>(
  request: PluginRequest<Operation>,
): string {
  const canonical = {
    ...request,
    idempotency: {
      ...request.idempotency,
      request_digest: "",
    },
  };
  return `sha256:${createHash("sha256").update(stableStringify(canonical)).digest("hex")}`;
}
