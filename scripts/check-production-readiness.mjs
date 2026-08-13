import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessQaProductionReadiness } from "../dist/src/observability/qa-operations.js";

async function json(path) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; } }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
const root = process.cwd();
const resilience = await json(join(root, ".qa-benchmarks/qa-resilience.json"));
const parity = await json(join(root, ".qa-benchmarks/browser-workflow-parity.json"));
const signals = {
  security: process.env["QA_SECURITY_REVIEW_APPROVED"] === "true",
  evidence_lifecycle: resilience?.passed === true && await exists(join(root, "dist/src/reporting/evidence-lifecycle-runtime-executor.js")),
  resumable_recovery: resilience?.passed === true && await exists(join(root, "dist/src/recovery/file-campaign-checkpoints.js")),
  chaos_benchmark: resilience?.passed === true,
  browser_parity: parity?.parity_met === true,
  monitoring: Boolean(process.env["QA_MONITORING_SINK"]) && await exists(join(root, "dist/src/observability/qa-operations.js")),
  kill_switch: Object.hasOwn(process.env, "QA_INTELLIGENCE_EXECUTION_DISABLED"),
  rollback: Boolean(process.env["QA_ROLLBACK_PLAN"]),
  incident_owner: Boolean(process.env["QA_INCIDENT_OWNER"]),
  token_budget: resilience?.token_proxy?.within_budget === true,
};
const report = assessQaProductionReadiness(signals);
const outputPath = join(root, ".qa-benchmarks/production-readiness.json");
await mkdir(join(root, ".qa-benchmarks"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ ...report, signals, generated_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
process.stdout.write(`Production ready: ${report.ready}\nBlockers: ${report.blockers.join(", ") || "none"}\nReport: ${outputPath}\n`);
if (!report.ready && !process.argv.includes("--report-only")) process.exitCode = 1;
