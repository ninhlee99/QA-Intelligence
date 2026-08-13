import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeEvidenceManifest } from "../../src/reporting/evidence-manifest.js";

test("writeEvidenceManifest attributes real evidence to its testcase with size and sha256", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qa-evidence-manifest-"));
  const videoPath = join(dir, "case.webm");
  await writeFile(videoPath, "real-video-bytes");
  const manifestPath = join(dir, "manifest.json");

  const result = await writeEvidenceManifest({
    manifest_path: manifestPath,
    run_id: "run-1",
    generated_at: "2026-08-12T00:00:00.000Z",
    test_cases: [{ test_case_id: "TC-1", outcome: "passed", evidence: [videoPath, "capture:TC-1"] }],
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { entries: Array<Record<string, unknown>> };
  assert.equal(manifest.entries[0]?.["test_case_id"], "TC-1");
  assert.equal(manifest.entries[0]?.["kind"], "video");
  assert.equal(manifest.entries[0]?.["size_bytes"], 16);
  assert.match(String(manifest.entries[0]?.["sha256"]), /^[a-f0-9]{64}$/);
  assert.equal(manifest.entries[1]?.["kind"], "dom_capture");
});
