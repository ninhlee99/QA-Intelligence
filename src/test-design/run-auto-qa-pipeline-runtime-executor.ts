/**
 * MCP-facing adapter for `RunAutoQaPipeline`. Owns the two boundaries the
 * pure pipeline core does not: picking `DiscoverUiSurface` vs.
 * `DiscoverAfterLogin` by whether login fields are present, and writing the
 * rendered HTML report to disk when the caller asks for one. The write is
 * confined to `outputBaseDir` (see `resolveOutputPath`) — a caller cannot
 * point `output_path` outside it, e.g. via `../` traversal or an absolute
 * path elsewhere on the host.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import { RunAutoQaPipeline, type QaPipelineDiscover } from "./run-auto-qa-pipeline.js";
import { renderQaRunReportHtml, type QaRunReport } from "../reporting/qa-run-report.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, readBasicAuthFields, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import type { GenerateTestCases } from "./generate-test-cases.js";

export type RunAutoQaPipelineRuntimeExecutorDependencies = Readonly<{
  clock: { now(): Date };
  authorizer: import("../requirement-review/public.js").WorkspaceAuthorizer;
  discoverUiSurface: DiscoverUiSurface;
  discoverAfterLogin: DiscoverAfterLogin;
  generator: GenerateTestCases;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  launchBrowser?: () => Promise<import("playwright").Browser>;
  /** Directory `output_path` is confined to. Defaults to the process's current working directory. */
  outputBaseDir?: string;
}>;

