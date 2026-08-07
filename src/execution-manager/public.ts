import type { ExecutionOutcome } from "../execution-engine/public.js";
import type { JsonObject, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-404 (Execution Manager Component): "owns execution planning, state
 * transitions, dispatch, cancellation, retry classification, and result
 * aggregation... It does not implement provider engines or redefine test
 * outcomes" (§1/§2). This is a coordinator layer above the existing
 * `ExecutionEngine` contract (SPEC-504, `src/execution-engine/public.ts`) —
 * SPEC-602 §2's state diagram (`planned → queued → preparing → running →
 * collecting_evidence → completed | failed`, with `cancelled`/`blocked`/
 * `timed_out` as side-terminal states) is this module's vocabulary, copied
 * verbatim from that spec's single source of truth, never redefined here.
 */
export type ExecutionLifecycleState =
  | "planned"
  | "queued"
  | "preparing"
  | "running"
  | "collecting_evidence"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

/** SPEC-602 §4: "infrastructure error is not product failure" — retry eligibility depends on this classification. */
export type ExecutionFailureClass = "domain" | "infrastructure" | "timeout" | "cancellation";

/** SPEC-404 §4: "attempts remain visible" — a retry creates a distinct attempt, the original is never overwritten. */
export type ExecutionAttempt = Readonly<{
  attempt_id: string;
  state: ExecutionLifecycleState;
  engine_ref: VersionReference | null;
  environment_lease: string | null;
  started_at: string | null;
  completed_at: string | null;
  outcome: ExecutionOutcome | null;
  evidence: readonly string[];
  failure_class: ExecutionFailureClass | null;
}>;

export type ExecutionAggregate = Readonly<{
  execution_id: string;
  workspace_id: string;
  asset_ref: string;
  environment_ref: string;
  revision: number;
  attempts: readonly ExecutionAttempt[];
  current_attempt_id: string | null;
}>;

export type ExecutionManagerFailureCode =
  | "unknown_execution"
  | "conflict"
  | "unsupported_transition"
  | "workspace_denied"
  | "engine_unavailable"
  | "retry_ineligible"
  | "lease_unavailable";

export type ExecutionManagerFailure = Readonly<{
  code: ExecutionManagerFailureCode;
  message: string;
  retryable: boolean;
}>;

export type ExecutionManagerResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: ExecutionManagerFailure }>;

export type PlanExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  asset_ref: string;
  environment_ref: string;
  idempotency_key: string;
}>;

export type QueueExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
}>;

export type DispatchAttemptRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  attempt_id: string;
  test_version: VersionReference;
  data_refs: readonly string[];
  configuration: JsonObject;
  evidence_policy_ref: string;
  isolation_requirements: JsonObject;
  authorized_input_refs: readonly string[];
  execution_plan_ref: string;
  idempotency_key: string;
}>;

export type RecordProgressRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  evidence_refs: readonly string[];
}>;

export type CompleteExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  outcome: ExecutionOutcome;
}>;

export type FailExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  failure_class: ExecutionFailureClass;
  reason: string;
}>;

export type BlockExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  reason: string;
}>;

export type CancelExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
  reason: string;
}>;

export type TimeoutExecutionRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  expected_revision: number;
}>;

export type RetryEligibleAttemptRequest = Readonly<{
  execution_id: string;
  context: WorkspaceContext;
  attempt_id: string;
  max_attempts: number;
}>;

/** SPEC-404 §3's operations. */
export interface ExecutionManager {
  plan(request: PlanExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  queue(request: QueueExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  dispatchAttempt(request: DispatchAttemptRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  recordProgress(request: RecordProgressRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  complete(request: CompleteExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  fail(request: FailExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  block(request: BlockExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  cancel(request: CancelExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  timeout(request: TimeoutExecutionRequest): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  retryEligibleAttempt(request: RetryEligibleAttemptRequest): Promise<ExecutionManagerResult<boolean>>;
  getExecution(context: WorkspaceContext, executionId: string): Promise<ExecutionManagerResult<ExecutionAggregate>>;
  listAttempts(context: WorkspaceContext, executionId: string): Promise<ExecutionManagerResult<readonly ExecutionAttempt[]>>;
}
