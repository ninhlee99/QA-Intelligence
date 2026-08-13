import { readFile } from "node:fs/promises";

export type ReleaseConfig = Readonly<{
  schema_version: "1.0.0";
  environment: "production";
  monitoring: Readonly<{ sink: "file" | "https"; target: string; max_failure_rate: number }>;
  kill_switch: Readonly<{ environment_key: "QA_INTELLIGENCE_EXECUTION_DISABLED" }>;
  incident_owner: string;
  rollback_plan_ref: string;
  security_approval_ref: string;
  canary_percent: number;
}>;

export async function loadReleaseConfig(path: string): Promise<Readonly<{ ok: true; value: ReleaseConfig }> | Readonly<{ ok: false; failure: { reasons: readonly string[] } }>> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path, "utf8")); } catch { return { ok: false, failure: { reasons: ["configuration is not readable JSON"] } }; }
  const value = isObject(raw) ? raw : {};
  const monitoring = isObject(value["monitoring"]) ? value["monitoring"] : {};
  const killSwitch = isObject(value["kill_switch"]) ? value["kill_switch"] : {};
  const reasons: string[] = [];
  if (value["schema_version"] !== "1.0.0") reasons.push("schema_version must be 1.0.0");
  if (value["environment"] !== "production") reasons.push("environment must be production");
  if (monitoring["sink"] !== "file" && monitoring["sink"] !== "https") reasons.push("monitoring.sink must be file or https");
  const target = text(monitoring["target"]);
  if (!target) reasons.push("monitoring.target is required");
  if (/^https?:\/\/[^/]*@/i.test(target)) reasons.push("monitoring.target must not contain inline credentials");
  const rate = monitoring["max_failure_rate"];
  if (typeof rate !== "number" || rate < 0 || rate > 1) reasons.push("monitoring.max_failure_rate must be between 0 and 1");
  if (killSwitch["environment_key"] !== "QA_INTELLIGENCE_EXECUTION_DISABLED") reasons.push("kill_switch.environment_key must be QA_INTELLIGENCE_EXECUTION_DISABLED");
  for (const key of ["incident_owner", "rollback_plan_ref", "security_approval_ref"] as const) if (!text(value[key])) reasons.push(`${key} is required`);
  const canary = value["canary_percent"];
  if (typeof canary !== "number" || !Number.isInteger(canary) || canary < 1 || canary > 25) reasons.push("canary_percent must be an integer from 1 to 25");
  if (reasons.length > 0) return { ok: false, failure: { reasons } };
  return { ok: true, value: raw as ReleaseConfig };
}

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
