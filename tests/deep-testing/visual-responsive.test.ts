import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createVisualBaseline, compareVisualBaseline } from "../../src/deep-testing/visual-baseline.js";
import { buildResponsiveMatrix } from "../../src/deep-testing/responsive-matrix.js";

test("exact visual baseline detects changed screenshot bytes without claiming perceptual similarity", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "qa-visual-")), "page.png"); await writeFile(path, "image-a");
  const baseline = await createVisualBaseline({ screenshot_path: path, viewport: { width: 1280, height: 720 }, browser: "chromium" });
  assert.equal((await compareVisualBaseline(baseline)).matched, true);
  await writeFile(path, "image-b"); assert.equal((await compareVisualBaseline(baseline)).matched, false);
});

test("responsive matrix covers mobile tablet and desktop with bounded cases", () => {
  const matrix = buildResponsiveMatrix(["chromium", "webkit"]);
  assert.deepEqual([...new Set(matrix.map((item) => item.classification))], ["mobile", "tablet", "desktop"]);
  assert.equal(matrix.length, 6);
});
