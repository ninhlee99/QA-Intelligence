import assert from "node:assert/strict";
import test from "node:test";

import { assessQaQcWorkBenchmark, QA_QC_WORK_CATALOG } from "../../src/evaluation/qa-qc-work-benchmark.js";

test("expert benchmark reaches the 90% support target only with verified proof for every supported task", () => {
  const report = assessQaQcWorkBenchmark({
    observations: QA_QC_WORK_CATALOG.map((task) => ({
      task_id: task.id,
      status: task.default_status,
      proof_refs: task.default_status === "human_only" ? [] : [`test:${task.id}`],
      verified: task.default_status !== "human_only",
    })),
  });

  assert.equal(report.total_weight, 100);
  assert.equal(report.supported_weight, 90);
  assert.equal(report.automated_weight + report.assisted_weight, 90);
  assert.equal(report.human_only_weight, 10);
  assert.equal(report.target_met, true);
  assert.deepEqual(report.blockers, []);
});

test("missing proof for a critical browser capability blocks the 90% claim", () => {
  const report = assessQaQcWorkBenchmark({
    observations: QA_QC_WORK_CATALOG.map((task) => ({
      task_id: task.id,
      status: task.default_status,
      proof_refs: task.id === "qc-browser-execution" || task.default_status === "human_only" ? [] : [`test:${task.id}`],
      verified: task.id !== "qc-browser-execution" && task.default_status !== "human_only",
    })),
  });

  assert.equal(report.target_met, false);
  assert.ok(report.supported_weight < 90);
  assert.ok(report.blockers.some((blocker) => blocker.includes("qc-browser-execution")));
});

test("unknown, duplicate, or status-inflated observations fail closed", () => {
  const report = assessQaQcWorkBenchmark({
    observations: [
      { task_id: "qa-requirement-review", status: "automated", proof_refs: ["proof"], verified: true },
      { task_id: "qa-requirement-review", status: "automated", proof_refs: ["proof-2"], verified: true },
      { task_id: "unknown", status: "automated", proof_refs: ["proof"], verified: true },
      { task_id: "human-release-accountability", status: "automated", proof_refs: ["proof"], verified: true },
    ],
  });

  assert.equal(report.target_met, false);
  assert.ok(report.blockers.some((blocker) => blocker.includes("duplicate")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("unknown")));
  assert.ok(report.blockers.some((blocker) => blocker.includes("cannot be widened")));
});
