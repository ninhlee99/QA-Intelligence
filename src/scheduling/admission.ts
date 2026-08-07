import type { SchedulingQueue } from "./priority-queue.js";
import type { AdmissionDecision, AdmissionRequest, WorkspaceQuota } from "./public.js";
import type { WorkspaceAuthorizer } from "../requirement-review/public.js";

export type AdmissionDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  queue: SchedulingQueue;
  quotas: ReadonlyMap<string, WorkspaceQuota>;
  currentInFlight: (workspaceId: string) => number;
  supportedCapabilities: ReadonlySet<string>;
  environmentAvailable: (capabilityRef: AdmissionRequest["required_capability"]) => boolean;
  /** SPEC-603 §4's "policy" admission check — distinct from authorization (identity/permission) and from the quota/capacity checks below. `true` permits the request. */
  policyAllowed: (request: AdmissionRequest) => boolean;
  now: () => Date;
}>;

const DEFAULT_QUOTA: WorkspaceQuota = { workspace_id: "", max_concurrent: 1, reserved_critical_slots: 0 };

/**
 * SPEC-603 §4: "Admission SHALL validate authorization, quotas, supported
 * capability, environment availability, deadline feasibility, and
 * policy. Rejection and deferment SHALL be distinct." The first failing
 * check produces a `rejected` decision with its matching reason; a
 * request that passes every other check but currently exceeds quota is
 * `deferred` (retryable) rather than `rejected` (permanent) — never one
 * generic failure.
 */
export async function evaluateAdmission(
  dependencies: AdmissionDependencies,
  request: AdmissionRequest,
): Promise<AdmissionDecision> {
  const authorization = await dependencies.authorizer.authorize({
    operation_id: request.request_id,
    context: request.context,
    purpose: `scheduling:admit:${request.operation_type}`,
    consequence_class: "reversible",
    required_permissions: ["scheduling:admit"],
    resource_refs: [`workspace:${request.workspace_id}`],
  });
  if (!authorization.ok) {
    return { outcome: "rejected", reason: "unauthorized" };
  }

  const capabilityKey = `${request.required_capability.id}@${request.required_capability.version}`;
  if (!dependencies.supportedCapabilities.has(capabilityKey)) {
    return { outcome: "rejected", reason: "unsupported_capability" };
  }

  if (!dependencies.environmentAvailable(request.required_capability)) {
    return { outcome: "rejected", reason: "environment_unavailable" };
  }

  const deadlineMs = Date.parse(request.deadline);
  const nowMs = dependencies.now().valueOf();
  if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) {
    return { outcome: "rejected", reason: "deadline_infeasible" };
  }

  if (!dependencies.policyAllowed(request)) {
    return { outcome: "rejected", reason: "policy_denied" };
  }

  const quota = dependencies.quotas.get(request.workspace_id) ?? { ...DEFAULT_QUOTA, workspace_id: request.workspace_id };
  // A request whose own resource estimate can never fit even with the
  // Workspace fully idle SHALL NOT wait — no amount of deferment makes it
  // admissible, so it is a permanent `quota_exceeded` rejection, not a
  // retryable deferment (SPEC-603 §4's "rejection and deferment SHALL be
  // distinct" cuts both ways: a request must not be deferred forever when
  // it was never admissible in the first place).
  if (request.estimated_resources.concurrency_slots > quota.max_concurrent) {
    return { outcome: "rejected", reason: "quota_exceeded" };
  }

  // Otherwise, exceeding *current* capacity is a deferment — the request
  // may still be admitted once in-flight work frees up (SPEC-603 §4).
  const inFlight = dependencies.currentInFlight(request.workspace_id);
  const availableSlots =
    request.priority === "critical_governance"
      ? quota.max_concurrent - inFlight
      : quota.max_concurrent - quota.reserved_critical_slots - inFlight;
  if (availableSlots <= 0) {
    dependencies.queue.enqueue(request);
    return {
      outcome: "deferred",
      reason: `Workspace "${request.workspace_id}" is at capacity (${inFlight}/${quota.max_concurrent}).`,
      retry_after: new Date(nowMs + 5_000).toISOString(),
    };
  }

  return { outcome: "admitted", queue_position: 0 };
}
