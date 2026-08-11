import { stableStringify } from "../../shared/stable-stringify.js";
import type {
  JsonObject,
  ReasoningProvider,
  ReasoningProviderResult,
  ReasoningRequest,
  ReasoningValue,
  VersionReference,
  WorkspaceContext,
} from "../../requirement-review/public.js";

export type ScriptedReasoningRequestMatch = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  purpose: string;
  workspace_id: string;
  actor_id: string;
  policy_version: string;
  consequence_class: ReasoningRequest["consequence_class"];
  capability_constraints: readonly string[];
  prompt: VersionReference;
  authorized_context_refs: readonly string[];
  output_schema: VersionReference;
  allowed_tools: readonly VersionReference[];
  limits: ReasoningRequest["limits"];
  safety_policy: VersionReference;
}>;

export type ScriptedReasoningProviderIdentity = Readonly<{
  provider_id: string;
  provider_version: string;
  model_id: string;
}>;

export type ScriptedCompletedOutcome = Readonly<{
  kind: "completed";
  structured_output: JsonObject;
  usage: ReasoningValue["usage"];
  latency_ms: number;
  citations: readonly string[];
  safety_outcomes?: readonly string[];
  tool_calls?: readonly JsonObject[];
  diagnostics?: JsonObject;
}>;

export type ScriptedSafetyRefusalOutcome = Readonly<{
  kind: "safety_refusal";
  message: string;
  evidence: readonly string[];
}>;

export type ScriptedTimeoutOutcome = Readonly<{
  kind: "timeout";
  message: string;
  elapsed_ms: number;
  evidence: readonly string[];
}>;

type ScriptedSchemaFailureBase = Readonly<{
  message: string;
  schema: VersionReference;
  evidence: readonly string[];
}>;

export type ScriptedInvalidOutputOutcome = ScriptedSchemaFailureBase & Readonly<{
  kind: "invalid_output";
}>;

export type ScriptedSchemaFailureOutcome = ScriptedSchemaFailureBase & Readonly<{
  kind: "schema_failure";
}>;

export type ScriptedPromptInjectionOutcome = Readonly<{
  kind: "prompt_injection";
  message: string;
  requested_tools: readonly VersionReference[];
  evidence: readonly string[];
}>;

export type ScriptedUsageLimitOutcome = Readonly<{
  kind: "usage_limit";
  message: string;
  usage: ReasoningValue["usage"];
  evidence: readonly string[];
}>;

export type ScriptedCancelledOutcome = Readonly<{
  kind: "cancelled";
  message: string;
  evidence: readonly string[];
}>;

export type ScriptedReasoningOutcome =
  | ScriptedCompletedOutcome
  | ScriptedSafetyRefusalOutcome
  | ScriptedTimeoutOutcome
  | ScriptedInvalidOutputOutcome
  | ScriptedSchemaFailureOutcome
  | ScriptedPromptInjectionOutcome
  | ScriptedUsageLimitOutcome
  | ScriptedCancelledOutcome;

export type ScriptedReasoningScript = Readonly<{
  case_id: string;
  match: ScriptedReasoningRequestMatch;
  provider: ScriptedReasoningProviderIdentity;
  outcome: ScriptedReasoningOutcome;
}>;

/** Strict, in-memory replay adapter for the provider seam in SPEC-507. */
export class ScriptedReasoningProvider implements ReasoningProvider {
  readonly #scripts: readonly ScriptedReasoningScript[];
  readonly #calls: ReasoningRequest[] = [];
  #nextScriptIndex = 0;

  constructor(scripts: readonly ScriptedReasoningScript[]) {
    this.#scripts = [...scripts];
  }

