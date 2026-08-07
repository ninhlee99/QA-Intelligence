import assert from "node:assert/strict";
import test from "node:test";

import { LeaseManager } from "../../src/scheduling/lease-manager.js";

function makeManager(now: () => Date = () => new Date("2026-08-08T09:00:00.000Z")): LeaseManager {
  return new LeaseManager({ now });
}

test("issue creates a lease with fencing_token 1", () => {
  const manager = makeManager();
  const lease = manager.issue("env:staging", "workspace-alpha", 60);

  assert.equal(lease.fencing_token, 1);
  assert.equal(lease.workspace_id, "workspace-alpha");
  assert.equal(lease.renewed_count, 0);
});

test("validate succeeds for the current fencing token", () => {
  const manager = makeManager();
  const lease = manager.issue("env:staging", "workspace-alpha", 60);

  const result = manager.validate(lease.lease_id, lease.fencing_token);

  assert.equal(result.ok, true, JSON.stringify(result));
});

test("renew increments the fencing token; the prior token becomes stale", () => {
  const manager = makeManager();
  const lease = manager.issue("env:staging", "workspace-alpha", 60);

  const renewed = manager.renew(lease.lease_id, lease.fencing_token, 60);
  assert.equal(renewed.ok, true, JSON.stringify(renewed));
  if (!renewed.ok) return;
  assert.equal(renewed.value.fencing_token, 2);
  assert.equal(renewed.value.renewed_count, 1);

  const staleValidation = manager.validate(lease.lease_id, lease.fencing_token);
  assert.equal(staleValidation.ok, false);
  if (staleValidation.ok) return;
  assert.equal(staleValidation.failure, "fencing_mismatch");

  const currentValidation = manager.validate(lease.lease_id, renewed.value.fencing_token);
  assert.equal(currentValidation.ok, true, JSON.stringify(currentValidation));
});

test("fencing: a stale worker presenting a superseded token is rejected on renew too", () => {
  const manager = makeManager();
  const lease = manager.issue("env:staging", "workspace-alpha", 60);
  manager.renew(lease.lease_id, lease.fencing_token, 60);

  const staleRenew = manager.renew(lease.lease_id, lease.fencing_token, 60);

  assert.equal(staleRenew.ok, false);
  if (staleRenew.ok) return;
  assert.equal(staleRenew.failure, "fencing_mismatch");
});

test("expiry: validate fails once the lease's expires_at has passed", () => {
  let currentTime = new Date("2026-08-08T09:00:00.000Z");
  const manager = makeManager(() => currentTime);
  const lease = manager.issue("env:staging", "workspace-alpha", 10);

  currentTime = new Date("2026-08-08T09:00:11.000Z");
  const result = manager.validate(lease.lease_id, lease.fencing_token);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, "expired");
});

test("expireStale sweeps leases past expiry and returns their resource_refs", () => {
  let currentTime = new Date("2026-08-08T09:00:00.000Z");
  const manager = makeManager(() => currentTime);
  manager.issue("env:staging-1", "workspace-alpha", 10);
  manager.issue("env:staging-2", "workspace-alpha", 1000);

  currentTime = new Date("2026-08-08T09:00:11.000Z");
  const freed = manager.expireStale();

  assert.deepEqual(freed, ["env:staging-1"]);
});

test("an unknown lease_id is a distinct unknown_lease failure", () => {
  const manager = makeManager();
  const result = manager.validate("lease-never-issued", 1);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure, "unknown_lease");
});
