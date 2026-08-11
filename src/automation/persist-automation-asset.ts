/**
 * Persist AutomationAsset stubs under `.qa-automation-assets/<workspace>/`
 * so create_automation_asset survives MCP restart and can bind to
 * `run_regression_suite` via execution_interface + optional suite id.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AutomationAsset } from "./public.js";

export type PersistAutomationAssetInput = Readonly<{
  rootDir: string;
  workspace_id: string;
  asset: AutomationAsset;
}>;

export type PersistAutomationAssetResult = Readonly<{
  ok: true;
  persisted_path: string;
}>;

export function persistAutomationAsset(input: PersistAutomationAssetInput): PersistAutomationAssetResult {
  const safeWs = input.workspace_id.replace(/[^A-Za-z0-9._-]/g, "_");
  const safeId = input.asset.id.replace(/[^A-Za-z0-9._-]/g, "_");
  const dir = join(input.rootDir, safeWs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${safeId}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        ...input.asset,
        workspace_id: input.workspace_id,
        persisted_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
  return { ok: true, persisted_path: path };
}

/** Default execution_interface when caller omits one — points at MCP regression runner. */
export const DEFAULT_REGRESSION_EXECUTION_INTERFACE = "mcp:run_regression_suite";
