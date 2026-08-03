import type {
  ConsequenceClass,
  JsonObject,
  StableResult,
  VersionReference,
  WorkspaceContext,
} from "../requirement-review/public.js";

export type AgentRunState =
  | "requested"
  | "resolving"
  | "awaiting_authorization"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "suspended"
  | "validating"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked";

export type AgentStepState =
  | "proposed"
  | "authorized"
  | "executing"
  | "observed"
  | "validated"
  | "committed";

/**
 * The first four limits are the backward-compatible required baseline.
 * Optional limits become mandatory only when the selected policy declares them.
 */
export type AgentRunBudgets = Readonly<{
  max_steps: number;
  max_duration_seconds: number;
  max_tool_calls: number;
  max_retries: number;
  max_tokens?: number;
  max_cost?: number;
  max_tool_cost?: number;
  max_repeated_action_fingerprints?: number;
  max_no_progress_iterations?: number;
}>;

export type AgentRunBudgetUsage = Readonly<{
  steps: number;
  duration_seconds: number;
  tool_calls: number;
  retries: number;
  tokens?: number;
  cost?: number;
  tool_cost?: number;
  repeated_action_fingerprints?: number;
  no_progress_iterations?: number;
}>;

/** Mirrors schemas/agent-run-start.schema.json and SPEC-508. */
export type AgentRunStartRequest = Readonly<{
  schema_version: "1.0.0";
  operation_id: string;
  workspace_id: string;
  actor_id: string;
  workspace_context: WorkspaceContext;
  agent: VersionReference;
  purpose: string;
  consequence_class: ConsequenceClass;
  input: JsonObject;
  allowed_skills?: readonly VersionReference[];
  allowed_tools?: readonly VersionReference[];
  policy_version: string;
  budgets: AgentRunBudgets;
  deadline: string;
  evidence_requirements?: readonly string[];
  idempotency_key: string;
}>;

export type AgentRunFailureClass =
  | "subject"
  | "policy"
  | "provider"
  | "skill"
  | "tool"
  | "infrastructure"
  | "evaluator"
  | "orchestration";

export type AgentRunFailureCode =
  | "invalid_definition"
  | "invalid_request"
  | "authorization_denied"
  | "context_contamination"
  | "incompatible_version"
  | "idempotency_conflict"
  | "stale_revision"
  | "provider_failure"
  | "skill_failure"
  | "tool_failure"
  | "infrastructure_failure"
  | "evaluator_failure"
  | "invalid_output"
  | "budget_exhausted"
  | "no_progress"
  | "cancelled"
  | "timed_out"
  | "checkpoint_corruption"
  | "cleanup_failure"
  | "partial_effect"
  | "unknown_effect"
  | "not_found"
  | "unavailable";

