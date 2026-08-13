import type { BrowserName } from "../adapters/playwright/browser-launcher.js";

export type BrowserWorkflowObservation = Readonly<{
  browser: BrowserName;
  status: "passed" | "failed" | "unavailable";
  proof_refs: readonly string[];
  message?: string;
}>;

export function assessBrowserWorkflowBenchmark(observations: readonly BrowserWorkflowObservation[]): Readonly<{
  schema_version: "1.0.0";
  required_browsers: readonly BrowserName[];
  passed: number;
  failed: number;
  unavailable: number;
  parity_met: boolean;
  blockers: readonly string[];
  observations: readonly BrowserWorkflowObservation[];
}> {
  const required: readonly BrowserName[] = ["chromium", "firefox", "webkit"];
  const blockers: string[] = [];
  const byBrowser = new Map<BrowserName, BrowserWorkflowObservation>();
  for (const item of observations) {
    if (byBrowser.has(item.browser)) blockers.push(`duplicate browser observation: ${item.browser}`);
    else byBrowser.set(item.browser, item);
  }
  for (const browser of required) {
    const item = byBrowser.get(browser);
    if (item === undefined) blockers.push(`${browser}: missing observation`);
    else if (item.status !== "passed") blockers.push(`${browser}: ${item.status}${item.message ? ` (${item.message})` : ""}`);
    else if (item.proof_refs.length === 0) blockers.push(`${browser}: passed without proof`);
  }
  return {
    schema_version: "1.0.0",
    required_browsers: required,
    passed: observations.filter((item) => item.status === "passed").length,
    failed: observations.filter((item) => item.status === "failed").length,
    unavailable: observations.filter((item) => item.status === "unavailable").length,
    parity_met: blockers.length === 0,
    blockers,
    observations,
  };
}
