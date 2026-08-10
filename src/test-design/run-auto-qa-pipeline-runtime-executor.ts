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
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import { createLaunchBrowser, isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { InMemoryWorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { resolveBasicAuthPassword, resolvePasswordInput } from "../credentials/resolve-secret-input.js";
import type { SessionMemory } from "../memory/session-memory.js";
import { FAILURE_AVOIDANCE_KEY_PREFIX } from "../memory/failure-avoidance-hints-runtime-executor.js";
import { RunAutoQaPipeline, type QaPipelineDiscover } from "./run-auto-qa-pipeline.js";
import { renderQaRunReportHtml, type QaRunReport } from "../reporting/qa-run-report.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
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
  /** Phase 6: resolves password_secret_ref / basic_auth_password_secret_ref. */
  credentials?: InMemoryWorkspaceCredentialRegistry;
  /** Phase 11: inject prior failure-avoidance hints into the report output. */
  sessionMemory?: SessionMemory;
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
    if (loginFields === "partial") {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "Login fields must be supplied together (login_url + username_field_name + username + password_field_name + password_or_password_secret_ref + submit_action_name) or not at all.",
        ),
      };
    }

    let resolvedPassword: string | undefined;
    if (loginFields !== undefined) {
      const passwordResolved = resolvePasswordInput({
        registry: this.#dependencies.credentials,
        workspaceId: input.reference.workspace_id,
        ...(loginFields.password !== undefined ? { password: loginFields.password } : {}),
        ...(loginFields.password_secret_ref !== undefined
          ? { password_secret_ref: loginFields.password_secret_ref }
          : {}),
      });
      if (!passwordResolved.ok) {
        return { ok: false, failure: failure("orchestration", "invalid_request", passwordResolved.message) };
      }
      resolvedPassword = passwordResolved.value;
    }

    const basicAuthPassword = resolveBasicAuthPassword({
      registry: this.#dependencies.credentials,
      workspaceId: input.reference.workspace_id,
      ...(readOptionalString(input.start_request.input["basic_auth_username"]) !== undefined
        ? { username: readOptionalString(input.start_request.input["basic_auth_username"])! }
        : {}),
      ...(readOptionalString(input.start_request.input["basic_auth_password"]) !== undefined
        ? { password: readOptionalString(input.start_request.input["basic_auth_password"])! }
        : {}),
      ...(readOptionalString(input.start_request.input["basic_auth_password_secret_ref"]) !== undefined
        ? { password_secret_ref: readOptionalString(input.start_request.input["basic_auth_password_secret_ref"])! }
        : {}),
    });
    if (!basicAuthPassword.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", basicAuthPassword.message) };
    }
    const basicAuthUsername = readOptionalString(input.start_request.input["basic_auth_username"]);

    let browser: BrowserName = "chromium";
    const browserRaw = readOptionalString(input.start_request.input["browser"]);
    if (browserRaw !== undefined) {
      const name = browserRaw.trim().toLowerCase();
      if (!isBrowserName(name)) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", `browser must be chromium|firefox|webkit (got "${browserRaw}").`),
        };
      }
      browser = name;
    }
    const launchBrowser =
      this.#dependencies.launchBrowser !== undefined
        ? this.#dependencies.launchBrowser
        : createLaunchBrowser(browser);

    const discover: QaPipelineDiscover = loginFields !== undefined && resolvedPassword !== undefined
      ? (operationId, context) =>
          this.#dependencies.discoverAfterLogin.discover({
            operation_id: operationId,
            context,
            login_url: loginFields.login_url,
            username_field_name: loginFields.username_field_name,
            username: loginFields.username,
            password_field_name: loginFields.password_field_name,
            password: resolvedPassword,
            submit_action_name: loginFields.submit_action_name,
            target_url: url,
            ...(basicAuthUsername !== undefined && basicAuthPassword.value !== undefined
              ? { basic_auth_username: basicAuthUsername, basic_auth_password: basicAuthPassword.value }
              : {}),
          })
      : (operationId, context) =>
          this.#dependencies.discoverUiSurface.discover({
            operation_id: operationId,
            context,
            url,
            browser,
          });

    // Screenshots are always written to disk for real, even with no
    // output_path (JSON-only mode) — a real file is genuinely more useful
    // than silently dropping failure evidence, even though a JSON-only
    // caller has no direct MCP mechanism to fetch it back. When
    // output_path IS supplied, screenshots live in a sibling directory next
    // to the report HTML file (both already confined inside outputBaseDir
    // by resolveOutputPath below); otherwise they live under a fixed,
    // non-attacker-controlled default location (operation_id is opaque and
    // server-generated — see AgentRuntimeToolRegistry — never raw MCP
    // input, so no additional path confinement is needed here).
    const screenshotDir =
      outputPath !== undefined
        ? join(dirname(outputPath), ".qa-screenshots", input.execution.operation_id)
        : join(this.#dependencies.outputBaseDir ?? process.cwd(), ".qa-screenshots", input.execution.operation_id);
    let screenshotDirReady = true;
    try {
      await mkdir(screenshotDir, { recursive: true });
    } catch {
      // Best-effort: screenshot capture is optional evidence, never a
      // reason to fail the whole run_auto_qa call.
      screenshotDirReady = false;
    }

    const pipeline = new RunAutoQaPipeline({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      discover,
      generator: this.#dependencies.generator,
      launchBrowser,
      ...(screenshotDirReady ? { screenshotDir } : {}),
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

    const priorHints =
      this.#dependencies.sessionMemory?.list(input.reference.workspace_id, FAILURE_AVOIDANCE_KEY_PREFIX) ?? [];

    const evidence = [
      `capture:${result.value.discovery_capture_id}`,
      ...result.value.test_cases.flatMap((testCase) => testCase.evidence),
    ];

    const reportJson = qaRunReportJson(result.value, html, writtenPath);
    return {
      ok: true,
      value: {
        output: {
          ...reportJson,
          prior_failure_avoidance_hints: priorHints.map((entry) => ({
            key: entry.key,
            causal_mistake: entry.value,
            source_ref: entry.source_ref,
            retained_at: entry.retained_at,
            expires_at: entry.expires_at,
          })),
        },
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
        citations: unique([
          ...evidence,
          `requirement:${requirementRef}`,
          `source-url:${url}`,
          ...priorHints.map((h) => h.source_ref),
        ]),
        uncertainty: {
          level: priorHints.length > 0 ? "low" : "none",
          reasons:
            priorHints.length > 0
              ? [`${priorHints.length} prior failure-avoidance hint(s) from Session Memory — advisory, not confirmed cause.`]
              : [],
        },
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
  password?: string;
  password_secret_ref?: string;
  submit_action_name: string;
}>;

/**
 * Login sextet: five always-required string fields + (password XOR
 * password_secret_ref). Partial sets are caller configuration errors.
 */
function readLoginFields(input: Readonly<Record<string, unknown>>): LoginFields | "partial" | undefined {
  const required = ["login_url", "username_field_name", "username", "password_field_name", "submit_action_name"] as const;
  const presentRequired = required.filter((key) => readOptionalString(input[key]) !== undefined);
  const password = readOptionalString(input["password"]);
  const passwordSecretRef = readOptionalString(input["password_secret_ref"]);
  const hasAnyLogin = presentRequired.length > 0 || password !== undefined || passwordSecretRef !== undefined;
  if (!hasAnyLogin) return undefined;
  if (presentRequired.length !== required.length) return "partial";
  if ((password === undefined && passwordSecretRef === undefined) || (password !== undefined && passwordSecretRef !== undefined)) {
    return "partial";
  }
  return {
    login_url: readOptionalString(input["login_url"])!,
    username_field_name: readOptionalString(input["username_field_name"])!,
    username: readOptionalString(input["username"])!,
    password_field_name: readOptionalString(input["password_field_name"])!,
    ...(password !== undefined ? { password } : {}),
    ...(passwordSecretRef !== undefined ? { password_secret_ref: passwordSecretRef } : {}),
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
    release_recommendation: report.release_recommendation,
    release_recommendation_rationale: report.release_recommendation_rationale,
    variant_coverage: report.variant_coverage.map((row) => ({ ...row })),
    residual_risks: report.residual_risks.map((risk) => ({
      id: risk.id,
      severity: risk.severity,
      message: risk.message,
      evidence: [...risk.evidence],
    })),
    draft_defects: report.draft_defects.map((defect) => ({
      id: defect.id,
      version: defect.version,
      status: defect.status,
      summary: defect.summary,
      observed_behavior: defect.observed_behavior,
      expected_behavior: defect.expected_behavior,
      expected_behavior_authority: defect.expected_behavior_authority,
      affected_requirement_refs: [...(defect.affected_requirement_refs ?? [])],
      workspace_scope: defect.workspace_scope,
      environment_ref: defect.environment_ref,
      reproduction_conditions: [...defect.reproduction_conditions],
      evidence: [...defect.evidence],
      severity: defect.severity,
      severity_rationale: defect.severity_rationale,
      priority: defect.priority,
      classification: defect.classification,
      suspected_cause: defect.suspected_cause ?? null,
      confirmed_cause: defect.confirmed_cause ?? null,
      owner: defect.owner,
      related_execution_refs: [...(defect.related_execution_refs ?? [])],
      related_test_refs: [...(defect.related_test_refs ?? [])],
    })),
    accessibility_smoke: {
      schema_version: report.accessibility_smoke.schema_version,
      source_url: report.accessibility_smoke.source_url ?? null,
      element_count: report.accessibility_smoke.element_count,
      summary: { ...report.accessibility_smoke.summary },
      findings: report.accessibility_smoke.findings.map((finding) => ({
        id: finding.id,
        category: finding.category,
        severity: finding.severity,
        message: finding.message,
        evidence: [...finding.evidence],
        element_ids: [...finding.element_ids],
      })),
      limitations: [...report.accessibility_smoke.limitations],
    },
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
