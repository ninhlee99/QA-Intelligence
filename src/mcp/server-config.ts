import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { PRODUCTION_TOOL_PROFILES, type ProductionToolProfile } from "./tool-profile.js";

export type ServerConfig = Readonly<{
  workspaceId: string;
  dataDir: string;
  toolProfile: ProductionToolProfile;
  deadlineSeconds: number;
}>;

const WORKSPACE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const workspaceId = required(env, "QA_INTELLIGENCE_WORKSPACE_ID");
  if (!WORKSPACE_PATTERN.test(workspaceId)) {
    throw new Error("QA_INTELLIGENCE_WORKSPACE_ID must be 3-64 safe identifier characters");
  }

  const configuredDataDir = env["QA_INTELLIGENCE_DATA_DIR"]?.trim();
  if (configuredDataDir !== undefined && configuredDataDir.length > 0 && !isAbsolute(configuredDataDir)) {
    throw new Error("QA_INTELLIGENCE_DATA_DIR must be an absolute path");
  }
  const dataDir = configuredDataDir ?? join(defaultStateRoot(env), "qa-intelligence", workspaceId);

  const rawProfile = env["QA_INTELLIGENCE_TOOL_PROFILE"]?.trim() ?? "expert";
  if (!PRODUCTION_TOOL_PROFILES.includes(rawProfile as ProductionToolProfile)) {
    throw new Error(`QA_INTELLIGENCE_TOOL_PROFILE must be one of: ${PRODUCTION_TOOL_PROFILES.join(", ")}`);
  }

  const deadlineSeconds = positiveInteger(env["QA_INTELLIGENCE_DEADLINE_SECONDS"] ?? "180", "QA_INTELLIGENCE_DEADLINE_SECONDS");
  if (deadlineSeconds > 3_600) throw new Error("QA_INTELLIGENCE_DEADLINE_SECONDS must be <= 3600");

  return { workspaceId, dataDir: resolve(dataDir), toolProfile: rawProfile as ProductionToolProfile, deadlineSeconds };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(raw: string, name: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function defaultStateRoot(env: NodeJS.ProcessEnv): string {
  const xdg = env["XDG_STATE_HOME"]?.trim();
  return xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "state");
}
