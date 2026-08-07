import type { InMemoryOperationStore } from "../adapters/memory/in-memory-operation-store.js";
import type { InMemoryTelemetryEmitter } from "../adapters/memory/in-memory-telemetry-emitter.js";
import type { LeaseManager } from "../scheduling/lease-manager.js";
import type {
  RecoverOperationOutput,
  RecoverOperationRequest,
  RecoveryExercise,
  RecoveryFailureCode,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export type RecoveryDependencies = Readonly<{
  operationStore: InMemoryOperationStore;
  leaseManager: LeaseManager;
  telemetry: InMemoryTelemetryEmitter;
  clock: Clock;
  producer: Readonly<{ component: string; release: string }>;
}>;

let exerciseCounter = 0;

/**
 * SPEC-605 §4's 8-step recovery order, implemented as a free-function
 * pipeline (mirrors `orchestrateOperation()`'s composition style):
 * detect/classify → contain impact → preserve evidence → restore
 * authoritative state → rebuild derived state → resume idempotent work →
 * verify semantics/isolation → communicate/learn. Each step short-circuits
 * on failure except evidence preservation, which happens *before* any
 * state mutation so it survives even if a later step fails (§1).
 */
export async function recoverOperation(
  dependencies: RecoveryDependencies,
  request: RecoverOperationRequest,
): Promise<RecoverOperationOutput> {
  exerciseCounter += 1;
  const exerciseId = `recovery-exercise-${exerciseCounter}`;
  const startedAt = dependencies.clock.now();

  // Step 1: Detect and Classify — the failure class is caller-supplied,
  // not inferred (a live health-check detector is out of scope for this
  // pass, matching how consequence/priority classification is
  // caller-supplied elsewhere in this session).

  // Step 2: Contain Impact — only leases that are actually stale/expired
  // are contained; a lease still validly held is left untouched (§6:
  // don't disrupt work that's genuinely still healthy).
  const now = dependencies.clock.now();
  const containedLeaseRefs: string[] = [];
  for (const leaseId of request.affected_lease_ids) {
    const lease = dependencies.leaseManager.get(leaseId);
    if (lease === undefined) continue;
    if (Date.parse(lease.expires_at) <= now.valueOf()) {
      containedLeaseRefs.push(lease.resource_ref);
    }
  }

  // Step 3: Preserve Evidence — recorded before any state mutation so it
  // survives even if restoration/verification later fails.
  dependencies.telemetry.emit({
    type: "evidence",
    evidence_ref: `recovery:${exerciseId}`,
    conclusion: `Failure class "${request.failure_class}" detected for operation "${request.operation_id}" at ${request.detected_at}; contained lease resources: ${containedLeaseRefs.join(", ") || "none"}.`,
    correlation: {
      workspace_id: request.workspace_id,
      component: dependencies.producer.component,
      release: dependencies.producer.release,
      evidence_refs: containedLeaseRefs,
    },
    occurred_at: dependencies.clock.now().toISOString(),
  });
  const evidenceGaps: string[] = request.affected_lease_ids.filter(
    (leaseId) => dependencies.leaseManager.get(leaseId) === undefined,
  ).length > 0
    ? [`${request.affected_lease_ids.filter((leaseId) => dependencies.leaseManager.get(leaseId) === undefined).length} affected_lease_ids referenced no known lease`]
    : [];

  // Step 4: Restore Authoritative State.
  const operation = dependencies.operationStore.get(request.workspace_id, request.operation_id);
  if (operation === undefined) {
    return recoveryFailure("unknown_operation", `No durable operation "${request.operation_id}" in Workspace "${request.workspace_id}" to restore.`, false);
  }

  // Step 5: Rebuild Derived State — no derived-index rebuild target is
  // wired into this tracer bullet (a real integration would rebuild a
  // Knowledge Graph projection or similar here); modeled as a stage this
  // pipeline passes through, not silently omitted from RecoveryStage.

  // Step 6: Resume Idempotent Work — an already-finalized operation is
  // left alone; resuming finished work is exactly what §6 prohibits.
  const alreadyFinalized = operation.state === "finalized";

  // Step 7: Verify Semantics and Isolation. `operationStore.get` is already
  // Workspace-scoped, so a mismatched Workspace is caught one layer
  // earlier as `unknown_operation` (§4) and this branch is unreachable
  // through the in-memory store today — kept as defense-in-depth for a
  // future store implementation that might not enforce Workspace scope at
  // the lookup boundary, not because this test suite can exercise it.
  if (operation.workspace_id !== request.workspace_id) {
    return recoveryFailure("verification_failed", "Recovered operation's Workspace does not match the recovery request's Workspace.", false);
  }
  // §6: "stale workers SHALL not overwrite newer outcomes" — if the
  // durable record was updated by someone else after this recovery
  // attempt began, a second writer raced this one; the later write wins
  // and this recovery attempt is the stale one, not the record.
  const recoveryRacedWithNewerWrite = Date.parse(operation.updated_at) > startedAt.valueOf();
  if (recoveryRacedWithNewerWrite) {
    return recoveryFailure("stale_worker_rejected", "The durable operation was updated by a newer writer during this recovery attempt.", true);
  }

  // Step 8: Communicate and Learn.
  const completedAt = dependencies.clock.now();
  dependencies.telemetry.emit({
    type: "log",
    level: "info",
    message: `Recovery exercise "${exerciseId}" for operation "${request.operation_id}" completed (failure_class: ${request.failure_class}, already_finalized: ${alreadyFinalized}).`,
    correlation: {
      workspace_id: request.workspace_id,
      component: dependencies.producer.component,
      release: dependencies.producer.release,
      evidence_refs: [`recovery:${exerciseId}`],
    },
    occurred_at: completedAt.toISOString(),
  });

  const exercise: RecoveryExercise = {
    exercise_id: exerciseId,
    workspace_id: request.workspace_id,
    failure_class: request.failure_class,
    affected_resource_refs: containedLeaseRefs,
    stage: "communicated",
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    measured_restoration_seconds: (completedAt.valueOf() - startedAt.valueOf()) / 1000,
    recovered_revision: operation.updated_at,
    semantic_verification_passed: true,
    isolation_check_passed: true,
    evidence_gaps: evidenceGaps,
    owned_remediation: [`${request.owner} to review failure class "${request.failure_class}" root cause.`],
  };
  return { ok: true, value: exercise };
}

function recoveryFailure(code: RecoveryFailureCode, message: string, retryable: boolean): RecoverOperationOutput {
  return { ok: false, failure: { code, message, retryable } };
}
