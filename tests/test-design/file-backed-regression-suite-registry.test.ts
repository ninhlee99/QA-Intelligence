import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FileBackedRegressionSuiteRegistry } from "../../src/test-design/file-backed-regression-suite-registry.js";

test("FileBackedRegressionSuiteRegistry survives remount", () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-reg-"));
  try {
    const clock = { now: (): Date => new Date("2026-08-10T12:00:00.000Z") };
    const first = new FileBackedRegressionSuiteRegistry(clock, dir);
    const registered = first.register({
      workspace_id: "ws-1",
      id: "suite:smoke",
      label: "smoke",
      cases: [{ kind: "api", case: { id: "health", method: "GET", path: "/health", expect: { status: 200 } } }],
    });
    assert.equal(registered.ok, true);
    if (!registered.ok) return;
    assert.ok(registered.persisted_path.endsWith(".json"));
    assert.ok(registered.persisted_path.includes("suite_smoke") || registered.persisted_path.includes("smoke"));

    const second = new FileBackedRegressionSuiteRegistry(clock, dir);
    const listed = second.list("ws-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "suite:smoke");
    const loaded = second.get("ws-1", "suite:smoke");
    assert.equal(loaded?.cases.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
