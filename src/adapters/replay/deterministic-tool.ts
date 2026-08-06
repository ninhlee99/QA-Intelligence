import { randomUUID } from "node:crypto";

import {
  toolCallDigest,
  type Tool,
  type ToolCall,
  type ToolCompensationAuthorization,
  type ToolCompensationResult,
  type ToolDescriptor,
  type ToolEffectStatus,
  type ToolPolicyDecision,
  type ToolPolicyDenialReason,
  type ToolResult,
} from "../../tools/public.js";
import type { JsonObject, WorkspaceContext } from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

/** One scripted call's scenario, keyed by `idempotency_key`. */
export type ScriptedToolScenario = Readonly<{
  code: "success" | "partial_effect" | "timeout" | "provider_failure" | "unknown_effect";
  output?: JsonObject;
  redacted_evidence?: readonly string[];
  effect_status?: "none" | "applied" | "partial" | "unknown";
  compensation_supported?: boolean;
}>;

type Dependencies = Readonly<{
  clock: Clock;
  descriptor: ToolDescriptor;
  scenarios: ReadonlyMap<string, ScriptedToolScenario>;
}>;

type InvokedRecord = Readonly<{
  digest: string;
  result: ToolResult;
  callReference: string;
}>;

/**
 * SPEC-510 §6's required deterministic fake/replay Tool adapter. No real
 * Tool implementation exists in this repository (Playwright/HTTP/other
 * providers are all separately scoped, blocked the same way SPEC-407's
 * Playwright plugin is — see ROADMAP's SPEC-504 entry), so this adapter's
 * scenarios are scripted rather than wrapping a real one; it still proves
 * every structural guarantee SPEC-510 §5 requires (least privilege,
 * idempotency, redaction, effect tracking, compensation) against a real
 * `Tool` implementation rather than only type-level checking.
 */
export class DeterministicTool implements Tool {
  readonly #clock: Clock;
  readonly #descriptor: ToolDescriptor;
  readonly #scenarios: ReadonlyMap<string, ScriptedToolScenario>;
  readonly #invoked = new Map<string, InvokedRecord>();
  readonly #compensated = new Set<string>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#descriptor = dependencies.descriptor;
    this.#scenarios = dependencies.scenarios;
  }

  async list_capabilities(_context: WorkspaceContext): Promise<readonly ToolDescriptor[]> {
    return [this.#descriptor];
  }

  async validate_call(call: ToolCall): Promise<ToolPolicyDecision> {
    const reasons: ToolPolicyDenialReason[] = [];

    if (call.tool.id !== this.#descriptor.tool.id || call.tool.version !== this.#descriptor.tool.version) {
      reasons.push("unknown_tool_version");
    }
    for (const permission of this.#descriptor.required_permissions) {
      if (!call.workspace.permissions.includes(permission)) {
        reasons.push("missing_required_permission");
        break;
      }
    }
    if (this.#descriptor.requires_approval && call.authorization_proof.length === 0) {
      reasons.push("approval_required");
    }
    if (call.authorization_proof.length === 0 && !this.#descriptor.requires_approval) {
      reasons.push("invalid_authorization_proof");
    }

    // Whether a scripted scenario exists for this idempotency_key is a
    // simulator-internal detail, not a policy decision — a real Tool
    // adapter has no equivalent concept at validate_call() time (SPEC-510
    // §4 already gives invoke() its own `not_found` result code for this).
    // Conflating the two here made `invoke()`'s not_found branch dead code.
    if (reasons.length > 0) return { allowed: false, reasons };
    return { allowed: true };
  }

  async invoke(call: ToolCall): Promise<ToolResult> {
    const validation = await this.validate_call(call);
    if (!validation.allowed) {
      return {
        ok: false,
        failure: {
          code: "denial",
          message: `Call denied by policy: ${validation.reasons.join(", ")}`,
          retryable: false,
          evidence: [],
        },
      };
    }

    const digest = toolCallDigest(call);
    const existing = this.#invoked.get(call.idempotency_key);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        return {
          ok: false,
          failure: {
            code: "conflict",
            message: "A different call was already invoked under this idempotency_key.",
            retryable: false,
            evidence: [],
          },
        };
      }
      // SPEC-510 §5/§6 idempotency: a duplicate call SHALL NOT re-apply the effect.
      return existing.result;
    }

    const scenario = this.#scenarios.get(call.idempotency_key);
    if (scenario === undefined) {
      return {
        ok: false,
        failure: { code: "not_found", message: "No scripted scenario for this idempotency_key.", retryable: false, evidence: [] },
      };
    }

    const callReference = `tool-call:${randomUUID()}`;
    const now = this.#clock.now();
    const timing = { started_at: now.toISOString(), completed_at: now.toISOString(), duration_ms: 0 };
    const redacted = scenario.redacted_evidence ?? [];

    let result: ToolResult;
    if (scenario.code === "timeout") {
      result = { ok: false, failure: { code: "timeout", message: "Tool call exceeded its deadline.", retryable: true, evidence: redacted } };
    } else if (scenario.code === "provider_failure") {
      result = { ok: false, failure: { code: "provider_failure", message: "The underlying provider reported a failure.", retryable: true, evidence: redacted } };
    } else {
      result = {
        ok: true,
        value: {
          code: scenario.code,
          output: scenario.output ?? {},
          redacted_evidence: redacted,
          timing,
          usage: {},
          effect_status: scenario.effect_status ?? (scenario.code === "partial_effect" ? "partial" : "applied"),
          call_reference: callReference,
        },
      };
    }

    this.#invoked.set(call.idempotency_key, { digest, result, callReference });
    return result;
  }

  async inspect_effect(callReference: string): Promise<ToolEffectStatus | undefined> {
    for (const record of this.#invoked.values()) {
      if (record.callReference !== callReference) continue;
      if (!record.result.ok) return undefined;
      return {
        call_reference: callReference,
        effect_status: record.result.value.effect_status,
        observed_at: this.#clock.now().toISOString(),
      };
    }
    return undefined;
  }

  async compensate(
    callReference: string,
    _authorization: ToolCompensationAuthorization,
  ): Promise<ToolCompensationResult> {
    if (!this.#descriptor.compensation_supported) {
      return { ok: false, failure: { code: "not_supported", message: "This Tool does not support compensation." } };
    }
    if (this.#compensated.has(callReference)) {
      return { ok: false, failure: { code: "already_compensated", message: "This call was already compensated." } };
    }
    const record = [...this.#invoked.values()].find((entry) => entry.callReference === callReference);
    if (record === undefined || !record.result.ok) {
      return { ok: false, failure: { code: "compensation_failed", message: "No applied effect found for this call_reference." } };
    }
    this.#compensated.add(callReference);
    return { ok: true, value: { compensated: true, residual_effect: [] } };
  }
}
