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
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { resolveBasicAuthPassword, resolvePasswordInput } from "../credentials/resolve-secret-input.js";
import type { SessionMemory } from "../memory/session-memory.js";
import { FAILURE_AVOIDANCE_KEY_PREFIX } from "../memory/failure-avoidance-hints-runtime-executor.js";
import { RunAutoQaPipeline, type QaPipelineDiscover } from "./run-auto-qa-pipeline.js";
import { expertChecklistFromQaRunReport, type DomainPackGateInput, type ExpertChecklistFromReportOptions } from "../reporting/expert-checklist.js";
import { assessDomainPackGate } from "../domain-pack/assess-domain-pack-gate.js";
import { deriveFlakeTaxonomy, flakeTaxonomyJson } from "../reporting/flake-taxonomy.js";
import {
  buildExpertObservations,
  detectExpertRiskSignals,
  deriveExpertMandateBlockers,
  hookCoverageFromExtensions,
} from "../reporting/expert-risk-signals.js";
import { renderQaRunReportHtml, type QaRunReport } from "../reporting/qa-run-report.js";
import type { FileBackedRegressionSuiteRegistry } from "./file-backed-regression-suite-registry.js";
import type { InMemoryRegressionSuiteRegistry, RegressionCase } from "./regression-suite-registry.js";
import type { GenerateTestCases } from "./generate-test-cases.js";
import { runExpertHooks } from "./run-auto-qa-expert-hooks.js";
import type { CandidateRepository } from "../candidate-repository/public.js";
import type { DiscoverUiWorkflow } from "../discovery/discover-ui-workflow.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

