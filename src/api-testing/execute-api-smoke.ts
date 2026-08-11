/**
 * Assess / execute API smoke cases (Phase 8 tracer). Maps each case to a
 * SPEC-210 ExecutionOutcome; infrastructure faults never become product
 * `failed` (SPEC-210 §4). Does not invent OpenAPI, load tests, or authz matrices.
 */
import type { WorkspaceAuthorizer, WorkspaceContext } from "../requirement-review/public.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { resolveBearerToken, resolveBasicAuthPassword } from "../credentials/resolve-secret-input.js";
import type { ExecutionOutcome } from "../execution/public.js";
import { FetchHttpClient, type HttpClient } from "./http-client.js";
import type {
  ApiSmokeCase,
  ApiSmokeCaseResult,
  ApiSmokeFailure,
  ApiSmokeResult,
  ApiSmokeSuiteResult,
} from "./public.js";

export type ExecuteApiSmokeRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  base_url: string;
  cases: readonly ApiSmokeCase[];
  /** Optional Bearer token (literal or secret_ref). */
  bearer_token?: string;
  bearer_token_secret_ref?: string;
  /**
   * Wrong-role / alternate principal bearer for cases with
   * `auth: "alternate_bearer"` — never invented from OpenAPI.
   */
  alternate_bearer_token?: string;
  alternate_bearer_token_secret_ref?: string;
  basic_auth_username?: string;
  basic_auth_password?: string;
  basic_auth_password_secret_ref?: string;
  timeout_ms?: number;
  signal?: AbortSignal;
}>;

export type ExecuteApiSmokeDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  clock: { now(): Date };
  ids: { next(scope: "suite" | "case"): string };
  http?: HttpClient;
  credentials?: WorkspaceCredentialRegistry;
  engine_ref?: string;
}>;

const DEFAULT_TIMEOUT_MS = 15_000;
const ENGINE_REF = "fetch-http-client@0.1.0";

export class ExecuteApiSmoke {
  readonly #dependencies: ExecuteApiSmokeDependencies;
  readonly #http: HttpClient;
  readonly #engineRef: string;

  constructor(dependencies: ExecuteApiSmokeDependencies) {
    this.#dependencies = dependencies;
    this.#http = dependencies.http ?? new FetchHttpClient();
    this.#engineRef = dependencies.engine_ref ?? ENGINE_REF;
  }

