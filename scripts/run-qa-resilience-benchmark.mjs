import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { assessQaResilienceBenchmark } from "../dist/src/evaluation/qa-resilience-benchmark.js";

const suites = [
  ["evidence-root-and-legal-hold", "dist/tests/reporting/evidence-retention.test.js"],
  ["retry-and-checkpoint-recovery", "dist/tests/recovery/qa-retry-and-checkpoint.test.js"],
  ["semantic-recovery-and-redaction", "dist/tests/adapters/playwright/playwright-execution-engine-interaction.test.js", "semantic recovery|PII-like"],
  ["operations-kill-switch", "dist/tests/observability/qa-operations.test.js"],
];
const probes = suites.map(([id, path, pattern]) => {
  const start = performance.now();
  const args = ["--test", ...(pattern ? [`--test-name-pattern=${pattern}`] : []), path];
  const run = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { id, passed: run.status === 0, duration_ms: Math.round(performance.now() - start), evidence_ref: `test:${path}`, ...(run.status === 0 ? {} : { message: (run.stderr || run.stdout).slice(0, 500) }) };
});
const contextFiles = ["hosts/codex/skills/test/SKILL.md", "hosts/codex/skills/qa/SKILL.md", "hosts/codex/skills/qc/SKILL.md", "hosts/codex/skills/testcase/SKILL.md"];
let contextPayloadBytes = 0;
for (const path of contextFiles) contextPayloadBytes += (await stat(path)).size;
const report = assessQaResilienceBenchmark({ probes, context_payload_bytes: contextPayloadBytes, max_context_payload_bytes: 32_000 });
const outputDir = join(process.cwd(), ".qa-benchmarks");
const outputPath = join(outputDir, "qa-resilience.json");
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ ...report, probes, context_payload_bytes: contextPayloadBytes, context_files: contextFiles, generated_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
process.stdout.write(`QA resilience: ${report.passed}\nProbes: ${report.probes_passed}/${report.probes_total}\nToken proxy: ${report.token_proxy.estimated_tokens}\nReport: ${outputPath}\n`);
if (!report.passed) process.exitCode = 1;