  get calls(): readonly ReasoningRequest[] {
    return [...this.#calls];
  }

  get unusedScripts(): readonly ScriptedReasoningScript[] {
    return this.#scripts.slice(this.#nextScriptIndex);
  }

  generate(request: ReasoningRequest): Promise<ReasoningProviderResult> {
    this.#calls.push(request);
    const script = this.#scripts[this.#nextScriptIndex];
    if (script === undefined) {
      // Empty script list = fail-soft advisory (dev MCP has no LLM). Exhausted
      // non-empty scripts still hard-fail so replay tests stay strict.
      if (this.#scripts.length === 0) {
        return Promise.resolve({
          ok: true,
          value: {
            structured_output: {
              questions: [
                "Unresolved requirement gaps need product authority; no reasoning scripts are configured for this Workspace.",
              ],
              uncertainty_reasons: [
                "scripted-reasoning:empty-scripts",
                "Deterministic rules left unresolved facts; advisory reasoning unavailable.",
              ],
            },
            provider_id: "scripted-replay",
            provider_version: "0.1.0-empty",
            model_id: "none",
            finish_status: "completed",
            safety_outcomes: [],
            tool_calls: [],
            usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
            latency_ms: 0,
            citations: ["scripted-reasoning:empty-scripts-fail-soft"],
            diagnostics: {
              replay_case_id: "empty-scripts-fail-soft",
              authority_widening: false,
            },
          },
        });
      }
      return Promise.resolve({
        ok: false,
        failure: {
          code: "provider_error",
          message: "No scripted reasoning response remains for this request.",
          retryable: false,
          provider_id: "scripted-replay",
          evidence: [
            "scripted-reasoning:unexpected-request",
            `call-index:${this.#calls.length - 1}`,
          ],
        },
      });
    }
    if (!matches(script.match, request)) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "provider_error",
          message: "The request did not match the next scripted reasoning response.",
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: [
            "scripted-reasoning:request-mismatch",
            `expected-case:${script.case_id}`,
            `call-index:${this.#calls.length - 1}`,
          ],
        },
      });
    }

    this.#nextScriptIndex += 1;
    const outcome = script.outcome;
    if (outcome.kind === "safety_refusal") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "safety_refusal",
          message: outcome.message,
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, outcome.evidence),
        },
      });
    }
    if (outcome.kind === "timeout") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "timeout",
          message: outcome.message,
          retryable: true,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, [
            ...outcome.evidence,
            `elapsed-ms:${outcome.elapsed_ms}`,
          ]),
        },
      });
    }
    if (outcome.kind === "invalid_output" || outcome.kind === "schema_failure") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "schema_failure",
          message: outcome.message,
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, [
            ...outcome.evidence,
            `schema:${outcome.schema.id}@${outcome.schema.version}`,
          ]),
        },
      });
    }
    if (outcome.kind === "prompt_injection") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "tool_denied",
          message: outcome.message,
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, [
            ...outcome.evidence,
            `workspace:${request.context.workspace_id}`,
            `allowed-tools:${formatVersions(request.allowed_tools)}`,
            `requested-tools:${formatVersions(outcome.requested_tools)}`,
          ]),
        },
      });
    }
    if (outcome.kind === "usage_limit") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "usage_limit",
          message: outcome.message,
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, [
            ...outcome.evidence,
            `usage:input-tokens:${outcome.usage.input_tokens}`,
            `usage:output-tokens:${outcome.usage.output_tokens}`,
            `usage:cost:${outcome.usage.cost}`,
          ]),
        },
      });
    }
    if (outcome.kind === "cancelled") {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "cancelled",
          message: outcome.message,
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, outcome.evidence),
        },
      });
    }

    const toolCalls = [...(outcome.tool_calls ?? [])];
    if (toolCalls.some((call) => !authorizedToolCall(call, request.allowed_tools))) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "tool_denied",
          message: "Scripted output requested a Tool outside the authorized Tool set.",
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, ["scripted-output:undeclared-tool-call"]),
        },
      });
    }
    if (
      outcome.usage.input_tokens + outcome.usage.output_tokens > request.limits.max_tokens ||
      outcome.usage.cost > request.limits.max_cost
    ) {
      return Promise.resolve({
        ok: false,
        failure: {
          code: "usage_limit",
          message: "Scripted output exceeded the authorized usage budget.",
          retryable: false,
          provider_id: script.provider.provider_id,
          evidence: failureEvidence(script, ["scripted-output:usage-budget-exceeded"]),
        },
      });
    }

    return Promise.resolve({
      ok: true,
      value: {
        structured_output: { ...outcome.structured_output },
        provider_id: script.provider.provider_id,
        provider_version: script.provider.provider_version,
        model_id: script.provider.model_id,
        finish_status: "completed",
        safety_outcomes: [...(outcome.safety_outcomes ?? [])],
        tool_calls: toolCalls,
        usage: { ...outcome.usage },
        latency_ms: outcome.latency_ms,
        citations: [...outcome.citations],
        diagnostics: {
          ...(outcome.diagnostics ?? {}),
          replay_case_id: script.case_id,
          authority_widening: false,
        },
      },
    });
  }
}

function failureEvidence(
  script: ScriptedReasoningScript,
  evidence: readonly string[],
): readonly string[] {
  return [
    ...evidence,
    `scripted-reasoning:case:${script.case_id}`,
    `provider:${script.provider.provider_id}@${script.provider.provider_version}`,
    `model:${script.provider.model_id}`,
    "authority-widening:false",
  ];
}

function matches(
  expected: ScriptedReasoningRequestMatch,
  actual: ReasoningRequest,
): boolean {
  return expected.operation_id === actual.operation_id
    && stableJson(expected.context) === stableJson(actual.context)
    && expected.purpose === actual.purpose
    && expected.workspace_id === actual.context.workspace_id
    && expected.actor_id === actual.context.actor_id
    && expected.policy_version === actual.context.policy_version
    && expected.consequence_class === actual.consequence_class
    && stringsEqual(expected.capability_constraints, actual.capability_constraints)
    && versionEqual(expected.prompt, actual.prompt)
    && stringsEqual(expected.authorized_context_refs, actual.authorized_context_refs)
    && versionEqual(expected.output_schema, actual.output_schema)
    && versionsEqual(expected.allowed_tools, actual.allowed_tools)
    && expected.limits.max_tokens === actual.limits.max_tokens
    && expected.limits.max_cost === actual.limits.max_cost
    && expected.limits.timeout_ms === actual.limits.timeout_ms
    && expected.limits.max_retries === actual.limits.max_retries
    && versionEqual(expected.safety_policy, actual.safety_policy);
}

function stableJson(value: unknown): string {
  return stableStringify(value);
}

function versionEqual(expected: VersionReference, actual: VersionReference): boolean {
  return expected.id === actual.id && expected.version === actual.version;
}

function stringsEqual(expected: readonly string[], actual: readonly string[]): boolean {
  return expected.length === actual.length && expected.every((value, index) => value === actual[index]);
}

function versionsEqual(
  expected: readonly VersionReference[],
  actual: readonly VersionReference[],
): boolean {
  return expected.length === actual.length
    && expected.every((reference, index) => {
      const candidate = actual[index];
      return candidate !== undefined
        && reference.id === candidate.id
        && reference.version === candidate.version;
    });
}

function formatVersions(references: readonly VersionReference[]): string {
  return references.length === 0
    ? "none"
    : references.map((reference) => `${reference.id}@${reference.version}`).join(",");
}

function authorizedToolCall(
  call: JsonObject,
  allowed: readonly VersionReference[],
): boolean {
  const id = call["tool_id"];
  const version = call["tool_version"];
  return (
    typeof id === "string" &&
    typeof version === "string" &&
    allowed.some((reference) => reference.id === id && reference.version === version)
  );
}
