import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createLaunchBrowser } from "../dist/src/adapters/playwright/browser-launcher.js";
import { assessBrowserWorkflowBenchmark } from "../dist/src/evaluation/browser-workflow-benchmark.js";

const browsers = ["chromium", "firefox", "webkit"];
const availability = new Map();
for (const browser of browsers) {
  try {
    const instance = await createLaunchBrowser(browser)();
    await instance.close();
    availability.set(browser, { available: true });
  } catch (error) {
    availability.set(browser, { available: false, message: error.message.split("\n")[0] });
  }
}
const proofPath = "dist/tests/adapters/playwright/playwright-execution-engine-interaction.test.js";
const observations = browsers.map((browser) => {
  const state = availability.get(browser);
  if (!state.available) return { browser, status: "unavailable", proof_refs: [], message: state.message };
  const startedAt = Date.now();
  const proof = spawnSync(process.execPath, ["--test", `--test-name-pattern=advanced iframe/upload/download/pointer/popup workflow passes on ${browser}$`, proofPath], { stdio: "inherit" });
  const duration_ms = Date.now() - startedAt;
  return proof.status === 0
    ? { browser, status: "passed", proof_refs: [`test:${proofPath}#${browser}`], duration_ms }
    : { browser, status: "failed", proof_refs: [`test:${proofPath}#${browser}`], duration_ms, message: `advanced workflow proof failed (exit ${proof.status ?? "signal"})` };
});
const report = assessBrowserWorkflowBenchmark(observations);
const outputDir = join(process.cwd(), ".qa-benchmarks");
const outputPath = join(outputDir, "browser-workflow-parity.json");
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ ...report, generated_at: new Date().toISOString() }, null, 2)}\n`, "utf8");
process.stdout.write(`Browser workflow parity: ${report.parity_met}\nPassed: ${report.passed}/3\nReport: ${outputPath}\n`);
if (!report.parity_met) process.exitCode = 1;