export type AgentRunFailure = Readonly<{
  class: AgentRunFailureClass;
  code: AgentRunFailureCode;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type AgentRunReference = Readonly<{
  schema_version: "1.0.0";
  run_id: string;
  workspace_id: string;
}>;

export type AgentRunAccessRequest = Readonly<{
  schema_version: "1.0.0";
  operation_id: string;
  workspace_id: string;
  actor_id: string;
  policy_version: string;
  workspace_context: WorkspaceContext;
}>;

export type PendingApproval = Readonly<{
  approval_id: string;
  requested_action: string;
  consequence_class: ConsequenceClass;
  required_permissions: readonly string[];
  evidence: readonly string[];
}>;

/** Mirrors schemas/agent-run-snapshot.schema.json and SPEC-508. */
export type AgentRunSnapshot = Readonly<{
  schema_version: "1.0.0";
  run_id: string;
  workspace_id: string;
  revision: number;
  state: AgentRunState;
  objective: string;
  consumed_budgets: AgentRunBudgetUsage;
  pending_approval: PendingApproval | null;
  checkpoint: string | null;
  failure_class: AgentRunFailureClass | null;
  evidence: readonly string[];
  updated_at: string;
}>;

export type AgentRunOutcome =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "blocked"
  | "indeterminate";

export type CleanupStatus =
  | "not_required"
  | "completed"
  | "failed"
  | "incomplete";

export type AgentRunUncertainty = Readonly<{
  level: "none" | "low" | "medium" | "high";
  reasons: readonly string[];
}>;

export type AgentRunResultUsage = Readonly<{
  steps: number;
  duration_seconds: number;
  tool_calls: number;
  retries: number;
  tokens?: number;
  cost?: number;
  tool_cost?: number;
}>;

/** Mirrors schemas/agent-run-result.schema.json and SPEC-508. */
export type AgentRunResult = Readonly<{
  schema_version: "1.0.0";
  run_id: string;
  workspace_id: string;
  outcome: AgentRunOutcome;
  output: JsonObject | null;
  failure_class: AgentRunFailureClass | null;
  resolved_versions: Readonly<Record<string, string>>;
  rule_results: readonly string[];
  skill_usage: readonly string[];
  tool_usage: readonly string[];
  citations: readonly string[];
  uncertainty: AgentRunUncertainty;
  policy_events: readonly string[];
  usage: AgentRunResultUsage;
  evidence: readonly string[];
  cleanup_status: CleanupStatus;
  started_at: string;
  completed_at: string;
}>;

export type AgentRunEventType =
  | "run_requested"
  | "run_resolved"
  | "authorization_requested"
  | "authorization_granted"
  | "authorization_denied"
  | "run_ready"
  | "step_proposed"
  | "step_authorized"
  | "step_observed"
  | "step_validated"
  | "approval_requested"
  | "run_suspended"
  | "run_resumed"
  | "run_validating"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "run_timed_out"
  | "run_blocked"
  | "cleanup_completed"
  | "cleanup_failed";

/** Mirrors schemas/agent-run-event.schema.json and SPEC-508. */
export type AgentRunEvent = Readonly<{
  schema_version: "1.0.0";
  event_id: string;
  run_id: string;
  workspace_id: string;
  sequence: number;
  type: AgentRunEventType;
  occurred_at: string;
  payload_schema: VersionReference;
  payload: JsonObject;
}>;

export type AgentRunTransition = Readonly<{
  schema_version: "1.0.0";
  run_id: string;
  workspace_id: string;
  revision: number;
  previous_state: AgentRunState;
  state: AgentRunState;
  event_id: string;
}>;

export type AgentRunApproval = AgentRunAccessRequest & Readonly<{
  expected_revision: number;
  approval_id: string;
  decision: "approved" | "rejected";
  reason: string;
  evidence: readonly string[];
  idempotency_key: string;
}>;

export type AgentRunResume = AgentRunAccessRequest & Readonly<{
  expected_revision: number;
  checkpoint: string;
  reason: string;
  idempotency_key: string;
}>;

export type AgentRunCancellation = AgentRunAccessRequest & Readonly<{
  expected_revision: number;
  reason: string;
  evidence: readonly string[];
  idempotency_key: string;
}>;

/** Schema-versioned command that asks the runtime—not the caller—to execute retained input. */
export type AgentRunExecution = AgentRunAccessRequest & Readonly<{
  expected_revision: number;
  idempotency_key: string;
}>;

export type AgentRunEventCursor = Readonly<{
  schema_version: "1.0.0";
  after_sequence: number;
  limit: number;
}>;

export type AgentRunEventPage = Readonly<{
  schema_version: "1.0.0";
  events: readonly AgentRunEvent[];
  next_cursor: AgentRunEventCursor;
  sequence_gap: boolean;
}>;

export type AgentRuntimeResult<Value> = StableResult<Value, AgentRunFailure>;

/**
 * The sole caller/test interface for the deep Agent Runtime module.
 * Implementations enforce Workspace context, authority and policy outside prompts.
 */
export interface AgentRuntime {
  start(
    request: AgentRunStartRequest,
  ): Promise<AgentRuntimeResult<AgentRunReference>>;

  execute(
    reference: AgentRunReference,
    execution: AgentRunExecution,
  ): Promise<AgentRuntimeResult<AgentRunResult>>;

  inspect(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunSnapshot>>;

  result(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunResult>>;

  approve(
    reference: AgentRunReference,
    approval: AgentRunApproval,
  ): Promise<AgentRuntimeResult<AgentRunTransition>>;

  resume(
    reference: AgentRunReference,
    checkpoint: AgentRunResume,
  ): Promise<AgentRuntimeResult<AgentRunTransition>>;

  cancel(
    reference: AgentRunReference,
    reason: AgentRunCancellation,
  ): Promise<AgentRuntimeResult<AgentRunTransition>>;

  streamEvents(
    reference: AgentRunReference,
    cursor: AgentRunEventCursor,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunEventPage>>;
}
