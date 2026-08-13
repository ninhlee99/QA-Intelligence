import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildResponsiveMatrix } from "../dist/src/deep-testing/responsive-matrix.js";
import { assessApiContractDrift } from "../dist/src/deep-testing/api-contract-drift.js";
import { assessPerformanceBudget } from "../dist/src/deep-testing/performance-budget.js";
import { generateStateJourneys } from "../dist/src/deep-testing/state-model-journeys.js";
import { assessMutationAdequacy } from "../dist/src/deep-testing/mutation-adequacy.js";

const transitions = Array.from({ length: 1000 }, (_, index) => ({ from: `s${index}`, action: `a${index}`, to: `s${index + 1}` }));
const started = performance.now(); const state = generateStateJourneys({ initial_state: "s0", transitions, max_steps: 1000 }); const duration = performance.now() - started;
const probes = {
  responsive_matrix: buildResponsiveMatrix(["chromium", "firefox", "webkit"]).length === 9,
  api_breaking_drift: assessApiContractDrift({ baseline: { "/x": { get: { response_statuses: ["200"] } } }, candidate: {} }).breaking,
  missing_performance_measurement: !assessPerformanceBudget({ observations: [], budgets: { lcp: 2500 } }).passed,
  state_transition_coverage: state.uncovered_transitions.length === 0 && state.journeys.length === 1000 && duration <= 1000,
  critical_mutant_gate: !assessMutationAdequacy({ mutants: [{ id: "critical", critical: true, outcome: "survived" }], minimum_score: 0 }).passed,
};
const blockers = Object.entries(probes).filter(([, passed]) => !passed).map(([id]) => id); const report = { passed: blockers.length === 0, blockers, probes, state_model_duration_ms: duration, generated_at: new Date().toISOString() };
const outputDir = join(process.cwd(), ".qa-benchmarks"); await mkdir(outputDir, { recursive: true }); const path = join(outputDir, "deep-testing.json"); await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Deep testing benchmark: ${report.passed}\nProbes: ${Object.keys(probes).length - blockers.length}/${Object.keys(probes).length}\nReport: ${path}\n`); if (!report.passed) process.exitCode = 1;
