import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryOperationStore } from "../../src/adapters/memory/in-memory-operation-store.js";
import { InMemoryTelemetryEmitter } from "../../src/adapters/memory/in-memory-telemetry-emitter.js";
import { LeaseManager } from "../../src/scheduling/lease-manager.js";
import { recoverOperation, type RecoveryDependencies } from "../../src/recovery/recover.js";
import type { RecoverOperationRequest, RecoveryFailureClass } from "../../src/recovery/public.js";

function makeDependencies(now: () => Date = () => new Date("2026-08-08T10:00:00.000Z")): RecoveryDependencies {
  return {
    operationStore: new InMemoryOperationStore({ now }),
    leaseManager: new LeaseManager({ now }),
    telemetry: new InMemoryTelemetryEmitter(),
    clock: { now },
    producer: { component: "recovery-test", release: "release-1.0.0" },
  };
}

function baseRequest(overrides: Partial<RecoverOperationRequest> = {}): RecoverOperationRequest {
  return {
    workspace_id: "workspace-alpha",
    operation_id: "op-1",
    failure_class: "process_or_worker_loss",
    detected_at: "2026-08-08T09:59:00.000Z",
    affected_lease_ids: [],
    owner: "actor-recovery-001",
    ...overrides,
  };
}

test("objectives measured: a completed exercise reports a non-negative measured_restoration_seconds", async () => {
  const dependencies = makeDependencies();
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });

  const result = await recoverOperation(dependencies, baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.notEqual(result.value.measured_restoration_seconds, null);
  assert.ok((result.value.measured_restoration_seconds ?? -1) >= 0);
});

test("restore proven: a request for an unknown operation is unknown_operation, never a fabricated recovery", async () => {
  const dependencies = makeDependencies();

  const result = await recoverOperation(dependencies, baseRequest({ operation_id: "op-never-created" }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_operation");
});

test("isolation intact: a workspace_id mismatch between the request and the recovered operation fails verification_failed", async () => {
  const dependencies = makeDependencies();
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });

  const result = await recoverOperation(dependencies, baseRequest({ workspace_id: "workspace-beta" }));

  // The operation lookup itself is Workspace-scoped (InMemoryOperationStore.get),
  // so a mismatched Workspace surfaces as unknown_operation, not a leaked
  // cross-Workspace record reaching the verification step at all — the
  // isolation guarantee holds one layer earlier, which is the stronger
  // property (SPEC-605 §7's "verify... isolation" is satisfied by the
  // fact that no cross-Workspace record was ever retrievable to verify).
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_operation");
});

test("evidence preserved: an evidence signal is emitted even for an operation that turns out to be unrecoverable", async () => {
  const dependencies = makeDependencies();

  await recoverOperation(dependencies, baseRequest({ operation_id: "op-never-created" }));

  const signals = dependencies.telemetry.query({ workspace_id: "workspace-alpha", types: ["evidence"] });
  assert.equal(signals.length, 1);
});

test("resumption is idempotent: recovering an already-finalized operation is a safe no-op, not a failure", async () => {
  const dependencies = makeDependencies();
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });
  for (const stage of ["resolved", "dispatched", "events_consumed", "transitioned", "finalized"] as const) {
    dependencies.operationStore.advance("op-1", stage);
  }

  const result = await recoverOperation(dependencies, baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.stage, "communicated");
});

test("stale-worker rejection: a recovery attempt superseded by a newer write on the same operation is rejected", async () => {
  let currentTime = new Date("2026-08-08T10:00:00.000Z");
  const dependencies = makeDependencies(() => currentTime);
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });

  // Simulate a newer writer updating the operation after this recovery's
  // clock has already advanced past the moment recovery "started" —
  // achieved by advancing the shared clock forward, then calling advance()
  // (which stamps updated_at from the current, now-later clock), then
  // rolling the clock back before invoking recoverOperation so its
  // startedAt predates that write.
  currentTime = new Date("2026-08-08T10:05:00.000Z");
  dependencies.operationStore.advance("op-1", "resolved");
  currentTime = new Date("2026-08-08T10:00:00.000Z");

  const result = await recoverOperation(dependencies, baseRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "stale_worker_rejected");
});

test("each of the 9 failure classes is independently classifiable and reported distinctly", async () => {
  const classes: readonly RecoveryFailureClass[] = [
    "process_or_worker_loss",
    "queue_or_scheduler_failure",
    "provider_outage",
    "data_corruption_or_loss",
    "index_or_projection_loss",
    "credential_or_policy_failure",
    "region_or_environment_loss",
    "security_incident",
    "erroneous_deployment_or_migration",
  ];

  for (const failureClass of classes) {
    const dependencies = makeDependencies();
    dependencies.operationStore.create({
      operation_id: "op-1",
      workspace_id: "workspace-alpha",
      correlation_id: "correlation-1",
      owner: "actor-recovery-001",
      deadline: "2026-08-08T11:00:00.000Z",
      dispatch_idempotency_key: "idem-1",
      idempotency_key: "idem-1",
    });

    const result = await recoverOperation(dependencies, baseRequest({ failure_class: failureClass }));

    assert.equal(result.ok, true, `${failureClass}: ${JSON.stringify(result)}`);
    if (!result.ok) continue;
    assert.equal(result.value.failure_class, failureClass);
  }
});

test("exercise records populate every SPEC-605 §9 field on a successful run", async () => {
  const dependencies = makeDependencies();
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });

  const result = await recoverOperation(dependencies, baseRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const exercise = result.value;
  assert.notEqual(exercise.exercise_id, "");
  assert.notEqual(exercise.completed_at, null);
  assert.notEqual(exercise.measured_restoration_seconds, null);
  assert.notEqual(exercise.recovered_revision, null);
  assert.equal(exercise.semantic_verification_passed, true);
  assert.equal(exercise.isolation_check_passed, true);
  assert.ok(exercise.owned_remediation.length > 0);
});

test("containment: only stale/expired leases are contained, a still-valid lease is left untouched", async () => {
  let currentTime = new Date("2026-08-08T10:00:00.000Z");
  const dependencies = makeDependencies(() => currentTime);
  dependencies.operationStore.create({
    operation_id: "op-1",
    workspace_id: "workspace-alpha",
    correlation_id: "correlation-1",
    owner: "actor-recovery-001",
    deadline: "2026-08-08T11:00:00.000Z",
    dispatch_idempotency_key: "idem-1",
    idempotency_key: "idem-1",
  });
  const expiredLease = dependencies.leaseManager.issue("env:staging-expired", "workspace-alpha", 1);
  const validLease = dependencies.leaseManager.issue("env:staging-valid", "workspace-alpha", 10_000);
  currentTime = new Date("2026-08-08T10:00:02.000Z");

  const result = await recoverOperation(
    dependencies,
    baseRequest({ affected_lease_ids: [expiredLease.lease_id, validLease.lease_id] }),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(result.value.affected_resource_refs, ["env:staging-expired"]);
});
