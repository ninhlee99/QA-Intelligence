import assert from "node:assert/strict";
import test from "node:test";
import { selectIncrementalTests } from "../../src/continuous-qa/incremental-test-selection.js";

test("incremental selection includes traced cases plus mandatory critical smoke and explains every choice", () => {
  const result = selectIncrementalTests({ changed_paths: ["src/auth/login.ts"], cases: [
    { id: "TC-AUTH", traced_paths: ["src/auth/**"], tags: ["auth"], critical: false },
    { id: "TC-PAY", traced_paths: ["src/payments/**"], tags: ["payment"], critical: true },
    { id: "TC-HELP", traced_paths: ["src/help/**"], tags: [], critical: false },
  ], critical_smoke_ids: ["TC-PAY"] });
  assert.deepEqual(result.selected.map((item) => item.id), ["TC-AUTH", "TC-PAY"]);
  assert.equal(result.full_regression_required, false);
  assert.ok(result.selected.every((item) => item.reasons.length > 0));
});

test("shared infrastructure changes require full regression", () => {
  const result = selectIncrementalTests({ changed_paths: ["package-lock.json"], cases: [{ id: "TC-1", traced_paths: [], tags: [], critical: false }], critical_smoke_ids: [] });
  assert.equal(result.full_regression_required, true);
  assert.deepEqual(result.selected.map((item) => item.id), ["TC-1"]);
});
