import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyEvidenceRetention } from "../../src/reporting/evidence-retention.js";

test("previews then purges only expired manifest evidence inside an allowed root", async () => {
  const root = await mkdtemp(join(tmpdir(), "qa-retention-"));
  const passed = join(root, "passed.png");
  const failed = join(root, "failed.zip");
  await writeFile(passed, "passed");
  await writeFile(failed, "failed");
  const manifest = join(root, "manifest.json");
  await writeFile(manifest, JSON.stringify({
    schema_version: "1.0.0", run_id: "run-1", generated_at: "2026-01-01T00:00:00.000Z",
    entries: [
      { test_case_id: "TC-P", outcome: "passed", kind: "screenshot", ref: passed },
      { test_case_id: "TC-F", outcome: "failed", kind: "trace", ref: failed },
    ], warnings: [],
  }));

  const policy = { passed_days: 7, failed_days: 30, flaky_days: 30, other_days: 14 } as const;
  const preview = await applyEvidenceRetention({ manifest_path: manifest, allowed_roots: [root], now: "2026-01-20T00:00:00.000Z", policy, confirm_purge: false });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  if (!preview.ok) return;
  assert.deepEqual(preview.candidates, [passed]);
  assert.deepEqual(preview.deleted, []);
  assert.ok(existsSync(passed));

  const purged = await applyEvidenceRetention({ manifest_path: manifest, allowed_roots: [root], now: "2026-01-20T00:00:00.000Z", policy, confirm_purge: true });
  assert.equal(purged.ok, true, JSON.stringify(purged));
  if (!purged.ok) return;
  assert.deepEqual(purged.deleted, [passed]);
  assert.equal(existsSync(passed), false);
  assert.equal(existsSync(failed), true, "failed evidence uses the longer retention window");
});

test("legal hold and root isolation fail closed without deleting evidence", async () => {
  const allowed = await mkdtemp(join(tmpdir(), "qa-retention-allowed-"));
  const outside = await mkdtemp(join(tmpdir(), "qa-retention-outside-"));
  const outsideFile = join(outside, "outside.webm");
  await writeFile(outsideFile, "outside");
  const manifest = join(allowed, "manifest.json");
  await writeFile(manifest, JSON.stringify({
    schema_version: "1.0.0", run_id: "run-2", generated_at: "2025-01-01T00:00:00.000Z",
    entries: [{ test_case_id: "TC-1", outcome: "passed", kind: "video", ref: outsideFile }], warnings: [],
  }));
  const policy = { passed_days: 1, failed_days: 1, flaky_days: 1, other_days: 1 } as const;
  const held = await applyEvidenceRetention({ manifest_path: manifest, allowed_roots: [allowed], now: "2026-01-20T00:00:00.000Z", policy, confirm_purge: true, legal_hold: true });
  assert.equal(held.ok, true);
  if (held.ok) assert.deepEqual(held.deleted, []);
  const isolated = await applyEvidenceRetention({ manifest_path: manifest, allowed_roots: [allowed], now: "2026-01-20T00:00:00.000Z", policy, confirm_purge: true });
  assert.equal(isolated.ok, true);
  if (isolated.ok) assert.ok(isolated.warnings.some((warning) => warning.includes("outside allowed roots")));
  assert.ok(existsSync(outsideFile));
});
