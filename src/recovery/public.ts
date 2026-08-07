/**
 * SPEC-605 (Recovery and Continuity Runtime): "defines detection,
 * containment, restoration, replay, verification, and communication
 * required to recover from runtime and data failures" (§1). The final
 * spec of the runtime-orchestration group and of the original 60
 * non-foundation specs.
 *
 * `InMemoryAgentRuntime.seed()` / `PersistedAgentRuntime.restore()`
 * already implement §6's "durable operations SHALL resume from recorded
 * state... stale workers SHALL not overwrite newer outcomes" for one
 * aggregate type (the Agent Run). This module is the generic,
 * cross-component version — §3's failure classification and §4's 8-step
 * recovery order composing `InMemoryOperationStore` (SPEC-601),
 * `LeaseManager` (SPEC-603), and `InMemoryTelemetryEmitter` (SPEC-604)
 * rather than inventing new persistence.
 */
export type RecoveryFailureClass =
  | "process_or_worker_loss"
  | "queue_or_scheduler_failure"
  | "provider_outage"
  | "data_corruption_or_loss"
  | "index_or_projection_loss"
  | "credential_or_policy_failure"
  | "region_or_environment_loss"
  | "security_incident"
  | "erroneous_deployment_or_migration";

/** SPEC-605 §4's 8 steps, as an observable stage. */
export type RecoveryStage =
  | "detecting"
  | "containing"
  | "evidence_preserved"
  | "state_restored"
  | "derived_state_rebuilt"
  | "work_resumed"
  | "verified"
  | "communicated";

/** SPEC-605 §9's exercise-record field list, verbatim. */
export type RecoveryExercise = Readonly<{
  exercise_id: string;
  workspace_id: string;
  failure_class: RecoveryFailureClass;
  affected_resource_refs: readonly string[];
  stage: RecoveryStage;
  started_at: string;
  completed_at: string | null;
  measured_restoration_seconds: number | null;
  recovered_revision: string | null;
  semantic_verification_passed: boolean | null;
  isolation_check_passed: boolean | null;
  evidence_gaps: readonly string[];
  owned_remediation: readonly string[];
}>;

export type RecoverOperationRequest = Readonly<{
  workspace_id: string;
  operation_id: string;
  failure_class: RecoveryFailureClass;
  detected_at: string;
  affected_lease_ids: readonly string[];
  /** Owner accountable for this recovery exercise (SPEC-605 §2/§9). */
  owner: string;
}>;

export type RecoveryFailureCode =
  | "unknown_operation"
  | "containment_failed"
  | "state_unrecoverable"
  | "verification_failed"
  | "stale_worker_rejected";

export type RecoveryFailure = Readonly<{
  code: RecoveryFailureCode;
  message: string;
  retryable: boolean;
}>;

export type RecoverOperationOutput =
  | Readonly<{ ok: true; value: RecoveryExercise }>
  | Readonly<{ ok: false; failure: RecoveryFailure }>;