  async run(request: ExecuteApiSmokeRequest): Promise<ApiSmokeResult> {
    const baseUrl = request.base_url.trim().replace(/\/+$/, "");
    if (baseUrl.length === 0) {
      return fail("configuration", "base_url is required.", false, ["api-smoke:missing-base-url"]);
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      return fail("configuration", "base_url must be an http(s) URL.", false, ["api-smoke:invalid-base-url"]);
    }
    if (request.cases.length === 0) {
      return fail("configuration", "At least one API smoke case is required.", false, ["api-smoke:empty-cases"]);
    }

    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "execute API smoke",
      consequence_class: "advisory",
      required_permissions: ["execution:execute"],
      resource_refs: [`workspace:${request.workspace_id}`, `api-base:${baseUrl}`],
    });
    if (!authorization.ok) {
      return fail(
        "authorization",
        authorization.failure.message,
        authorization.failure.retryable,
        [...authorization.failure.evidence],
      );
    }
    if (request.workspace_id !== request.context.workspace_id) {
      return fail("authorization", "The requested Workspace does not match the trusted Workspace context.", false, [
        `context-workspace:${request.context.workspace_id}`,
        `requested-workspace:${request.workspace_id}`,
      ]);
    }

    const authHeaders = resolveAuthHeaders(request, this.#dependencies.credentials);
    if (!authHeaders.ok) {
      return fail("configuration", authHeaders.message, false, ["api-smoke:auth-config"]);
    }
    const alternateAuth = resolveAlternateBearer(request, this.#dependencies.credentials);
    if (!alternateAuth.ok) {
      return fail("configuration", alternateAuth.message, false, ["api-smoke:alternate-auth-config"]);
    }

    const startedAt = this.#dependencies.clock.now();
    const timeoutMs =
      request.timeout_ms !== undefined && request.timeout_ms > 0 ? request.timeout_ms : DEFAULT_TIMEOUT_MS;
    const caseResults: ApiSmokeCaseResult[] = [];

    for (const smokeCase of request.cases) {
      const caseAuth = resolveCaseAuthHeaders({
        smokeCase,
        defaultHeaders: authHeaders.headers,
        alternateBearer: alternateAuth.value,
      });
      if (!caseAuth.ok) {
        caseResults.push(
          caseFail(
            smokeCase.id.trim() || this.#dependencies.ids.next("case"),
            "blocked",
            caseAuth.message,
            ["api-smoke:case-auth"],
            smokeCase.requirement_ref,
          ),
        );
        continue;
      }
      caseResults.push(
        await this.#runCase({
          baseUrl,
          smokeCase,
          authHeaders: caseAuth.headers,
          timeoutMs,
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        }),
      );
    }

    const completedAt = this.#dependencies.clock.now();
    const suiteOutcome = reconcileSuiteOutcome(caseResults);
    const evidence = unique([
      `api-base:${baseUrl}`,
      `engine:${this.#engineRef}`,
      ...authorization.value.decision_evidence,
      ...caseResults.flatMap((result) => result.evidence),
    ]);

    const suite: ApiSmokeSuiteResult = {
      id: this.#dependencies.ids.next("suite"),
      workspace_id: request.workspace_id,
      base_url: baseUrl,
      outcome: suiteOutcome,
      cases: caseResults,
      evidence,
      timing: {
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_seconds: Math.max(0, (completedAt.getTime() - startedAt.getTime()) / 1000),
      },
      engine_ref: this.#engineRef,
    };
    return { ok: true, value: suite };
  }

  async #runCase(input: Readonly<{
    baseUrl: string;
    smokeCase: ApiSmokeCase;
    authHeaders: Readonly<Record<string, string>>;
    timeoutMs: number;
    signal?: AbortSignal;
  }>): Promise<ApiSmokeCaseResult> {
    const { smokeCase } = input;
    const caseId = smokeCase.id.trim() || this.#dependencies.ids.next("case");
    if (!smokeCase.method) {
      return caseFail(caseId, "blocked", "API smoke case is missing method.", ["api-smoke:missing-method"], smokeCase.requirement_ref);
    }
    if (!hasExpectation(smokeCase.expect)) {
      return caseFail(
        caseId,
        "blocked",
        "API smoke case requires at least one expectation (status, body_includes, or header).",
        ["api-smoke:missing-expectation"],
        smokeCase.requirement_ref,
      );
    }

    const url = resolveUrl(input.baseUrl, smokeCase.path);
    if (!url.ok) {
      return caseFail(caseId, "blocked", url.message, ["api-smoke:invalid-path"], smokeCase.requirement_ref);
    }

    const headers: Record<string, string> = {
      ...input.authHeaders,
      ...(smokeCase.headers ?? {}),
    };
    let body: string | undefined;
    if (smokeCase.body !== undefined && smokeCase.method !== "GET" && smokeCase.method !== "HEAD") {
      if (typeof smokeCase.body === "string") {
        body = smokeCase.body;
      } else {
        body = JSON.stringify(smokeCase.body);
        if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
          headers["content-type"] = "application/json";
        }
      }
    }

    const response = await this.#http.request({
      url: url.value,
      method: smokeCase.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      timeout_ms: input.timeoutMs,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });

    if (!response.ok) {
      return {
        case_id: caseId,
        outcome: "infrastructure_error",
        evidence: [...response.evidence, `case:${caseId}`],
        duration_ms: response.duration_ms,
        message: response.message,
        ...(smokeCase.requirement_ref !== undefined ? { requirement_ref: smokeCase.requirement_ref } : {}),
      };
    }

    const assertion = assertExpectation(smokeCase.expect, response);
    const evidence = unique([
      `case:${caseId}`,
      `url:${url.value}`,
      `method:${smokeCase.method}`,
      `status:${response.status}`,
      ...assertion.evidence,
      ...(smokeCase.requirement_ref !== undefined ? [`requirement:${smokeCase.requirement_ref}`] : []),
    ]);
    return {
      case_id: caseId,
      outcome: assertion.ok ? "passed" : "failed",
      evidence,
      status: response.status,
      duration_ms: response.duration_ms,
      message: assertion.message,
      ...(smokeCase.requirement_ref !== undefined ? { requirement_ref: smokeCase.requirement_ref } : {}),
    };
  }
}

