import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadReleaseConfig } from "../dist/src/operations/release-config.js";
import { FileQaOperationsMonitor } from "../dist/src/operations/file-qa-operations-monitor.js";
import { verifyReleaseAttestations } from "../dist/src/operations/release-attestations.js";
import { assessCanaryRecovery, assessReleaseCandidate } from "../dist/src/operations/release-candidate-gate.js";

async function json(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; } }
const root = process.cwd(); const outputDir = join(root, ".qa-benchmarks");
const configPath = process.env["QA_PRODUCTION_CONFIG"] ?? join(root, ".qa-production/config.json");
const config = await loadReleaseConfig(configPath);
const resilience = await json(join(outputDir, "qa-resilience.json")); const parity = await json(join(outputDir, "browser-workflow-parity.json"));
let monitoringHealthy = false; let attestationsOk = false; let canaryPassed = false;
if (config.ok) {
  if (config.value.monitoring.sink === "file") monitoringHealthy = (await new FileQaOperationsMonitor({ path: join(root, config.value.monitoring.target), max_failure_rate: config.value.monitoring.max_failure_rate }).health()).healthy;
  const attestations = await json(process.env["QA_ATTESTATIONS_FILE"] ?? join(root, ".qa-production/attestations.json"));
  if (Array.isArray(attestations)) attestationsOk = (await verifyReleaseAttestations({ allowed_root: join(root, ".qa-production"), now: new Date().toISOString(), attestations })).ok;
  const canary = await json(process.env["QA_CANARY_REPORT"] ?? join(root, ".qa-production/canary.json"));
  if (canary) canaryPassed = assessCanaryRecovery({ observation: canary, max_failure_rate: config.value.monitoring.max_failure_rate, max_restoration_seconds: 300 }).passed;
}
const report = assessReleaseCandidate({ regression: process.env["QA_REGRESSION_PASSED"] === "true", resilience: resilience?.passed === true, browser_parity: parity?.parity_met === true, production_config: config.ok, monitoring_healthy: monitoringHealthy, attestations: attestationsOk, canary_recovery: canaryPassed });
await mkdir(outputDir, { recursive: true }); const path = join(outputDir, "release-candidate.json"); await writeFile(path, `${JSON.stringify({ ...report, generated_at: new Date().toISOString() }, null, 2)}\n`);
process.stdout.write(`Release candidate ready: ${report.ready}\nBlockers: ${report.blockers.join(", ") || "none"}\nReport: ${path}\n`);
if (!report.ready && !process.argv.includes("--report-only")) process.exitCode = 1;
