import { createHash } from "node:crypto";

import { stableStringify } from "../shared/stable-stringify.js";
import type { JsonObject, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-304 Workflow Engine Architecture: "coordinates long-running product
 * and governance processes through explicit, resumable, observable state
 * machines" (§1) — "a small provider-neutral interface for starting,
 * signaling, approving, cancelling, inspecting, and resuming a workflow"
 * (§9). Mirrors the request/result envelope and idempotency-digest pattern
 * `src/execution-engine/public.ts` established for SPEC-504 — SPEC-304 §9
 * explicitly asks for the same shape (provider-neutral interface,
 * deterministic clock/queue/action substitutes passing the same contract
 * tests as production adapters). §2: "SHALL NOT embed domain policy that
 * belongs in specifications or rules" — a transition's guard is a
 * *reference* to a SPEC-104 rule (`guard_rule_ref`), never inline logic
 * this module or its adapters evaluate themselves.
 */

export type WorkflowEngineOperation =
  | "descriptor"
  | "start"
  | "signal"
  | "approve"
  | "cancel"
  | "inspect"
  | "resume";

/** SPEC-304 §3: a transition's guard is a reference to an externally-evaluated SPEC-104 rule, never inline logic. */
export type WorkflowTransition = Readonly<{
  from_state: string;
  to_state: string;
  trigger: string;
  guard_rule_ref?: VersionReference;
}>;

export type WorkflowRetryPolicy = Readonly<{
  max_attempts: number;
  backoff_seconds: number;
}>;

export type WorkflowCompensation = Readonly<{
  from_state: string;
  compensating_trigger: string;
}>;

/** SPEC-304 §3: identity, version, states, transitions, triggers, guards, actions, timeouts, retry policy, compensation, permissions, outputs, terminal outcomes. */
export type WorkflowDefinition = Readonly<{
  id: string;
  version: string;
  states: readonly string[];
  initial_state: string;
  terminal_states: readonly string[];
  transitions: readonly WorkflowTransition[];
  timeout_seconds?: number;
  retry_policy?: WorkflowRetryPolicy;
  compensation?: readonly WorkflowCompensation[];
  permissions: readonly string[];
  outputs: readonly string[];
}>;

/** SPEC-602 §4-style attempt identity, applied to a workflow instance instead of an execution attempt. */
export type WorkflowInstanceIdentity = Readonly<{
  workflow_id: string;
  instance_id: string;
}>;

export type WorkflowHistoryEntry = Readonly<{
  from_state: string | null;
  to_state: string;
  trigger: string;
  occurred_at: string;
}>;

/** SPEC-304 §6: authority, assignee or role, evidence, allowed outcomes, deadline, separation-of-duties constraints. */
export type HumanTask = Readonly<{
  task_id: string;
  authority: readonly string[];
  assignee_or_role: string;
  evidence_refs: readonly string[];
  allowed_outcomes: readonly string[];
  deadline: string;
  separation_of_duties: readonly string[];
}>;

/** SPEC-304 §4: definition version, Workspace, correlation ID, state, history, pending work, actor, input/output references, deadlines, failure context. */
export type WorkflowRuntimeState = Readonly<{
  definition_ref: VersionReference;
  workspace_id: string;
  correlation_id: string;
  state: string;
  history: readonly WorkflowHistoryEntry[];
  pending_human_tasks: readonly HumanTask[];
  actor_id: string;
  input_refs: readonly string[];
  output_refs: readonly string[];
  deadline: string | null;
  failure_context: JsonObject | null;
}>;

export type WorkflowEngineIdempotency = Readonly<{
  key: string;
  scope: string;
  request_digest: string;
}>;

export type WorkflowEngineDeadline = Readonly<{
  at: string;
  time_standard: "UTC";
}>;

export type WorkflowEngineVersion = Readonly<{
  contract: "1.0.0";
  operation_schema: "1.0.0";
}>;

export type DescriptorPayload = Readonly<{
  required_capabilities: readonly WorkflowEngineOperation[];
}>;

export type DescriptorValue = Readonly<{
  supported_contract_versions: readonly string[];
  supported_operations: readonly WorkflowEngineOperation[];
  deterministic: boolean;
  health: "healthy" | "degraded" | "unavailable";
  capacity: JsonObject;
}>;

export type StartPayload = Readonly<{
  definition_ref: VersionReference;
  correlation_id: string;
  input_refs: readonly string[];
  actor_id: string;
}>;

export type StartValue = Readonly<{
  instance: WorkflowInstanceIdentity;
  state: string;
  resolved_versions: Readonly<Record<string, string>>;
}>;

export type SignalPayload = Readonly<{
  instance: WorkflowInstanceIdentity;
  trigger: string;
  data: JsonObject;
}>;

/** SPEC-304 §5: duplicate events do not duplicate effects — a duplicate signal reports `transitioned: false` on replay, not a re-run. */
export type SignalValue = Readonly<{
  state: string;
  transitioned: boolean;
}>;

export type ApprovePayload = Readonly<{
  instance: WorkflowInstanceIdentity;
  task_id: string;
  outcome: string;
  actor_id: string;
  evidence_refs: readonly string[];
}>;

export type ApproveValue = Readonly<{
  state: string;
  task_resolved: boolean;
}>;

export type CancelPayload = Readonly<{
  instance: WorkflowInstanceIdentity;
  reason: string;
}>;

export type CancelValue = Readonly<{
  accepted: boolean;
  already_terminal: boolean;
}>;

export type InspectPayload = Readonly<{
  instance: WorkflowInstanceIdentity;
}>;

export type InspectValue = Readonly<{
  runtime_state: WorkflowRuntimeState;
}>;

export type ResumePayload = Readonly<{
  instance: WorkflowInstanceIdentity;
}>;

/** §5: "recovery resumes from durable state" — the deterministic reference adapter proves this contract shape; real durability is a separate adapter's scope. */
export type ResumeValue = Readonly<{
  state: string;
  resumed: boolean;
}>;

export interface WorkflowEngineOperationMap {
  readonly descriptor: Readonly<{ request: DescriptorPayload; value: DescriptorValue }>;
  readonly start: Readonly<{ request: StartPayload; value: StartValue }>;
  readonly signal: Readonly<{ request: SignalPayload; value: SignalValue }>;
  readonly approve: Readonly<{ request: ApprovePayload; value: ApproveValue }>;
  readonly cancel: Readonly<{ request: CancelPayload; value: CancelValue }>;
  readonly inspect: Readonly<{ request: InspectPayload; value: InspectValue }>;
  readonly resume: Readonly<{ request: ResumePayload; value: ResumeValue }>;
}

export type WorkflowEngineRequest<Operation extends WorkflowEngineOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  workspace: WorkspaceContext;
  idempotency: WorkflowEngineIdempotency;
  deadline: WorkflowEngineDeadline;
  version: WorkflowEngineVersion;
  payload: WorkflowEngineOperationMap[Operation]["request"];
}>;