type RegressionSuiteRegistry = InMemoryRegressionSuiteRegistry | FileBackedRegressionSuiteRegistry;

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
  credentials?: WorkspaceCredentialRegistry;
  /** Phase 11: inject prior failure-avoidance hints into the report output. */
  sessionMemory?: SessionMemory;
  /** When set, serious runs auto-register a durable regression suite (Expert loop). */
  regressionRegistry?: RegressionSuiteRegistry;
  /** Optional: enable include_workflow_journeys hook. */
  discoverUiWorkflow?: DiscoverUiWorkflow;
  /** P5: surface learning candidates alongside failure-avoidance hints. */
  candidateRepository?: CandidateRepository;
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
    const traceDir =
      outputPath !== undefined
        ? join(dirname(outputPath), ".qa-traces", input.execution.operation_id)
        : join(this.#dependencies.outputBaseDir ?? process.cwd(), ".qa-traces", input.execution.operation_id);
    let screenshotDirReady = true;
    let traceDirReady = true;
    try {
      await mkdir(screenshotDir, { recursive: true });
    } catch {
      // Best-effort: screenshot capture is optional evidence, never a
      // reason to fail the whole run_auto_qa call.
      screenshotDirReady = false;
    }
    try {
      await mkdir(traceDir, { recursive: true });
    } catch {
      traceDirReady = false;
    }

    const pipeline = new RunAutoQaPipeline({
      clock: this.#dependencies.clock,
      authorizer: this.#dependencies.authorizer,
      discover,
      generator: this.#dependencies.generator,
      launchBrowser,
      ...(screenshotDirReady ? { screenshotDir } : {}),
      ...(traceDirReady ? { traceDir } : {}),
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

    const report = result.value.report;
    const flakeTaxonomy = deriveFlakeTaxonomy(report);

    const hooks = await runExpertHooks({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      target_url: url.trim(),
      requirement_ref: requirementRef,
      raw_input: input.start_request.input,
      ...(loginFields !== undefined
        ? {
            login_a: {
              login_url: loginFields.login_url,
              username_field_name: loginFields.username_field_name,
              username: loginFields.username,
              password_field_name: loginFields.password_field_name,
              submit_action_name: loginFields.submit_action_name,
              ...(loginFields.password !== undefined ? { password: loginFields.password } : {}),
              ...(loginFields.password_secret_ref !== undefined
                ? { password_secret_ref: loginFields.password_secret_ref }
                : {}),
            },
          }
        : {}),
      discoverAfterLogin: this.#dependencies.discoverAfterLogin,
      ...(this.#dependencies.discoverUiWorkflow !== undefined
        ? { discoverUiWorkflow: this.#dependencies.discoverUiWorkflow }
        : {}),
      ...(this.#dependencies.credentials !== undefined
        ? { credentials: this.#dependencies.credentials }
        : {}),
    });

    const suiteCases: RegressionCase[] = [
      ...result.value.regression_browser_cases,
      ...hooks.extra_regression_cases,
    ];

    const skipAutoSuite = input.start_request.input["auto_register_suite"] === false;
    let autoSuite:
      | Readonly<{ suite_id: string; persisted_path?: string; case_count: number; label: string }>
      | Readonly<{ skipped: true; reason: string }>
      | undefined;
    if (!skipAutoSuite && this.#dependencies.regressionRegistry !== undefined) {
      if (suiteCases.length === 0) {
        autoSuite = { skipped: true, reason: "no_executable_cases_for_suite" };
      } else {
        const label =
          readOptionalString(input.start_request.input["suite_label"]) ??
          `auto-qa:${requirementTitle}`.slice(0, 120);
        const registered = this.#dependencies.regressionRegistry.register({
          workspace_id: input.reference.workspace_id,
          label,
          cases: suiteCases,
          base_url: url.trim(),
        });
        if (registered.ok) {
          autoSuite = {
            suite_id: registered.suite.id,
            case_count: registered.suite.cases.length,
            label: registered.suite.label,
            ...("persisted_path" in registered && typeof registered.persisted_path === "string"
              ? { persisted_path: registered.persisted_path }
              : {}),
          };
        } else {
          autoSuite = { skipped: true, reason: registered.message };
        }
      }
    } else if (skipAutoSuite) {
      autoSuite = { skipped: true, reason: "auto_register_suite=false" };
    } else {
      autoSuite = { skipped: true, reason: "regression_registry_not_configured" };
    }

    const domainPack = assessDomainPackFromInput(input.start_request.input);
    const requestContext = readOptionalString(input.start_request.input["request_context"]);
    const riskSignals = detectExpertRiskSignals({
      ...(requestContext !== undefined ? { request_context: requestContext } : {}),
      requirement_title: requirementTitle,
      acceptance_criteria: acceptanceCriteria,
      has_login_fields: loginFields !== undefined,
    });
    const hookCoverage = hookCoverageFromExtensions(
      hooks.extensions as JsonObject,
      acceptanceCriteria,
    );
    const mandateBlockers = deriveExpertMandateBlockers(riskSignals, hookCoverage);
    const checklistOptions = {
      domainPack,
      e2MandateBlockers: mandateBlockers.map((b) => b.code),
      context: "run_auto_qa" as const,
      suiteIdPresent: autoSuite !== undefined && "suite_id" in autoSuite,
    };

    const html = renderQaRunReportHtml(report, flakeTaxonomy, checklistOptions);
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

    let learningCandidates: JsonObject[] = [];
    if (this.#dependencies.candidateRepository !== undefined) {
      try {
        const queried = await this.#dependencies.candidateRepository.query({
          context: input.execution.workspace_context,
          discovery_source: "mistake-recurrence",
        });
        if (queried.ok) {
          learningCandidates = queried.value.slice(0, 20).map((candidate) => ({
            id: candidate.id,
            status: candidate.status,
            discovery_source: candidate.discovery_source,
            rationale: candidate.rationale,
            supporting_evidence_refs: [...(candidate.supporting_evidence_refs ?? [])],
          }));
        }
      } catch {
        learningCandidates = [];
      }
    }

    const evidence = [
      `capture:${report.discovery_capture_id}`,
      ...report.test_cases.flatMap((testCase) => testCase.evidence),
      ...(autoSuite && "suite_id" in autoSuite ? [`suite:${autoSuite.suite_id}`] : []),
      ...mandateBlockers.map((b) => `mandate:${b.code}`),
    ];

    const expertObservations = buildExpertObservations({
      signals: riskSignals,
      coverage: hookCoverage,
      mandate_blockers: mandateBlockers,
      summary: report.summary,
      release_recommendation: report.release_recommendation,
    });

    const reportJson = qaRunReportJson(
      report,
      html,
      writtenPath,
      autoSuite,
      flakeTaxonomy,
      checklistOptions,
    );
    return {
      ok: true,
      value: {
        output: {
          ...reportJson,
          expert_extensions: hooks.extensions,
          expert_observations: expertObservations,
          learning: {
            failure_avoidance_hints: priorHints.map((entry) => ({
              key: entry.key,
              causal_mistake: entry.value,
              source_ref: entry.source_ref,
              retained_at: entry.retained_at,
              expires_at: entry.expires_at,
            })),
            learning_candidates: learningCandidates,
            note: "Always present (may be empty). Hints/candidates are advisory — not confirmed_cause.",
          },
          /** @deprecated Prefer learning.failure_avoidance_hints — kept for host compat. */
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
        usage: { steps: 3, duration_seconds: 0, tool_calls: report.test_cases.length + 1, retries: 0 },
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

function qaRunReportJson(
  report: QaRunReport,
  html: string,
  writtenPath: string | undefined,
  autoSuite:
    | Readonly<{ suite_id: string; persisted_path?: string; case_count: number; label: string }>
    | Readonly<{ skipped: true; reason: string }>
    | undefined,
  flakeTaxonomy: ReturnType<typeof deriveFlakeTaxonomy>,
  checklistOptions?: ExpertChecklistFromReportOptions,
): JsonObject {
  const gaps = deriveCoverageGaps(report);
  const retest = deriveSmartRetestSuggestion(report);
  const suitePresent =
    checklistOptions?.suiteIdPresent === true ||
    (autoSuite !== undefined && "suite_id" in autoSuite);
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
    coverage_gaps: gaps,
    smart_retest_suggestion: suitePresent
      ? {
          ...retest,
          suite_id: (autoSuite as { suite_id: string }).suite_id,
          recommended_call: {
            tool: "run_regression_suite",
            hint: `Use suite_id ${(autoSuite as { suite_id: string }).suite_id} with case_ids / related_defect_ids from this suggestion.`,
          },
        }
      : retest,
    auto_registered_suite: autoSuite ?? null,
    flake_taxonomy: flakeTaxonomyJson(flakeTaxonomy),
    expert_checklist: expertChecklistFromQaRunReport(
      report,
      gaps.length,
      String(retest["action"] ?? "unknown"),
      {
        suiteIdPresent: suitePresent,
        ...(checklistOptions?.domainPack !== undefined ? { domainPack: checklistOptions.domainPack } : {}),
        ...(checklistOptions?.e2MandateBlockers !== undefined
          ? { e2MandateBlockers: checklistOptions.e2MandateBlockers }
          : {}),
        context: checklistOptions?.context ?? "run_auto_qa",
      },
    ),
    report_html: html,
    report_path: writtenPath ?? null,
  };
}

function assessDomainPackFromInput(raw: Readonly<Record<string, JsonValue | undefined>>): DomainPackGateInput {
  const productRoot = typeof raw["product_root"] === "string" ? raw["product_root"] : undefined;
  const packRaw = typeof raw["pack_dirname"] === "string" ? raw["pack_dirname"].trim() : undefined;
  const pack_dirname = packRaw === ".qa-domain" ? (".qa-domain" as const) : ("domain-knowledge" as const);
  return assessDomainPackGate({
    ...(productRoot !== undefined ? { product_root: productRoot } : {}),
    pack_dirname,
    acknowledge_domain_pack_absent: raw["acknowledge_domain_pack_absent"] === true,
    domain_high_risk_confirmed: raw["domain_high_risk_confirmed"] === true,
  });
}

/**
 * Derives a smart retest suggestion: exactly which case_ids to re-run after a fix,
 * and the recommended `run_regression_suite` call shape. Expert QA never re-runs
 * the full suite when only a subset of cases failed.
 */
function deriveSmartRetestSuggestion(report: QaRunReport): JsonObject {
  const failedCases = report.test_cases.filter((tc) => tc.outcome === "failed" || tc.outcome === "cancelled");
  const flakyCases = report.test_cases.filter((tc) => tc.outcome === "flaky");
  const relatedDefectIds = report.draft_defects.map((d) => `DEF-DRAFT:${d.id}`);

  if (failedCases.length === 0 && flakyCases.length === 0) {
    return {
      action: "no_retest_needed",
      message: "All executed cases passed. No retest required unless requirements change.",
    };
  }

  return {
    action: "targeted_retest",
    message: `Re-run only the ${failedCases.length} failed + ${flakyCases.length} flaky case(s) after fix. Do NOT re-run the full suite unless AC changed.`,
    failed_case_ids: failedCases.map((tc) => tc.test_case_id),
    flaky_case_ids: flakyCases.map((tc) => tc.test_case_id),
    related_defect_ids: relatedDefectIds,
    recommended_call: {
      tool: "run_regression_suite",
      hint: relatedDefectIds.length > 0
        ? `Pass related_defect_ids: ${JSON.stringify(relatedDefectIds)} to run targeted subset`
        : `Pass case_ids: ${JSON.stringify([...failedCases, ...flakyCases].map((tc) => tc.test_case_id))}`,
    },
  };
}

/**
 * Derives an explicit "what was NOT tested" summary from run data.
 * Expert QA rule: never claim pass by silence — surface gaps proactively.
 */
function deriveCoverageGaps(report: QaRunReport): readonly JsonObject[] {
  const gaps: JsonObject[] = [];

  const notExecuted = report.test_cases.filter((tc) => tc.outcome === "not_executed");
  if (notExecuted.length > 0) {
    gaps.push({
      gap: "not_executed_test_cases",
      count: notExecuted.length,
      message: `${notExecuted.length} test case(s) were not executed — AC may be unbound or execution was skipped.`,
      test_case_ids: notExecuted.map((tc) => tc.test_case_id),
    });
  }

  if (report.generation_findings.length > 0) {
    gaps.push({
      gap: "unbindable_acceptance_criteria",
      count: report.generation_findings.length,
      message: `${report.generation_findings.length} acceptance criterion/criteria could not be bound to any discovered UI element.`,
    });
  }

  const criticalA11y = report.accessibility_smoke.findings.filter((f) => f.severity === "critical");
  if (criticalA11y.length > 0) {
    gaps.push({
      gap: "unlabeled_editable_fields",
      count: criticalA11y.length,
      message: `${criticalA11y.length} unlabeled editable field(s) detected — test cases for these controls may be unreliable.`,
    });
  }

  gaps.push({
    gap: "scope_limits",
    message: "This run covers UI naming smoke and generated AC variants only. Not covered: full WCAG audit, load testing, penetration testing, API authorization matrix, cross-browser parity.",
    not_covered: ["full_wcag", "load_test", "pen_test", "api_authz_matrix", "cross_browser"],
  });

  return gaps;
}
