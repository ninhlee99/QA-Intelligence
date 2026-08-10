/**
 * Convert OpenAPI 3.x (JSON) into ApiSmokeCase[] — status asserts only from
 * documented response codes. Never invents request bodies or auth.
 */
import type { ApiSmokeCase, HttpMethod } from "./public.js";
import type { JsonObject, JsonValue } from "../requirement-review/public.js";

export type OpenApiToSmokeResult =
  | Readonly<{ ok: true; cases: readonly ApiSmokeCase[]; warnings: readonly string[] }>
  | Readonly<{ ok: false; message: string }>;

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function openApiToApiSmokeCases(document: JsonObject): OpenApiToSmokeResult {
  const paths = document["paths"];
  if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
    return { ok: false, message: "OpenAPI document requires a paths object." };
  }

  const cases: ApiSmokeCase[] = [];
  const warnings: string[] = [];
  let seq = 0;

  for (const [pathKey, pathItem] of Object.entries(paths as JsonObject)) {
    if (pathItem === null || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    const item = pathItem as JsonObject;
    for (const method of METHODS) {
      const op = item[method.toLowerCase()];
      if (op === null || typeof op !== "object" || Array.isArray(op)) continue;
      const operation = op as JsonObject;
      const responses = operation["responses"];
      const status = pickExpectedStatus(responses);
      if (status === undefined) {
        warnings.push(`${method} ${pathKey}: no numeric response status — skipped`);
        continue;
      }
      if (pathKey.includes("{")) {
        warnings.push(`${method} ${pathKey}: path params present — case uses literal braces (caller must substitute).`);
      }
      seq += 1;
      const opId =
        typeof operation["operationId"] === "string" && operation["operationId"].trim()
          ? operation["operationId"].trim()
          : `openapi-${seq}`;
      cases.push({
        id: opId,
        method,
        path: pathKey,
        expect: { status },
      });
    }
  }

  if (cases.length === 0) {
    return { ok: false, message: "No executable operations found in OpenAPI paths." };
  }
  return { ok: true, cases: cases.slice(0, 80), warnings };
}

function pickExpectedStatus(responses: JsonValue | undefined): number | undefined {
  if (responses === null || typeof responses !== "object" || Array.isArray(responses)) return undefined;
  const keys = Object.keys(responses as JsonObject);
  const numeric = keys
    .map((key) => Number(key))
    .filter((n) => Number.isInteger(n) && n >= 100 && n < 600)
    .sort((a, b) => a - b);
  if (numeric.includes(200)) return 200;
  if (numeric.includes(201)) return 201;
  if (numeric.includes(204)) return 204;
  return numeric[0];
}
