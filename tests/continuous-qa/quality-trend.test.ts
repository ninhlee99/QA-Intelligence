import assert from "node:assert/strict";
import test from "node:test";
import { assessQualityTrend } from "../../src/continuous-qa/quality-trend.js";

test("quality trend blocks a material pass-rate regression or rising escape count", () => {
  const result = assessQualityTrend({ windows: [{ release: "r1", pass_rate: 0.98, flake_rate: 0.01, escaped_defects: 0 }, { release: "r2", pass_rate: 0.90, flake_rate: 0.02, escaped_defects: 2 }], max_pass_rate_drop: 0.03, max_flake_rate: 0.05, max_escaped_defects: 0 });
  assert.equal(result.healthy, false);
  assert.ok(result.blockers.length >= 2);
});
