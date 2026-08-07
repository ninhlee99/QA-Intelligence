import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryWorkspaceManager } from "../../src/adapters/memory/in-memory-workspace-manager.js";

function makeManager(): InMemoryWorkspaceManager {
  return new InMemoryWorkspaceManager({ now: () => new Date("2026-08-08T10:00:00.000Z") });
}

async function provisionedManager(): Promise<InMemoryWorkspaceManager> {
  const manager = makeManager();
  await manager.provision({
    id: "workspace-alpha",
    owner: "actor-owner-001",
    environment: "test",
    actor_id: "actor-owner-001",
    reason: "initial provisioning",
    idempotency_key: "idem-provision-1",
  });
  return manager;
}

test("provision creates a new Workspace at provisioning status", async () => {
  const manager = makeManager();
  const result = await manager.provision({
    id: "workspace-alpha",
    owner: "actor-owner-001",
    environment: "test",
    actor_id: "actor-owner-001",
    reason: "initial provisioning",
    idempotency_key: "idem-provision-1",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "provisioning");
});

test("idempotent provisioning: the same idempotency_key does not create two aggregates", async () => {
  const manager = makeManager();
  const request = {
    id: "workspace-alpha",
    owner: "actor-owner-001",
    environment: "test",
    actor_id: "actor-owner-001",
    reason: "initial provisioning",
    idempotency_key: "idem-provision-1",
  };
  const first = await manager.provision(request);
  const second = await manager.provision(request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second);
});

test("lifecycle legality: provisioning -> active -> suspended -> active -> retiring -> archived", async () => {
  const manager = await provisionedManager();

  const active = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 1, to_status: "active", actor_id: "actor-owner-001", reason: "activate" });
  assert.equal(active.ok, true, JSON.stringify(active));

  const suspended = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 2, to_status: "suspended", actor_id: "actor-owner-001", reason: "suspend" });
  assert.equal(suspended.ok, true, JSON.stringify(suspended));

  const reactivated = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 3, to_status: "active", actor_id: "actor-owner-001", reason: "reactivate" });
  assert.equal(reactivated.ok, true, JSON.stringify(reactivated));

  const retiring = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 4, to_status: "retiring", actor_id: "actor-owner-001", reason: "retire" });
  assert.equal(retiring.ok, true, JSON.stringify(retiring));

  const archived = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 5, to_status: "archived", actor_id: "actor-owner-001", reason: "archive" });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  if (!archived.ok) return;
  assert.equal(archived.value.status, "archived");
});

test("lifecycle legality: an illegal transition (archived -> active) is rejected", async () => {
  const manager = await provisionedManager();
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 1, to_status: "active", actor_id: "actor-owner-001", reason: "activate" });
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 2, to_status: "retiring", actor_id: "actor-owner-001", reason: "retire" });
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 3, to_status: "archived", actor_id: "actor-owner-001", reason: "archive" });

  const result = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 4, to_status: "active", actor_id: "actor-owner-001", reason: "resurrect" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_transition");
});

test("suspension blocks new membership until reactivated", async () => {
  const manager = await provisionedManager();
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 1, to_status: "active", actor_id: "actor-owner-001", reason: "activate" });
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 2, to_status: "suspended", actor_id: "actor-owner-001", reason: "suspend" });

  const blocked = await manager.addMembership({
    workspace_id: "workspace-alpha",
    expected_revision: 3,
    actor_id: "actor-new-member",
    roles: ["reviewer"],
    granted_by: "actor-owner-001",
    reason: "add during suspension",
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.failure.code, "suspended_workspace");

  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 3, to_status: "active", actor_id: "actor-owner-001", reason: "reactivate" });
  const allowed = await manager.addMembership({
    workspace_id: "workspace-alpha",
    expected_revision: 4,
    actor_id: "actor-new-member",
    roles: ["reviewer"],
    granted_by: "actor-owner-001",
    reason: "add after reactivation",
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed));
});

