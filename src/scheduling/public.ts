import type { VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-603 (Scheduling and Capacity Runtime): "governs admission,
 * prioritization, fairness, dependency readiness, environment leases,
 * capacity allocation, and queue behavior" (§1). Genuinely new
 * algorithmic logic — nothing in this repository implements queue/
 * admission/lease/fairness as a generic scheduling primitive before this;
 * `ExecutionEngine.prepare`'s `environment_lease` is only an opaque string
 * one provider returns, not a lease object a scheduler owns with expiry/
 * renewal/fencing.
 */
export type SchedulingPriorityClass = "critical_governance" | "high" | "normal" | "low";

/** SPEC-603 §2's scheduling inputs. */
export type AdmissionRequest = Readonly<{
  request_id: string;
  workspace_id: string;
  actor_id: string;
  context: WorkspaceContext;
  operation_type: string;
  priority: SchedulingPriorityClass;
  deadline: string;
  required_capability: VersionReference;
  estimated_resources: Readonly<{ concurrency_slots: number }>;
}>;

/** SPEC-603 §4's admission-validation list, verbatim. */
export type SchedulingRejectionReason =
  | "unauthorized"
  | "quota_exceeded"
  | "unsupported_capability"
  | "environment_unavailable"
  | "deadline_infeasible"
  | "policy_denied";

/** §4: "Rejection and deferment SHALL be distinct" — modeled as separate variants, not one generic failure. */
export type AdmissionDecision =
  | Readonly<{ outcome: "admitted"; queue_position: number }>
  | Readonly<{ outcome: "queued"; reason: string; queue_position: number }>
  | Readonly<{ outcome: "rejected"; reason: SchedulingRejectionReason }>
  | Readonly<{ outcome: "deferred"; reason: string; retry_after: string }>;

export type WorkspaceQuota = Readonly<{
  workspace_id: string;
  max_concurrent: number;
  reserved_critical_slots: number;
}>;

/** SPEC-603 §5: "renewable bounded leases... lease identity SHALL prevent stale workers from finalizing current work." */
export type Lease = Readonly<{
  lease_id: string;
  resource_ref: string;
  workspace_id: string;
  fencing_token: number;
  issued_at: string;
  expires_at: string;
  renewed_count: number;
}>;

export type LeaseFailureReason = "unknown_lease" | "expired" | "fencing_mismatch";

export type LeaseResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: LeaseFailureReason }>;