export type DescriptorRequest = WorkflowEngineRequest<"descriptor">;
export type StartRequest = WorkflowEngineRequest<"start">;
export type SignalRequest = WorkflowEngineRequest<"signal">;
export type ApproveRequest = WorkflowEngineRequest<"approve">;
export type CancelRequest = WorkflowEngineRequest<"cancel">;
export type InspectRequest = WorkflowEngineRequest<"inspect">;
export type ResumeRequest = WorkflowEngineRequest<"resume">;

export type AnyWorkflowEngineRequest = {
  readonly [Operation in WorkflowEngineOperation]: WorkflowEngineRequest<Operation>;
}[WorkflowEngineOperation];

/** SPEC-304 §7: domain rejection, transient/permanent dependency failure, timeout, cancellation, conflict, and orchestration defect SHALL remain distinct. */
export type WorkflowEngineFailureCode =
  | "invalid_request"
  | "unsupported_version"
  | "workspace_denied"
  | "unknown_definition"
  | "unknown_instance"
  | "domain_rejection"
  | "transient_dependency_failure"
  | "permanent_dependency_failure"
  | "deadline_exceeded"
  | "cancelled"
  | "idempotency_conflict"
  | "orchestration_defect";

export type WorkflowEngineFailure = Readonly<{
  code: WorkflowEngineFailureCode;
  retryable: boolean;
  responsible_domain: "caller" | "workspace" | "policy" | "engine" | "dependency" | "infrastructure";
  message: string;
  details: JsonObject;
  diagnostic_evidence_refs: readonly string[];
}>;

export type WorkflowEngineProvider = Readonly<{
  id: string;
  version: string;
}>;

export type WorkflowEngineTiming = Readonly<{
  started_at: string;
  completed_at: string;
  duration_ms: number;
}>;

type WorkflowEngineResultEnvelope<Operation extends WorkflowEngineOperation> = Readonly<{
  operation: Operation;
  operationId: string;
  workspace: WorkspaceContext;
  idempotency: WorkflowEngineIdempotency;
  deadline: WorkflowEngineDeadline;
  version: WorkflowEngineVersion;
  provider: WorkflowEngineProvider;
  timing: WorkflowEngineTiming;
  warnings: readonly string[];
  evidence: readonly string[];
}>;

export type WorkflowEngineResult<Operation extends WorkflowEngineOperation> =
  WorkflowEngineResultEnvelope<Operation> &
    (
      | Readonly<{ ok: true; value: WorkflowEngineOperationMap[Operation]["value"] }>
      | Readonly<{ ok: false; failure: WorkflowEngineFailure }>
    );

export type AnyWorkflowEngineResult = {
  readonly [Operation in WorkflowEngineOperation]: WorkflowEngineResult<Operation>;
}[WorkflowEngineOperation];

export interface WorkflowEngine {
  descriptor(request: DescriptorRequest): Promise<WorkflowEngineResult<"descriptor">>;
  start(request: StartRequest): Promise<WorkflowEngineResult<"start">>;
  signal(request: SignalRequest): Promise<WorkflowEngineResult<"signal">>;
  approve(request: ApproveRequest): Promise<WorkflowEngineResult<"approve">>;
  cancel(request: CancelRequest): Promise<WorkflowEngineResult<"cancel">>;
  inspect(request: InspectRequest): Promise<WorkflowEngineResult<"inspect">>;
  resume(request: ResumeRequest): Promise<WorkflowEngineResult<"resume">>;
}

/** Canonical digest binding excludes only the digest field itself (mirrors executionRequestDigest). */
export function workflowRequestDigest<Operation extends WorkflowEngineOperation>(
  request: WorkflowEngineRequest<Operation>,
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
