import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assessQaQcWorkBenchmark, QA_QC_WORK_CATALOG } from "../dist/src/evaluation/qa-qc-work-benchmark.js";

const proofSuites = [
  "dist/tests/requirement-review/assess-requirement-quality.test.js",
  "dist/tests/test-strategy/assess-test-strategy-quality.test.js",
  "dist/tests/integration/generate-test-cases-runtime.test.js",
  "dist/tests/test-data/assess-test-dataset-quality.test.js",
  "dist/tests/adapters/playwright/playwright-execution-engine-interaction.test.js",
  "dist/tests/reporting/evidence-capture-status.test.js",
  "dist/tests/reporting/testcase-result-export.test.js",
  "dist/tests/bug-analysis/draft-defects-from-qa-run.test.js",
  "dist/tests/test-design/file-backed-regression-suite-registry.test.js",
  "dist/tests/test-strategy/execute-exploratory-session.test.js",
  "dist/tests/api-testing/execute-api-smoke.test.js",
  "dist/tests/depth-smokes/run-depth-smokes.test.js",
  "dist/tests/reporting/flake-taxonomy.test.js",
  "dist/tests/reporting/expert-checklist.test.js",
];
const taskProofs = {
  "qa-requirement-review": [proofSuites[0]],
  "qa-risk-strategy": [proofSuites[1]],
  "qa-testcase-design": [proofSuites[2]],
  "qa-data-readiness": [proofSuites[3]],
  "qc-browser-execution": [proofSuites[4]],
  "qc-evidence": [proofSuites[4], proofSuites[5]],
  "qc-result-artifacts": [proofSuites[6]],
  "qc-defect-triage": [proofSuites[7]],
  "qc-regression-retest": [proofSuites[8]],
  "qc-exploratory": [proofSuites[9]],
  "qc-api-authz": [proofSuites[10]],
  "qc-nonfunctional-smoke": [proofSuites[11]],
  "qc-flake-learning": [proofSuites[12]],
  "governed-release-advice": [proofSuites[13]],
};

const declaredStatus = {
  "qa-requirement-review": "automated", "qa-risk-strategy": "assisted", "qa-testcase-design": "automated", "qa-data-readiness": "assisted",
  "qc-browser-execution": "automated", "qc-evidence": "automated", "qc-result-artifacts": "automated", "qc-defect-triage": "automated",
  "qc-regression-retest": "automated", "qc-exploratory": "assisted", "qc-api-authz": "automated", "qc-nonfunctional-smoke": "automated",
  "qc-flake-learning": "automated", "governed-release-advice": "automated", "human-release-accountability": "human_only", "human-certification": "human_only",
};
const proofResults = new Map();
for (const proofPath of new Set(Object.values(taskProofs).flat())) {
  const proof = spawnSync(process.execPath, ["--test", proofPath], { encoding: "utf8", stdio: "inherit" });
  proofResults.set(proofPath, proof.status === 0);
}
const report = assessQaQcWorkBenchmark({
  observations: QA_QC_WORK_CATALOG.map((task) => ({
    task_id: task.id,
    status: declaredStatus[task.id] ?? "human_only",
    proof_refs: (taskProofs[task.id] ?? []).map((path) => `test:${path}`),
    verified: declaredStatus[task.id] !== "human_only" && (taskProofs[task.id] ?? []).length > 0 && (taskProofs[task.id] ?? []).every((path) => proofResults.get(path) === true),
  })),
});
const outputDir = join(process.cwd(), ".qa-benchmarks");
const outputPath = join(outputDir, "qa-qc-work-coverage.json");
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ ...report, generated_at: new Date().toISOString(), proof_suites: proofSuites, proof_results: Object.fromEntries(proofResults) }, null, 2)}\n`, "utf8");
process.stdout.write(`QA/QC supported workload: ${report.supported_percent}%\nTarget met: ${report.target_met}\nReport: ${outputPath}\n`);
if (!report.target_met) process.exitCode = 1;
