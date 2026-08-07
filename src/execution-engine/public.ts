import { createHash } from "node:crypto";

import { stableStringify } from "../shared/stable-stringify.js";
import type { JsonObject, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-504 Execution Engine Contract: provider-neutral interface an
 * Execution Plugin (ADR-007, ADR-009 — Playwright per SPEC-407, or any
 * other execution technology) implements so the Core Platform never calls
 * a framework-specific SDK directly. Mirrors the request/result envelope
 * and idempotency-digest pattern `src/evaluation/adapter.ts` already
 * established for SPEC-511, adapted to SPEC-504 §2's distinct capability
 * set (validate/prepare/start/cancel/finalize/health) and §4's ordered
 * event stream, which SPEC-511's stateless per-operation calls do not need.
 *
 * Canonical execution states and outcomes are NOT redefined here — SPEC-210
 * §4 and SPEC-602 §2 are their single source of truth; this module imports
 * neither vocabulary as a literal union it could drift from independently,
 * it re-exports the same string values those specs already accepted
 * (`schemas/execution-record.schema.json`'s enums).
 */

export type ExecutionEngineOperation =
  | "descriptor"
  | "validate"
  | "prepare"
  | "start"
  | "cancel"
  | "finalize";

/** SPEC-602 §4: retries create distinct attempts under one execution; both IDs are load-bearing identity, not display strings. */
export type ExecutionAttemptIdentity = Readonly<{
  execution_id: string;
  attempt_id: string;
}>;

export type ExecutionEngineIdempotency = Readonly<{
  key: string;
  scope: string;
  request_digest: string;
}>;

export type ExecutionEngineDeadline = Readonly<{
  at: string;
  time_standard: "UTC";
}>;

export type ExecutionEngineVersion = Readonly<{
  contract: "1.0.0";
  operation_schema: "1.0.0";
}>;

export type DescriptorPayload = Readonly<{
  required_capabilities: readonly ExecutionEngineOperation[];
}>;

export type DescriptorValue = Readonly<{
  supported_contract_versions: readonly string[];
  supported_operations: readonly ExecutionEngineOperation[];
  capabilities: readonly string[];
  deterministic: boolean;
  evidence_guarantees: readonly string[];
  cancellation_guarantee: string;
  cleanup_guarantee: string;
  health: "healthy" | "degraded" | "unavailable";
  capacity: JsonObject;
}>;

/** SPEC-504 §3: what a request SHALL identify. */
export type ValidatePayload = Readonly<{
  asset_ref: string;
  test_version: VersionReference;
  environment_ref: string;
  data_refs: readonly string[];
  configuration: JsonObject;
  evidence_policy_ref: string;
}>;

export type ValidateValue = Readonly<{
  compatible: boolean;
  resolved_versions: Readonly<Record<string, string>>;
  incompatibility_reasons: readonly string[];
}>;

export type PreparePayload = Readonly<{
  asset_ref: string;
  environment_ref: string;
  data_refs: readonly string[];
  configuration: JsonObject;
  isolation_requirements: JsonObject;
}>;

export type PrepareValue = Readonly<{
  environment_lease: string;
  resolved_versions: Readonly<Record<string, string>>;
  expires_at: string;
  cleanup_required: boolean;
}>;

export type ExecutionEngineEventType =
  | "accepted"
  | "preparing"
  | "started"
  | "progress"
  | "evidence_created"
  | "assertion_result"
  | "completed"
  | "failed"
  | "cancelled"
  | "cleanup_completed";

/**
 * SPEC-504 §4: events SHALL be ordered per attempt, idempotent, and
 * correlated. `sequence` is the per-attempt ordering key a caller uses to
 * detect gaps/duplicates/reordering — the engine SHALL assign it
 * monotonically per `ExecutionAttemptIdentity`, never per engine instance.
 */
export type ExecutionEngineEvent = Readonly<{
  type: ExecutionEngineEventType;
  attempt: ExecutionAttemptIdentity;
  sequence: number;
  occurred_at: string;
  data: JsonObject;
}>;

export type StartPayload = Readonly<{
  environment_lease: string;
  execution_plan_ref: string;
  authorized_input_refs: readonly string[];
}>;

/**
 * SPEC-210 §4 canonical execution-outcome vocabulary (single source of
 * truth) — this module re-exports the exact literal union rather than
 * defining its own so SPEC-504 result mapping can never drift from SPEC-210
 * or SPEC-602's meaning of the same state/outcome.
 */
export type ExecutionOutcome =
  | "passed"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled"
  | "flaky"
  | "infrastructure_error"
  | "indeterminate";

export type StartValue = Readonly<{
  outcome: ExecutionOutcome;
  skip_reason?: string;
  evidence: readonly string[];
  assertion_results: readonly JsonObject[];
  resource_usage: JsonObject;
  timing: Readonly<{ started_at: string; completed_at: string; duration_ms: number }>;
}>;

export type CancelPayload = Readonly<{
  reason: string;
}>;

export type CancelValue = Readonly<{
  /** SPEC-602 §5: cancellation is cooperative but bounded — accepted does not mean immediately terminal. */
  accepted: boolean;
  already_terminal: boolean;
}>;

export type FinalizePayload = Readonly<{
  environment_lease: string;
  cleanup_policy_ref: string;
}>;

export type FinalizeValue = Readonly<{
  cleanup_status: "completed" | "partial" | "failed";
  residual_resources: readonly string[];
}>;

export interface ExecutionEngineOperationMap {
  readonly descriptor: Readonly<{ request: DescriptorPayload; value: DescriptorValue }>;
  readonly validate: Readonly<{ request: ValidatePayload; value: ValidateValue }>;
  readonly prepare: Readonly<{ request: PreparePayload; value: PrepareValue }>;
  readonly start: Readonly<{ request: StartPayload; value: StartValue }>;
  readonly cancel: Readonly<{ request: CancelPayload; value: CancelValue }>;
  readonly finalize: Readonly<{ request: FinalizePayload; value: FinalizeValue }>;
}

export type ExecutionEngineRequest<Operation extends ExecutionEngineOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  attempt: ExecutionAttemptIdentity;
  workspace: WorkspaceContext;
  idempotency: ExecutionEngineIdempotency;
  deadline: ExecutionEngineDeadline;
  version: ExecutionEngineVersion;
  payload: ExecutionEngineOperationMap[Operation]["request"];
}>;

export type DescriptorRequest = ExecutionEngineRequest<"descriptor">;
export type ValidateRequest = ExecutionEngineRequest<"validate">;
export type PrepareRequest = ExecutionEngineRequest<"prepare">;
export type StartRequest = ExecutionEngineRequest<"start">;
export type CancelRequest = ExecutionEngineRequest<"cancel">;
export type FinalizeRequest = ExecutionEngineRequest<"finalize">;

export type AnyExecutionEngineRequest = {
  readonly [Operation in ExecutionEngineOperation]: ExecutionEngineRequest<Operation>;
}[ExecutionEngineOperation];

/** SPEC-504 §5: distinguishes product/test failure, blocked precondition, cancellation, timeout, infrastructure failure, and plugin error. */
export type ExecutionEngineFailureCode =
  | "invalid_request"
  | "unsupported_version"
  | "unsupported_capability"
  | "workspace_denied"
  | "policy_denied"
  | "incompatible_asset"
  | "environment_unavailable"
  | "deadline_exceeded"
  | "cancelled"
  | "idempotency_conflict"
  | "duplicate_attempt"
  | "resource_exhausted"
  | "infrastructure_failure"
  | "plugin_failure"
  | "cleanup_incomplete";

export type ExecutionEngineFailure = Readonly<{
  code: ExecutionEngineFailureCode;
  retryable: boolean;
  responsible_domain: "caller" | "workspace" | "policy" | "engine" | "plugin" | "infrastructure" | "cleanup";
  message: string;
  details: JsonObject;
  diagnostic_evidence_refs: readonly string[];
}>;

export type ExecutionEngineProvider = Readonly<{
  id: string;
  version: string;
}>;

export type ExecutionEngineTiming = Readonly<{
  started_at: string;
  completed_at: string;
  duration_ms: number;
}>;

type ExecutionEngineResultEnvelope<Operation extends ExecutionEngineOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  attempt: ExecutionAttemptIdentity;
  workspace: WorkspaceContext;
  idempotency: ExecutionEngineIdempotency;
  deadline: ExecutionEngineDeadline;
  version: ExecutionEngineVersion;
  provider: ExecutionEngineProvider;
  timing: ExecutionEngineTiming;
  warnings: readonly string[];
  evidence: readonly string[];
}>;