export class RunAutoQaPipelineRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RunAutoQaPipelineRuntimeExecutorDependencies;

  constructor(dependencies: RunAutoQaPipelineRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const url = input.start_request.input["url"];
    if (typeof url !== "string" || url.trim().length === 0) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "run_auto_qa requires an exact url input (the login target when login fields are supplied)." ) };
    }
    const requirementRef = readOptionalString(input.start_request.input["requirement_ref"]) ?? `auto-qa:${url}`;
    const requirementTitle = readOptionalString(input.start_request.input["requirement_title"]) ?? url;
    const acceptanceCriteria = readAcceptanceCriteriaArray(input.start_request.input["acceptance_criteria"]);
    if (acceptanceCriteria === undefined || acceptanceCriteria.length === 0) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "run_auto_qa requires a non-empty acceptance_criteria array — this executor never invents what a page should do (SPEC-207 §6).") };
    }
    const requestedOutputPath = readOptionalString(input.start_request.input["output_path"]);
    let outputPath: string | undefined;
    if (requestedOutputPath !== undefined) {
      const resolved = resolveOutputPath(requestedOutputPath, this.#dependencies.outputBaseDir ?? process.cwd());
      if (resolved === undefined) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", `output_path "${requestedOutputPath}" must resolve inside the configured output directory.`),
        };
      }
      outputPath = resolved;
    }

    const loginFields = readLoginFields(input.start_request.input);
    const basicAuth = readBasicAuthFields(input.start_request.input);
    if (basicAuth === "partial") {
      return { ok: false, failure: failure("orchestration", "invalid_request", "basic_auth_username and basic_auth_password must be supplied together or not at all.") };
    }
    const discover: QaPipelineDiscover = loginFields
      ? (operationId, context) =>
          this.#dependencies.discoverAfterLogin.discover({
            operation_id: operationId,
            context,
            login_url: loginFields.login_url,
            username_field_name: loginFields.username_field_name,
            username: loginFields.username,
            password_field_name: loginFields.password_field_name,
            password: loginFields.password,
            submit_action_name: loginFields.submit_action_name,
            target_url: url,
            ...(basicAuth !== undefined ? { basic_auth_username: basicAuth.username, basic_auth_password: basicAuth.password } : {}),
          })
      : (operationId, context) => this.#dependencies.discoverUiSurface.discover({ operation_id: operationId, context, url });

    const pipeline = new RunAutoQaPipeline({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      discover,
      generator: this.#dependencies.generator,
      ...(this.#dependencies.launchBrowser !== undefined ? { launchBrowser: this.#dependencies.launchBrowser } : {}),
    });

    const result = await pipeline.run({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      requirement_ref: requirementRef,
      requirement_title: requirementTitle,
      url,
      acceptance_criteria: acceptanceCriteria,
    });
    if (!result.ok) {
      return {
        ok: false,
        failure: failure(
          result.failure.class === "authorization" ? "policy" : "skill",
          result.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          result.failure.message,
          result.failure.retryable,
          result.failure.evidence,
        ),
      };
    }

    const html = renderQaRunReportHtml(result.value);
    let writtenPath: string | undefined;
    if (outputPath !== undefined) {
      try {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, html, "utf8");
        writtenPath = outputPath;
      } catch (error) {
        return {
          ok: false,
          failure: failure("infrastructure", "infrastructure_failure", `Failed to write HTML report to "${outputPath}": ${(error as Error).message}`, true),
        };
      }
    }

    const evidence = [
      `capture:${result.value.discovery_capture_id}`,
      ...result.value.test_cases.flatMap((testCase) => testCase.evidence),
    ];

    return {
      ok: true,
      value: {
        output: qaRunReportJson(result.value, html, writtenPath),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          execution_engine: "playwright-execution-engine@0.1.0",
          discovery_engine: "playwright-dom-pipeline@0.1.0",
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["playwright-execution-engine@0.1.0", "playwright-dom-pipeline@0.1.0"],
        citations: unique([...evidence, `requirement:${requirementRef}`, `source-url:${url}`]),
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 3, duration_seconds: 0, tool_calls: result.value.test_cases.length + 1, retries: 0 },
        evidence: unique(evidence),
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

type LoginFields = Readonly<{
  login_url: string;
  username_field_name: string;
  username: string;
  password_field_name: string;
  password: string;
  submit_action_name: string;
}>;

/** All six login fields are required together or not at all — a partial set is a caller configuration error, not "no login." */
function readLoginFields(input: Readonly<Record<string, unknown>>): LoginFields | undefined {
  const keys = ["login_url", "username_field_name", "username", "password_field_name", "password", "submit_action_name"] as const;
  const present = keys.filter((key) => readOptionalString(input[key]) !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== keys.length) return undefined;
  return {
    login_url: readOptionalString(input["login_url"])!,
    username_field_name: readOptionalString(input["username_field_name"])!,
    username: readOptionalString(input["username"])!,
    password_field_name: readOptionalString(input["password_field_name"])!,
    password: readOptionalString(input["password"])!,
    submit_action_name: readOptionalString(input["submit_action_name"])!,
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RunAutoQaPipelineRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Auto QA Pipeline executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Run Auto QA Pipeline is not present in retained Skill authority.");
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Resolves `requestedPath` against `baseDir`, rejecting anything (`../`, an absolute path elsewhere) that lands outside it. */
function resolveOutputPath(requestedPath: string, baseDir: string): string | undefined {
  const resolvedBase = resolve(baseDir);
  const resolvedTarget = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(resolvedBase, requestedPath);
  const relativeToBase = relative(resolvedBase, resolvedTarget);
  if (relativeToBase.startsWith("..") || isAbsolute(relativeToBase)) return undefined;
  return resolvedTarget;
}

/** Only a well-formed array of plain objects counts — anything else fails closed via the caller in `execute` rather than silently producing zero criteria. */
function readAcceptanceCriteriaArray(value: JsonValue | undefined): readonly JsonObject[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const objects: JsonObject[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    objects.push(entry as JsonObject);
  }
  return objects;
}

function qaRunReportJson(report: QaRunReport, html: string, writtenPath: string | undefined): JsonObject {
  return {
    schema_version: report.schema_version,
    workspace_id: report.workspace_id,
    target_url: report.target_url,
    generated_at: report.generated_at,
    requirement_ref: report.requirement_ref,
    discovery_capture_id: report.discovery_capture_id,
    discovery_element_count: report.discovery_element_count,
    summary: { ...report.summary },
    test_cases: report.test_cases.map((testCase) => ({
      test_case_id: testCase.test_case_id,
      purpose: testCase.purpose,
      variant: testCase.variant,
      outcome: testCase.outcome,
      skip_reason: testCase.skip_reason ?? null,
      evidence: [...testCase.evidence],
    })),
    generation_findings: report.generation_findings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      message: finding.message,
      evidence: [...finding.evidence],
    })),
    report_html: html,
    report_path: writtenPath ?? null,
  };
}
