import assert from "node:assert/strict";
import test from "node:test";
import { assessQaResilienceBenchmark } from "../../src/evaluation/qa-resilience-benchmark.js";

test("resilience benchmark fails on a chaos probe or context payload budget", () => {
  const report = assessQaResilienceBenchmark({ probes: [{ id: "worker-loss", passed: false, duration_ms: 1, evidence_ref: "test:x" }], context_payload_bytes: 101, max_context_payload_bytes: 100 });
  assert.equal(report.passed, false);
  assert.deepEqual(report.blockers.map((item) => item.split(":")[0]), ["worker-loss", "context-payload"]);
  assert.equal(report.token_proxy.estimated_tokens, 26);
});