export type ExecutionEngineResult<Operation extends ExecutionEngineOperation> =
  ExecutionEngineResultEnvelope<Operation> &
    (
      | Readonly<{ ok: true; value: ExecutionEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: ExecutionEngineFailure }>
    );

export type AnyExecutionEngineResult = {
  readonly [Operation in ExecutionEngineOperation]: ExecutionEngineResult<Operation>;
}[ExecutionEngineOperation];

/**
 * SPEC-504 §2 "stream or publish progress": `start` accepts a sink the
 * engine calls zero or more times, in order, before resolving with the
 * terminal result — not a separate poll operation, and not a return value
 * the caller must reassemble out of order. `onEvent` SHALL NOT throw; a
 * caller-side failure to process an event is the caller's concern, not the
 * engine's (mirrors ADR-019 §5's "the transport carries context through,
 * it does not own domain failure handling").
 */
export type ExecutionEngineEventSink = (event: ExecutionEngineEvent) => void;

export interface ExecutionEngine {
  descriptor(request: DescriptorRequest): Promise<ExecutionEngineResult<"descriptor">>;
  validate(request: ValidateRequest): Promise<ExecutionEngineResult<"validate">>;
  prepare(request: PrepareRequest): Promise<ExecutionEngineResult<"prepare">>;
  start(
    request: StartRequest,
    onEvent: ExecutionEngineEventSink,
  ): Promise<ExecutionEngineResult<"start">>;
  cancel(request: CancelRequest): Promise<ExecutionEngineResult<"cancel">>;
  finalize(request: FinalizeRequest): Promise<ExecutionEngineResult<"finalize">>;
}

/** Canonical digest binding excludes only the digest field itself (mirrors evaluationRequestDigest). */
export function executionRequestDigest<Operation extends ExecutionEngineOperation>(
  request: ExecutionEngineRequest<Operation>,
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