test("confused-deputy: provisioning a Workspace does not auto-grant membership", async () => {
  const manager = await provisionedManager();
  const members = await manager.listMembership("workspace-alpha");

  assert.equal(members.ok, true, JSON.stringify(members));
  if (!members.ok) return;
  assert.equal(members.value.length, 0);
});

test("membership add/update/remove round-trip", async () => {
  const manager = await provisionedManager();
  await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 1, to_status: "active", actor_id: "actor-owner-001", reason: "activate" });

  const added = await manager.addMembership({
    workspace_id: "workspace-alpha",
    expected_revision: 2,
    actor_id: "actor-member-001",
    roles: ["reviewer"],
    granted_by: "actor-owner-001",
    reason: "onboard",
  });
  assert.equal(added.ok, true, JSON.stringify(added));

  const updated = await manager.updateMembership({
    workspace_id: "workspace-alpha",
    expected_revision: 3,
    actor_id: "actor-member-001",
    roles: ["reviewer", "approver"],
    granted_by: "actor-owner-001",
    reason: "grant approver",
  });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  if (!updated.ok) return;
  assert.deepEqual(updated.value.roles, ["reviewer", "approver"]);

  const removed = await manager.removeMembership({
    workspace_id: "workspace-alpha",
    expected_revision: 4,
    actor_id: "actor-member-001",
    removed_by: "actor-owner-001",
    reason: "offboard",
  });
  assert.equal(removed.ok, true, JSON.stringify(removed));

  const members = await manager.listMembership("workspace-alpha");
  assert.equal(members.ok, true);
  if (!members.ok) return;
  assert.equal(members.value.length, 0);
});

test("bindPolicy is revision-checked and audited", async () => {
  const manager = await provisionedManager();
  const bound = await manager.bindPolicy({
    workspace_id: "workspace-alpha",
    expected_revision: 1,
    policy_ref: { id: "policy-default", version: "1.0.0" },
    actor_id: "actor-owner-001",
    reason: "bind default policy",
  });

  assert.equal(bound.ok, true, JSON.stringify(bound));
  if (!bound.ok) return;
  assert.deepEqual(bound.value.policy_ref, { id: "policy-default", version: "1.0.0" });

  const staleAttempt = await manager.bindPolicy({
    workspace_id: "workspace-alpha",
    expected_revision: 1,
    policy_ref: { id: "policy-default", version: "2.0.0" },
    actor_id: "actor-owner-001",
    reason: "stale rebind",
  });
  assert.equal(staleAttempt.ok, false);
  if (staleAttempt.ok) return;
  assert.equal(staleAttempt.failure.code, "conflict");

  const history = await manager.getAuditHistory("workspace-alpha");
  assert.equal(history.ok, true);
  if (!history.ok) return;
  assert.ok(history.value.some((record) => record.policy_version === "policy-default@1.0.0"));
});

test("cross-Workspace isolation: audit history for one Workspace never includes another's records", async () => {
  const manager = makeManager();
  await manager.provision({ id: "workspace-alpha", owner: "actor-owner-001", environment: "test", actor_id: "actor-owner-001", reason: "provision alpha", idempotency_key: "idem-alpha" });
  await manager.provision({ id: "workspace-beta", owner: "actor-owner-002", environment: "test", actor_id: "actor-owner-002", reason: "provision beta", idempotency_key: "idem-beta" });

  const alphaHistory = await manager.getAuditHistory("workspace-alpha");
  assert.equal(alphaHistory.ok, true);
  if (!alphaHistory.ok) return;
  assert.ok(alphaHistory.value.every((record) => record.workspace_id === "workspace-alpha"));
  assert.equal(alphaHistory.value.length, 1);
});

test("unknown Workspace operations fail closed with unknown_workspace", async () => {
  const manager = makeManager();
  const result = await manager.getWorkspace("workspace-never-provisioned");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unknown_workspace");
});

test("a stale expected_revision on transitionLifecycle is a conflict, not a silent overwrite", async () => {
  const manager = await provisionedManager();
  const result = await manager.transitionLifecycle({ id: "workspace-alpha", expected_revision: 99, to_status: "active", actor_id: "actor-owner-001", reason: "stale" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "conflict");
});
