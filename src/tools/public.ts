import { createHash } from "node:crypto";

import type { JsonObject, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-510 (Agent Tool Contract): "capability-based Tool discovery and
 * invocation while keeping provider SDKs and external technologies outside
 * Agent and Skill logic." No Tool implementation exists anywhere in this
 * repository yet — `allowed_tools` on `AgentRunStartRequest` is only a
 * `VersionReference[]` allowlist, not this contract. This module defines
 * the provider-neutral interface; `src/adapters/replay/deterministic-tool.ts`
 * is the required deterministic fake/replay adapter (§6), proven against a
 * shared contract suite the same way every other adapter seam in this
 * repository is.
 */
export type ToolOperation = "list_capabilities" | "validate_call" | "invoke" | "inspect_effect" | "compensate";

export type ToolDataClass = "public" | "internal" | "restricted" | "sensitive";

export type ToolEffectClass = "read" | "write" | "destructive";

/** SPEC-510 §3: "Descriptors SHALL declare stable identity and version, input/output schemas, data classes, read/write/destructive classification, side effects, idempotency, required authority, approval, timeout, rate and cost limits, and compensation support." */
export type ToolDescriptor = Readonly<{
  tool: VersionReference;
  contract_versions: Readonly<{ input_schema: string; output_schema: string }>;
  data_classes: readonly ToolDataClass[];
  effect_class: ToolEffectClass;
  idempotent: boolean;
  required_permissions: readonly string[];
  requires_approval: boolean;
  timeout_seconds: number;
  rate_limit_per_minute: number;
  cost_limit: number;
  compensation_supported: boolean;
}>;

/** SPEC-510 §3: "Calls SHALL contain run, step, Workspace, actor and policy identity; exact Tool version; validated arguments; purpose; deadline; idempotency key; authorization proof; and evidence requirements." */
export type ToolCall = Readonly<{
  tool: VersionReference;
  run_id: string;
  step_id: string;
  workspace: WorkspaceContext;
  policy_version: string;
  /** Validated, schema-checked arguments — never a free-form provider command (SPEC-510 §3). */
  arguments: JsonObject;
  purpose: string;
  deadline: string;
  idempotency_key: string;
  authorization_proof: string;
  evidence_requirements: readonly string[];
}>;

export type ToolPolicyDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reasons: readonly ToolPolicyDenialReason[] }>;

export type ToolPolicyDenialReason =
  | "unknown_tool_version"
  | "missing_required_permission"
  | "approval_required"
  | "rate_limit_exceeded"
  | "cost_limit_exceeded"
  | "invalid_arguments"
  | "invalid_authorization_proof";

/** SPEC-510 §4: distinguishes success, denial, invalid input, not found, conflict, throttling, timeout, provider failure, partial effect, and unknown effect. */
export type ToolResultCode =
  | "success"
  | "denial"
  | "invalid_input"
  | "not_found"
  | "conflict"
  | "throttling"
  | "timeout"
  | "provider_failure"
  | "partial_effect"
  | "unknown_effect";

export type ToolResultValue = Readonly<{
  code: ToolResultCode;
  /** Normalized, provider-neutral output — never a raw provider SDK response (SPEC-510 §4). */
  output: JsonObject;
  /** Secrets SHALL be referenced, never returned as output (SPEC-510 §5) — evidence carries refs, not raw content. */
  redacted_evidence: readonly string[];
  timing: Readonly<{ started_at: string; completed_at: string; duration_ms: number }>;
  usage: Readonly<{ cost?: number }>;
  effect_status: "none" | "applied" | "partial" | "unknown";
  call_reference: string;
}>;

export type ToolResultFailure = Readonly<{
  code: Exclude<ToolResultCode, "success">;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type ToolResult =
  | Readonly<{ ok: true; value: ToolResultValue }>
  | Readonly<{ ok: false; failure: ToolResultFailure }>;

export type ToolEffectStatus = Readonly<{
  call_reference: string;
  effect_status: "none" | "applied" | "partial" | "unknown";
  observed_at: string;
}>;

export type ToolCompensationAuthorization = Readonly<{
  actor_id: string;
  approval_ref: string;
}>;

export type ToolCompensationResult =
  | Readonly<{ ok: true; value: Readonly<{ compensated: boolean; residual_effect: readonly string[] }> }>
  | Readonly<{ ok: false; failure: Readonly<{ code: "not_supported" | "already_compensated" | "compensation_failed"; message: string }> }>;

/**
 * The provider-neutral seam ADR-007/ADR-009 require between Agent/Skill
 * logic and any external technology: an implementation adapts exactly one
 * technology to this interface, and Agent/Skill code never imports that
 * technology directly.
 */
export interface Tool {
  list_capabilities(context: WorkspaceContext): Promise<readonly ToolDescriptor[]>;
  validate_call(call: ToolCall): Promise<ToolPolicyDecision>;
  invoke(call: ToolCall): Promise<ToolResult>;
  inspect_effect(callReference: string): Promise<ToolEffectStatus | undefined>;
  compensate(
    callReference: string,
    authorization: ToolCompensationAuthorization,
  ): Promise<ToolCompensationResult>;
}

/** Deterministic digest over a call's identity, excluding volatile fields — used to detect a replayed vs. genuinely new call under the same idempotency_key. */
export function toolCallDigest(call: ToolCall): string {
  const canonical = {
    tool: call.tool,
    run_id: call.run_id,
    step_id: call.step_id,
    workspace_id: call.workspace.workspace_id,
    arguments: call.arguments,
    purpose: call.purpose,
    idempotency_key: call.idempotency_key,
  };
  return `sha256:${createHash("sha256").update(stableStringify(canonical)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}
