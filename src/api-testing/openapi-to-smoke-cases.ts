/**
 * Convert OpenAPI 3.x (JSON) into ApiSmokeCase[] — status asserts only from
 * documented response codes. Never invents request bodies or auth tokens.
 * Optional authz negatives: unauthenticated calls expecting 401/403 when
 * the operation documents security or 401/403 responses.
 */
import type { ApiSmokeCase, HttpMethod } from "./public.js";
import type { JsonObject, JsonValue } from "../requirement-review/public.js";

export type OpenApiToSmokeOptions = Readonly<{
  /** Add one unauthenticated case per protected operation (expect 401|403). */
  include_authz_negatives?: boolean;
  /**
   * Add one wrong-role case per protected op that documents 403.
   * Caller must supply alternate_bearer at execute time — never invented here.
   */
  include_wrong_role_negatives?: boolean;
}>;

export type OpenApiToSmokeResult =
  | Readonly<{ ok: true; cases: readonly ApiSmokeCase[]; warnings: readonly string[] }>
  | Readonly<{ ok: false; message: string }>;

const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function openApiToApiSmokeCases(
  document: JsonObject,
  options: OpenApiToSmokeOptions = {},
): OpenApiToSmokeResult {
  const paths = document["paths"];
  if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
    return { ok: false, message: "OpenAPI document requires a paths object." };
  }

  const cases: ApiSmokeCase[] = [];
  const warnings: string[] = [];
  let seq = 0;
  const rootSecurity = Array.isArray(document["security"]) ? document["security"] : [];

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

      if (options.include_authz_negatives === true && looksProtected(operation, rootSecurity, responses)) {
        const authzStatus = pickAuthzStatus(responses);
        cases.push({
          id: `${opId}-unauth`,
          method,
          path: pathKey,
          auth: "none",
          expect: { status: authzStatus },
        });
      }
      if (options.include_wrong_role_negatives === true && looksProtected(operation, rootSecurity, responses)) {
        const forbidden = pickForbiddenStatus(responses);
        if (forbidden !== undefined) {
          cases.push({
            id: `${opId}-wrong-role`,
            method,
            path: pathKey,
            auth: "alternate_bearer",
            expect: { status: forbidden },
          });
        } else {
          warnings.push(
            `${method} ${pathKey}: include_wrong_role_negatives skipped — no documented 403 response.`,
          );
        }
      }
    }
  }

  if (cases.length === 0) {
    return { ok: false, message: "No executable operations found in OpenAPI paths." };
  }
  if (options.include_authz_negatives === true) {
    warnings.push(
      "Authz negatives call paths without credentials and expect 401|403 — skip if the route is intentionally public.",
    );
  }
  if (options.include_wrong_role_negatives === true) {
    warnings.push(
      "Wrong-role negatives use auth=alternate_bearer — supply alternate_bearer_token_secret_ref at execute_api_smoke (never invent tokens).",
    );
  }
  return { ok: true, cases: cases.slice(0, 120), warnings };
}

function looksProtected(
  operation: JsonObject,
  rootSecurity: readonly JsonValue[],
  responses: JsonValue | undefined,
): boolean {
  if (Array.isArray(operation["security"]) && (operation["security"] as JsonValue[]).length > 0) return true;
  if (rootSecurity.length > 0 && operation["security"] !== undefined) {
    // Explicit empty security array means optional/public in OpenAPI 3.
    if (Array.isArray(operation["security"]) && (operation["security"] as JsonValue[]).length === 0) return false;
  }
  if (rootSecurity.length > 0 && operation["security"] === undefined) return true;
  if (responses !== null && typeof responses === "object" && !Array.isArray(responses)) {
    const keys = Object.keys(responses as JsonObject);
    if (keys.includes("401") || keys.includes("403")) return true;
  }
  return false;
}

function pickAuthzStatus(responses: JsonValue | undefined): number | readonly number[] {
  if (responses !== null && typeof responses === "object" && !Array.isArray(responses)) {
    const keys = Object.keys(responses as JsonObject);
    if (keys.includes("401") && keys.includes("403")) return [401, 403];
    if (keys.includes("401")) return 401;
    if (keys.includes("403")) return 403;
  }
  return [401, 403];
}

/** Prefer documented 403 for wrong-role; undefined when OpenAPI never claims 403. */
function pickForbiddenStatus(responses: JsonValue | undefined): number | undefined {
  if (responses !== null && typeof responses === "object" && !Array.isArray(responses)) {
    const keys = Object.keys(responses as JsonObject);
    if (keys.includes("403")) return 403;
  }
  return undefined;
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
