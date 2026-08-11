/**
 * Runtime adapter for ExecuteApiSmoke (Phase 8). Mirrors BrowserTestRuntimeExecutor.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import type { ExecuteApiSmoke, ExecuteApiSmokeRequest } from "./execute-api-smoke.js";
import type { ApiSmokeCase, ApiSmokeFailure, HttpMethod } from "./public.js";

export type ApiSmokeRuntimeExecutorDependencies = Readonly<{
  skill: ExecuteApiSmoke;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

export class ApiSmokeRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ApiSmokeRuntimeExecutorDependencies;

  constructor(dependencies: ApiSmokeRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const parsed = parseRequest(input);
    if (!parsed.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", parsed.message) };
    }

    const run = await this.#dependencies.skill.run({
      ...parsed.value,
      signal: input.signal,
    });
    if (!run.ok) return { ok: false, failure: mapSkillFailure(run.failure) };

    const suite = run.value;
    const evidence = unique([...suite.evidence, `api-smoke-suite:${suite.id}`]);
    return {
      ok: true,
      value: {
        output: {
          id: suite.id,
          base_url: suite.base_url,
          outcome: suite.outcome,
          cases: suite.cases.map((item) => ({
            case_id: item.case_id,
            outcome: item.outcome,
            status: item.status ?? null,
            duration_ms: item.duration_ms,
            message: item.message,
            evidence: [...item.evidence],
            requirement_ref: item.requirement_ref ?? null,
          })),
          evidence: [...suite.evidence],
          timing: { ...suite.timing },
          engine_ref: suite.engine_ref,
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          engine: suite.engine_ref,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [suite.engine_ref],
        citations: evidence,
        uncertainty: {
          level: suite.outcome === "infrastructure_error" || suite.outcome === "indeterminate" ? "medium" : "none",
          reasons:
            suite.outcome === "infrastructure_error"
              ? ["One or more cases failed at the HTTP transport layer — not a product assertion failure."]
              : [],
        },
        policy_events: [],
        usage: {
          steps: suite.cases.length,
          duration_seconds: suite.timing.duration_seconds,
          tool_calls: suite.cases.length,
          retries: 0,
        },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function parseRequest(
  input: AgentRunExecutorInput,
): Readonly<{ ok: true; value: Omit<ExecuteApiSmokeRequest, "signal"> }> | Readonly<{ ok: false; message: string }> {
  const raw = input.start_request.input;
  const baseUrl = typeof raw["base_url"] === "string" ? raw["base_url"] : "";
  const casesRaw = raw["cases"];
  if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
    return { ok: false, message: "execute_api_smoke requires a non-empty cases array." };
  }

  const cases: ApiSmokeCase[] = [];
  for (const [index, item] of casesRaw.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, message: `cases[${index}] must be an object.` };
    }
    const obj = item as JsonObject;
    const methodRaw = typeof obj["method"] === "string" ? obj["method"].toUpperCase() : "";
    if (!METHODS.has(methodRaw as HttpMethod)) {
      return { ok: false, message: `cases[${index}].method must be one of ${[...METHODS].join(", ")}.` };
    }
    const path = typeof obj["path"] === "string" ? obj["path"] : "";
    const id = typeof obj["id"] === "string" && obj["id"].trim().length > 0 ? obj["id"] : `case-${index + 1}`;
    const expectRaw = obj["expect"];
    if (typeof expectRaw !== "object" || expectRaw === null || Array.isArray(expectRaw)) {
      return { ok: false, message: `cases[${index}].expect must be an object.` };
    }
    const expectObj = expectRaw as JsonObject;
    const expect: ApiSmokeCase["expect"] = {};
    if (typeof expectObj["status"] === "number") {
      Object.assign(expect, { status: expectObj["status"] });
    } else if (Array.isArray(expectObj["status"]) && expectObj["status"].every((v) => typeof v === "number")) {
      Object.assign(expect, { status: expectObj["status"] as number[] });
    }
    if (typeof expectObj["body_includes"] === "string") {
      Object.assign(expect, { body_includes: expectObj["body_includes"] });
    }
    const headerRaw = expectObj["header"];
    if (headerRaw !== undefined) {
      if (typeof headerRaw !== "object" || headerRaw === null || Array.isArray(headerRaw)) {
        return { ok: false, message: `cases[${index}].expect.header must be an object.` };
      }
      const headerObj = headerRaw as JsonObject;
      const name = typeof headerObj["name"] === "string" ? headerObj["name"] : "";
      if (name.trim().length === 0) {
        return { ok: false, message: `cases[${index}].expect.header.name is required.` };
      }
      Object.assign(expect, {
        header: {
          name,
          ...(typeof headerObj["equals"] === "string" ? { equals: headerObj["equals"] } : {}),
          ...(typeof headerObj["includes"] === "string" ? { includes: headerObj["includes"] } : {}),
        },
      });
    }

    const headersRaw = obj["headers"];
    let headers: Record<string, string> | undefined;
    if (headersRaw !== undefined) {
      if (typeof headersRaw !== "object" || headersRaw === null || Array.isArray(headersRaw)) {
        return { ok: false, message: `cases[${index}].headers must be an object.` };
      }
      headers = {};
      for (const [key, value] of Object.entries(headersRaw as JsonObject)) {
        if (typeof value !== "string") {
          return { ok: false, message: `cases[${index}].headers.${key} must be a string.` };
        }
        headers[key] = value;
      }
    }

    const body = obj["body"] as JsonValue | undefined;
    const requirement_ref = typeof obj["requirement_ref"] === "string" ? obj["requirement_ref"] : undefined;
    const authRaw = obj["auth"];
    let auth: ApiSmokeCase["auth"] | undefined;
    if (authRaw !== undefined) {
      if (authRaw !== "default" && authRaw !== "none" && authRaw !== "alternate_bearer") {
        return { ok: false, message: `cases[${index}].auth must be default|none|alternate_bearer.` };
      }
      auth = authRaw;
    }

    cases.push({
      id,
      method: methodRaw as HttpMethod,
      path,
      expect,
      ...(headers !== undefined ? { headers } : {}),
      ...(body !== undefined ? { body: body as string | JsonObject } : {}),
      ...(requirement_ref !== undefined ? { requirement_ref } : {}),
      ...(auth !== undefined ? { auth } : {}),
    });
  }

  const timeoutRaw = raw["timeout_ms"];
  const timeout_ms =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : undefined;

  return {
    ok: true,
    value: {
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      base_url: baseUrl,
      cases,
      ...(typeof raw["bearer_token"] === "string" && raw["bearer_token"].trim().length > 0
        ? { bearer_token: raw["bearer_token"] }
        : {}),
      ...(typeof raw["bearer_token_secret_ref"] === "string" && raw["bearer_token_secret_ref"].trim().length > 0
        ? { bearer_token_secret_ref: raw["bearer_token_secret_ref"] }
        : {}),
      ...(typeof raw["alternate_bearer_token"] === "string" && raw["alternate_bearer_token"].trim().length > 0
        ? { alternate_bearer_token: raw["alternate_bearer_token"] }
        : {}),
      ...(typeof raw["alternate_bearer_token_secret_ref"] === "string" &&
      raw["alternate_bearer_token_secret_ref"].trim().length > 0
        ? { alternate_bearer_token_secret_ref: raw["alternate_bearer_token_secret_ref"] }
        : {}),
      ...(typeof raw["basic_auth_username"] === "string" && raw["basic_auth_username"].trim().length > 0
        ? { basic_auth_username: raw["basic_auth_username"] }
        : {}),
      ...(typeof raw["basic_auth_password"] === "string" && raw["basic_auth_password"].trim().length > 0
        ? { basic_auth_password: raw["basic_auth_password"] }
        : {}),
      ...(typeof raw["basic_auth_password_secret_ref"] === "string" &&
      raw["basic_auth_password_secret_ref"].trim().length > 0
        ? { basic_auth_password_secret_ref: raw["basic_auth_password_secret_ref"] }
        : {}),
      ...(timeout_ms !== undefined ? { timeout_ms } : {}),
    },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ApiSmokeRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the API smoke executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "API smoke Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function mapSkillFailure(skillFailure: ApiSmokeFailure): AgentRunFailure {
  if (skillFailure.class === "authorization") {
    return failure("policy", "authorization_denied", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  if (skillFailure.class === "infrastructure") {
    return failure("infrastructure", "infrastructure_failure", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  return failure("orchestration", "invalid_request", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
}
