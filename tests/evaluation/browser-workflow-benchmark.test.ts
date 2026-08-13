import assert from "node:assert/strict";
import test from "node:test";

import { assessBrowserWorkflowBenchmark } from "../../src/evaluation/browser-workflow-benchmark.js";

test("browser workflow parity requires verified Chromium, Firefox, and WebKit observations", () => {
  const report = assessBrowserWorkflowBenchmark([
    { browser: "chromium", status: "passed", proof_refs: ["test:chromium"] },
    { browser: "firefox", status: "passed", proof_refs: ["test:firefox"] },
    { browser: "webkit", status: "passed", proof_refs: ["test:webkit"] },
  ]);
  assert.equal(report.parity_met, true);
  assert.equal(report.passed, 3);
});

test("an unavailable browser remains distinct and blocks parity", () => {
  const report = assessBrowserWorkflowBenchmark([
    { browser: "chromium", status: "passed", proof_refs: ["test:chromium"] },
    { browser: "firefox", status: "unavailable", proof_refs: [], message: "binary missing" },
    { browser: "webkit", status: "failed", proof_refs: ["test:webkit"] },
  ]);
  assert.equal(report.parity_met, false);
  assert.equal(report.unavailable, 1);
  assert.equal(report.failed, 1);
});
