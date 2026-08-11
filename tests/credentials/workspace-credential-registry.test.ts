import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileBackedWorkspaceCredentialRegistry } from "../../src/credentials/file-backed-workspace-credential-registry.js";
import { InMemoryWorkspaceCredentialRegistry } from "../../src/credentials/workspace-credential-registry.js";
import {
  mergeFieldValuesWithSecrets,
  resolvePasswordInput,
} from "../../src/credentials/resolve-secret-input.js";

const clock = { now: (): Date => new Date("2026-08-10T12:00:00.000Z") };

test("registry registers and lists metadata without exposing values", () => {
  const registry = new InMemoryWorkspaceCredentialRegistry(clock);
  const registered = registry.register({
    workspace_id: "ws-1",
    secret_ref: "workspace-secret:staging-pass",
    value: "s3cret",
    kind: "password",
    label: "Staging",
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const listed = registry.list("ws-1");
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.secret_ref, "workspace-secret:staging-pass");
  assert.equal(listed[0]?.label, "Staging");
  assert.ok(!JSON.stringify(listed).includes("s3cret"));

  assert.equal(registry.resolveSync("workspace-secret:staging-pass", "ws-1"), "s3cret");
  assert.equal(registry.resolveSync("workspace-secret:staging-pass", "ws-other"), undefined);
});

test("registry rejects malformed secret_ref", () => {
  const registry = new InMemoryWorkspaceCredentialRegistry(clock);
  const result = registry.register({
    workspace_id: "ws-1",
    secret_ref: "not-a-ref",
    value: "x",
  });
  assert.equal(result.ok, false);
});

test("resolvePasswordInput prefers secret_ref and rejects both literal+ref", () => {
  const registry = new InMemoryWorkspaceCredentialRegistry(clock);
  registry.register({
    workspace_id: "ws-1",
    secret_ref: "workspace-secret:demo-password",
    value: "demo-pass",
  });

  const viaRef = resolvePasswordInput({
    registry,
    workspaceId: "ws-1",
    password_secret_ref: "workspace-secret:demo-password",
  });
  assert.equal(viaRef.ok, true);
  if (viaRef.ok) {
    assert.equal(viaRef.value, "demo-pass");
    assert.equal(viaRef.via, "secret_ref");
  }

  const both = resolvePasswordInput({
    registry,
    workspaceId: "ws-1",
    password: "literal",
    password_secret_ref: "workspace-secret:demo-password",
  });
  assert.equal(both.ok, false);
});

test("mergeFieldValuesWithSecrets resolves refs and rejects conflicts", () => {
  const registry = new InMemoryWorkspaceCredentialRegistry(clock);
  registry.register({
    workspace_id: "ws-1",
    secret_ref: "workspace-secret:demo-password",
    value: "demo-pass",
  });

  const merged = mergeFieldValuesWithSecrets({
    registry,
    workspaceId: "ws-1",
    field_values: { Username: "demo-user" },
    field_secret_refs: { Password: "workspace-secret:demo-password" },
  });
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  assert.equal(merged.values.get("Username"), "demo-user");
  assert.equal(merged.values.get("Password"), "demo-pass");

  const conflict = mergeFieldValuesWithSecrets({
    registry,
    workspaceId: "ws-1",
    field_values: { Password: "literal" },
    field_secret_refs: { Password: "workspace-secret:demo-password" },
  });
  assert.equal(conflict.ok, false);
});

test("file-backed registry survives a second instance load from disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-creds-"));
  try {
    const first = new FileBackedWorkspaceCredentialRegistry(clock, dir);
    const registered = first.register({
      workspace_id: "ws-1",
      secret_ref: "workspace-secret:staging-pass",
      value: "s3cret",
      kind: "password",
      label: "Staging",
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.ok(registered.persisted_path);

    const second = new FileBackedWorkspaceCredentialRegistry(clock, dir);
    assert.equal(second.resolveSync("workspace-secret:staging-pass", "ws-1"), "s3cret");
    assert.equal(second.list("ws-1")[0]?.label, "Staging");
    assert.ok(!JSON.stringify(second.list("ws-1")).includes("s3cret"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
