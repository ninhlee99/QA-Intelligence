import assert from "node:assert/strict";
import test from "node:test";

import { readPngDimensions } from "../../src/visual-testing/ui-baseline.js";

function pngWithDims(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test("readPngDimensions reads IHDR width/height", () => {
  const dims = readPngDimensions(pngWithDims(1280, 720));
  assert.equal(dims.ok, true);
  if (!dims.ok) return;
  assert.equal(dims.width, 1280);
  assert.equal(dims.height, 720);
});

test("readPngDimensions rejects non-PNG", () => {
  const result = readPngDimensions(Buffer.from("not-a-png"));
  assert.equal(result.ok, false);
});
