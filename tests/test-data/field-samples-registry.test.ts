import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileBackedWorkspaceDatasetRegistry } from "../../src/test-data/file-backed-workspace-dataset-registry.js";
import { InMemoryWorkspaceDatasetRegistry } from "../../src/test-data/workspace-dataset-registry.js";
import { validateSyntheticFieldSamples } from "../../src/test-data/validate-field-samples.js";

test("validateSyntheticFieldSamples rejects credential-shaped keys", () => {
  const bad = validateSyntheticFieldSamples({
    classification: "synthetic",
    field_samples: { Password: "not-a-secret" },
  });
  assert.equal(bad.ok, false);
});

test("validateSyntheticFieldSamples rejects non-synthetic classification", () => {
  const bad = validateSyntheticFieldSamples({
    classification: "adversarial_and_boundary",
    field_samples: { Username: "demo" },
  });
  assert.equal(bad.ok, false);
});

test("validateSyntheticFieldSamples accepts synthetic fills", () => {
  const good = validateSyntheticFieldSamples({
    classification: "synthetic",
    field_samples: { Username: "demo-user", Email: "qa@example.test" },
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.samples["Username"], "demo-user");
});

test("registry stores field_samples for synthetic datasets", () => {
  const registry = new InMemoryWorkspaceDatasetRegistry({
    now: () => new Date("2026-08-11T00:00:00.000Z"),
  });
  const registered = registry.register({
    workspace_id: "ws-1",
    purpose: "Login happy path fills",
    classification: "synthetic",
    field_samples: { Username: "demo-user", Email: "qa@example.test" },
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.deepEqual(registered.dataset.field_samples, {
    Username: "demo-user",
    Email: "qa@example.test",
  });

  const rejected = registry.register({
    workspace_id: "ws-1",
    purpose: "Bad secret sample",
    classification: "synthetic",
    field_samples: { "API Token": "sk-live-abc" },
  });
  assert.equal(rejected.ok, false);
});

test("FileBackedWorkspaceDatasetRegistry persists and reloads samples", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-datasets-"));
  try {
    const clock = { now: () => new Date("2026-08-11T01:00:00.000Z") };
    const first = new FileBackedWorkspaceDatasetRegistry(clock, root);
    const registered = first.register({
      workspace_id: "ws-persist",
      purpose: "Persist samples",
      id: "dataset-login",
      field_samples: { Username: "persist-user" },
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.ok("persisted_path" in registered);
    const raw = JSON.parse(readFileSync(registered.persisted_path, "utf8")) as {
      field_samples?: Record<string, string>;
    };
    assert.equal(raw.field_samples?.["Username"], "persist-user");

    const second = new FileBackedWorkspaceDatasetRegistry(clock, root);
    const loaded = second.get("ws-persist", "dataset-login");
    assert.ok(loaded);
    assert.equal(loaded?.field_samples?.["Username"], "persist-user");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