function resolveAuthHeaders(
  request: ExecuteApiSmokeRequest,
  registry: WorkspaceCredentialRegistry | undefined,
): Readonly<{ ok: true; headers: Readonly<Record<string, string>> }> | Readonly<{ ok: false; message: string }> {
  const headers: Record<string, string> = {};

  const bearer = resolveBearerToken({
    registry,
    workspaceId: request.workspace_id,
    ...(request.bearer_token !== undefined ? { token: request.bearer_token } : {}),
    ...(request.bearer_token_secret_ref !== undefined
      ? { token_secret_ref: request.bearer_token_secret_ref }
      : {}),
  });
  if (!bearer.ok) return bearer;
  if (bearer.value !== undefined) {
    headers.authorization = `Bearer ${bearer.value}`;
  }

  const basic = resolveBasicAuthPassword({
    registry,
    workspaceId: request.workspace_id,
    ...(request.basic_auth_username !== undefined ? { username: request.basic_auth_username } : {}),
    ...(request.basic_auth_password !== undefined ? { password: request.basic_auth_password } : {}),
    ...(request.basic_auth_password_secret_ref !== undefined
      ? { password_secret_ref: request.basic_auth_password_secret_ref }
      : {}),
  });
  if (!basic.ok) return { ok: false, message: basic.message };
  if (basic.value !== undefined) {
    if (headers.authorization !== undefined) {
      return { ok: false, message: "Supply bearer token or basic auth, not both." };
    }
    const username = request.basic_auth_username!.trim();
    headers.authorization = `Basic ${Buffer.from(`${username}:${basic.value}`, "utf8").toString("base64")}`;
  }

  return { ok: true, headers };
}

function resolveAlternateBearer(
  request: ExecuteApiSmokeRequest,
  registry: WorkspaceCredentialRegistry | undefined,
): Readonly<{ ok: true; value: string | undefined }> | Readonly<{ ok: false; message: string }> {
  const bearer = resolveBearerToken({
    registry,
    workspaceId: request.workspace_id,
    ...(request.alternate_bearer_token !== undefined ? { token: request.alternate_bearer_token } : {}),
    ...(request.alternate_bearer_token_secret_ref !== undefined
      ? { token_secret_ref: request.alternate_bearer_token_secret_ref }
      : {}),
  });
  if (!bearer.ok) {
    // resolveBearerToken treats "both omitted" as ok with undefined — only real errors fail.
    return bearer;
  }
  return { ok: true, value: bearer.value };
}

function resolveCaseAuthHeaders(input: Readonly<{
  smokeCase: ApiSmokeCase;
  defaultHeaders: Readonly<Record<string, string>>;
  alternateBearer: string | undefined;
}>):
  | Readonly<{ ok: true; headers: Readonly<Record<string, string>> }>
  | Readonly<{ ok: false; message: string }> {
  const mode = input.smokeCase.auth ?? "default";
  if (mode === "none") {
    const headers = { ...input.defaultHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") delete headers[key];
    }
    return { ok: true, headers };
  }
  if (mode === "alternate_bearer") {
    if (input.alternateBearer === undefined || input.alternateBearer.length === 0) {
      return {
        ok: false,
        message: `Case "${input.smokeCase.id}" requires alternate_bearer_token or alternate_bearer_token_secret_ref (auth=alternate_bearer).`,
      };
    }
    const headers = { ...input.defaultHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "authorization") delete headers[key];
    }
    headers.authorization = `Bearer ${input.alternateBearer}`;
    return { ok: true, headers };
  }
  return { ok: true, headers: input.defaultHeaders };
}

