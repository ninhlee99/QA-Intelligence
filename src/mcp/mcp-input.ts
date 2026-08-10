/**
 * Shared MCP buildInput helpers — omit empty placeholders so missing args
 * fail closed in executors instead of looking like intentional empties.
 */
import type { JsonObject, JsonValue } from "../requirement-review/public.js";

/** Drop undefined/null, blank strings, empty arrays, and empty plain objects. */
export function compactMcpInput(fields: Readonly<Record<string, JsonValue | undefined>>): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (value.trim().length === 0) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "number") {
      // Sentinel 0 used by some schemas for "unset" timeouts — omit it.
      if (value === 0 && (key.endsWith("_ms") || key === "timeout_ms" || key === "perf_threshold_ms")) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "object") {
      if (Object.keys(value).length === 0) continue;
      out[key] = value;
    }
  }
  return out;
}
