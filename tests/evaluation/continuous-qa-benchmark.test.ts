import assert from "node:assert/strict";
import test from "node:test";
import { assessContinuousQaBenchmark } from "../../src/evaluation/continuous-qa-benchmark.js";
test("continuous QA benchmark fails closed on latency or integrity", () => {
  const result = assessContinuousQaBenchmark({ selection_cases: 10_000, selection_duration_ms: 501, max_selection_duration_ms: 500, deterministic: true, integrity_verified: false, trend_gate_verified: true });
  assert.equal(result.passed, false); assert.equal(result.blockers.length, 2);
});