function resolveUrl(
  baseUrl: string,
  path: string,
): Readonly<{ ok: true; value: string }> | Readonly<{ ok: false; message: string }> {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "API smoke case path must not be empty." };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { ok: true, value: trimmed };
  }
  const suffix = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return { ok: true, value: `${baseUrl}${suffix}` };
}

function hasExpectation(expect: ApiSmokeCase["expect"]): boolean {
  return expect.status !== undefined || expect.body_includes !== undefined || expect.header !== undefined;
}

function assertExpectation(
  expect: ApiSmokeCase["expect"],
  response: Readonly<{ status: number; headers: Readonly<Record<string, string>>; body_text: string }>,
): Readonly<{ ok: boolean; message: string; evidence: readonly string[] }> {
  const evidence: string[] = [];

  if (expect.status !== undefined) {
    const allowed = Array.isArray(expect.status) ? expect.status : [expect.status];
    if (!allowed.includes(response.status)) {
      return {
        ok: false,
        message: `Expected status ${allowed.join("|")}, got ${response.status}.`,
        evidence: [`assert:status:expected:${allowed.join("|")}`, `assert:status:actual:${response.status}`],
      };
    }
    evidence.push(`assert:status:ok:${response.status}`);
  }

  if (expect.body_includes !== undefined) {
    if (!response.body_text.includes(expect.body_includes)) {
      return {
        ok: false,
        message: `Response body does not include expected substring.`,
        evidence: [`assert:body_includes:miss`, `assert:body_length:${response.body_text.length}`],
      };
    }
    evidence.push("assert:body_includes:ok");
  }

  if (expect.header !== undefined) {
    const name = expect.header.name.trim().toLowerCase();
    const actual = response.headers[name];
    if (actual === undefined) {
      return {
        ok: false,
        message: `Expected response header "${expect.header.name}" was missing.`,
        evidence: [`assert:header:missing:${name}`],
      };
    }
    if (expect.header.equals !== undefined && actual !== expect.header.equals) {
      return {
        ok: false,
        message: `Header "${expect.header.name}" expected exact value mismatch.`,
        evidence: [`assert:header:equals:miss:${name}`],
      };
    }
    if (expect.header.includes !== undefined && !actual.includes(expect.header.includes)) {
      return {
        ok: false,
        message: `Header "${expect.header.name}" does not include expected substring.`,
        evidence: [`assert:header:includes:miss:${name}`],
      };
    }
    evidence.push(`assert:header:ok:${name}`);
  }

  return { ok: true, message: "Assertions passed.", evidence };
}

function reconcileSuiteOutcome(cases: readonly ApiSmokeCaseResult[]): ExecutionOutcome {
  if (cases.some((item) => item.outcome === "infrastructure_error")) return "infrastructure_error";
  if (cases.some((item) => item.outcome === "blocked")) return "blocked";
  if (cases.some((item) => item.outcome === "failed")) return "failed";
  if (cases.every((item) => item.outcome === "passed")) return "passed";
  return "indeterminate";
}

function fail(
  failureClass: ApiSmokeFailure["class"],
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): ApiSmokeResult {
  return { ok: false, failure: { class: failureClass, message, retryable, evidence } };
}

function caseFail(
  caseId: string,
  outcome: ExecutionOutcome,
  message: string,
  evidence: readonly string[],
  requirement_ref?: string,
): ApiSmokeCaseResult {
  return {
    case_id: caseId,
    outcome,
    evidence: [...evidence, `case:${caseId}`],
    duration_ms: 0,
    message,
    ...(requirement_ref !== undefined ? { requirement_ref } : {}),
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
