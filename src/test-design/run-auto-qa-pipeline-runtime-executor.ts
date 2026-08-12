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
import {
  buildExpertRiskMatrix,
  expertRiskMatrixJson,
  riskMatrixPassBlockers,
} from "../reporting/expert-risk-matrix.js";
import {
  acQualityPassBlockers,
  reviewAcceptanceCriteriaQuality,
} from "../reporting/ac-quality-review.js";
import {
  buildExpertJudgment,
  expertJudgmentJson,
  oracleStrengthPassBlockers,
} from "../reporting/expert-judgment.js";
import {
  applyStructuredWaivesToBlockers,
  buildSeniorHardeningBundle,
  seniorHardeningJson,
} from "../reporting/expert-senior-hardening.js";
import { RunDepthSmokes } from "../depth-smokes/run-depth-smokes.js";
import {
  draftExpertSessionReport,
  expertSessionReportJson,
} from "../reporting/expert-session-report.js";
import {
  renderQaRunReportHtml,
  summarizeQaRunTestCases,
  type QaRunReport,
  type QaRunTestCaseResult,
} from "../reporting/qa-run-report.js";
import { buildProfessionalQaAnalysis } from "../reporting/qa-professional-analysis.js";
import { draftDefectsFromQaRun } from "../bug-analysis/draft-defects-from-qa-run.js";
import { assessGitBlastRadius, gitBlastRadiusJson } from "../discovery/git-blast-radius.js";
import type { ExecuteApiSmoke } from "../api-testing/execute-api-smoke.js";
import type { FileBackedRegressionSuiteRegistry } from "./file-backed-regression-suite-registry.js";
import type { InMemoryRegressionSuiteRegistry, RegressionCase } from "./regression-suite-registry.js";
import type { GenerateTestCases } from "./generate-test-cases.js";
import { runExpertHooks } from "./run-auto-qa-expert-hooks.js";
import { executeExpertExtensionCases } from "./execute-expert-extension-cases.js";
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
  /** When set, Expert pass can execute OpenAPI smoke subset in-loop. */
  apiSmoke?: ExecuteApiSmoke;
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

    const includeScreenshot = input.start_request.input["include_screenshot"] === true;
    const maxElements =
      typeof input.start_request.input["max_elements"] === "number"
        ? input.start_request.input["max_elements"]
        : undefined;

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
            ...(includeScreenshot ? { include_screenshot: true, screenshot_dir: screenshotDir } : {}),
            ...(maxElements !== undefined ? { max_elements: maxElements } : {}),
          })
      : (operationId, context) =>
          this.#dependencies.discoverUiSurface.discover({
            operation_id: operationId,
            context,
            url,
            browser,
            ...(includeScreenshot ? { include_screenshot: true, screenshot_dir: screenshotDir } : {}),
            ...(maxElements !== undefined ? { max_elements: maxElements } : {}),
          });

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
      ...(input.start_request.input["include_screenshot"] === true ? { alwaysScreenshot: true } : {}),
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

    const executeExtensions = input.start_request.input["execute_extension_cases"] !== false;
    const apiBaseUrl =
      readOptionalString(input.start_request.input["api_base_url"]) ?? url.trim();
    const extensionExec = await executeExpertExtensionCases(
      {
        clock: this.#dependencies.clock,
        authorizer: this.#dependencies.authorizer,
        ...(this.#dependencies.apiSmoke !== undefined
          ? { apiSmoke: this.#dependencies.apiSmoke }
          : {}),
        ...(this.#dependencies.credentials !== undefined
          ? { credentials: this.#dependencies.credentials }
          : {}),
        ...(this.#dependencies.launchBrowser !== undefined
          ? { launchBrowser: this.#dependencies.launchBrowser }
          : {}),
      },
      {
        operation_id: input.execution.operation_id,
        workspace_id: input.reference.workspace_id,
        context: input.execution.workspace_context,
        api_base_url: apiBaseUrl,
        deadline: input.start_request.deadline,
        run_id: input.reference.run_id,
        cases: hooks.extra_regression_cases,
        enabled: executeExtensions,
        ...(typeof input.start_request.input["max_extension_api"] === "number"
          ? { max_api: input.start_request.input["max_extension_api"] as number }
          : {}),
        ...(typeof input.start_request.input["max_extension_browser"] === "number"
          ? { max_browser: input.start_request.input["max_extension_browser"] as number }
          : {}),
      },
    );

    let report = result.value.report;
    if (extensionExec.results.length > 0) {
      report = mergeExtensionResultsIntoReport(report, extensionExec.results);
    }
    const flakeTaxonomy = deriveFlakeTaxonomy(report);

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
    const acQuality = reviewAcceptanceCriteriaQuality(acceptanceCriteria);
    const productRoot = readOptionalString(input.start_request.input["product_root"]);
    const gitBlast = await assessGitBlastRadius(productRoot);
    const declaredWaives = readDeclaredWaives(input.start_request.input["risk_waives"]);
    const priorSuite = findPriorSuite(
      this.#dependencies.regressionRegistry,
      input.reference.workspace_id,
      autoSuite && "suite_id" in autoSuite ? autoSuite.suite_id : undefined,
    );
    const includeDepth =
      input.start_request.input["include_depth_smokes"] === true
        ? true
        : input.start_request.input["include_depth_smokes"] === false
          ? false
          : undefined;

    const hardeningPreview = buildSeniorHardeningBundle({
      domain_pack: domainPack,
      extensions: hooks.extensions as JsonObject,
      extension_cases: hooks.extra_regression_cases.map((c) => {
        if (c.kind !== "api") return { kind: "browser" as const };
        return {
          kind: "api" as const,
          case: {
            id: c.case.id,
            ...(c.case.auth !== undefined ? { auth: c.case.auth } : {}),
          },
        };
      }),
      signals: riskSignals,
      hook_coverage: {
        openapi_cases_added: hookCoverage.openapi_cases_added,
        journey_cases_added: hookCoverage.journey_cases_added,
      },
      api_ran: extensionExec.api_ran,
      current_case_count: suiteCases.length,
      ...(priorSuite !== undefined ? { prior_suite: priorSuite } : {}),
      git: gitBlast,
      stateful_lifecycle_documented: input.start_request.input["stateful_lifecycle_documented"] === true,
      ...(declaredWaives.length > 0 ? { declared_waives: declaredWaives } : {}),
      ...(includeDepth !== undefined ? { include_depth_smokes: includeDepth } : {}),
    });

    let depthSmokeJson: JsonObject | null = null;
    let depthSmokesRan = false;
    if (hardeningPreview.depth_smoke_recommended) {
      try {
        let depthReportSeq = 0;
        let depthFindingSeq = 0;
        const depth = new RunDepthSmokes({
          authorizer: this.#dependencies.authorizer,
          clock: this.#dependencies.clock,
          ids: {
            next: (scope) =>
              scope === "report" ? `depth-report-${++depthReportSeq}` : `depth-finding-${++depthFindingSeq}`,
          },
          ...(this.#dependencies.launchBrowser !== undefined
            ? { launchBrowser: this.#dependencies.launchBrowser }
            : {}),
        });
        const depthResult = await depth.run({
          operation_id: `${input.execution.operation_id}:depth`,
          workspace_id: input.reference.workspace_id,
          context: input.execution.workspace_context,
          url: url.trim(),
          stages: ["a11y_subset", "perf", "security"],
        });
        if (depthResult.ok) {
          depthSmokesRan = true;
          depthSmokeJson = {
            ok: true,
            has_critical: depthResult.value.has_critical,
            summary: { ...depthResult.value.summary },
            stages: [...depthResult.value.stages],
            findings: depthResult.value.findings.slice(0, 30).map((f) => ({
              id: f.id,
              stage: f.stage,
              category: f.category,
              severity: f.severity,
              message: f.message,
              evidence: [...f.evidence],
            })),
            limitations: [...depthResult.value.limitations],
          };
          if (depthResult.value.has_critical) {
            // Critical depth findings become mandate-style blockers via hardening gaps
          }
        } else {
          depthSmokeJson = {
            ok: false,
            message: depthResult.failure.message,
            note: hardeningPreview.depth_smoke_reason,
          };
        }
      } catch (error) {
        depthSmokeJson = {
          ok: false,
          message: `depth smoke failed: ${(error as Error).message}`,
          note: hardeningPreview.depth_smoke_reason,
        };
      }
    }

    const roleDiffTriaged =
      !hardeningPreview.role_diff.material_diff ||
      declaredWaives.some((w) => w.risk_id === "e2_role_surface_diff_untriaged");

    const riskMatrix = buildExpertRiskMatrix({
      signals: riskSignals,
      domain_pack: domainPack,
      hook_coverage: hookCoverage,
      extension_executed: {
        api_ran: extensionExec.api_ran,
        journey_ran: extensionExec.journey_ran,
      },
      authz_negatives_present: hardeningPreview.authz_negatives.authz_negative_cases_present,
      role_diff_triaged: roleDiffTriaged,
      depth_smokes_ran: depthSmokesRan,
      stateful_covered_or_waived:
        hardeningPreview.stateful.covered || hardeningPreview.stateful.waived,
      money_oracle_strong:
        !riskSignals.needs_money_oracles ||
        (hookCoverage.any_expected_network_on_ac &&
          !domainPack.high_risk_unconfirmed),
    });

    const hardening = buildSeniorHardeningBundle({
      domain_pack: domainPack,
      extensions: hooks.extensions as JsonObject,
      extension_cases: hooks.extra_regression_cases.map((c) => {
        if (c.kind !== "api") return { kind: "browser" as const };
        return {
          kind: "api" as const,
          case: {
            id: c.case.id,
            ...(c.case.auth !== undefined ? { auth: c.case.auth } : {}),
          },
        };
      }),
      signals: riskSignals,
      hook_coverage: {
        openapi_cases_added: hookCoverage.openapi_cases_added,
        journey_cases_added: hookCoverage.journey_cases_added,
      },
      api_ran: extensionExec.api_ran,
      current_case_count: suiteCases.length,
      ...(priorSuite !== undefined ? { prior_suite: priorSuite } : {}),
      git: gitBlast,
      stateful_lifecycle_documented: input.start_request.input["stateful_lifecycle_documented"] === true,
      ...(declaredWaives.length > 0 ? { declared_waives: declaredWaives } : {}),
      ...(includeDepth !== undefined ? { include_depth_smokes: includeDepth } : {}),
    });

    const oraclePreview = buildExpertJudgment({
      report,
      risk_signals: riskSignals,
      hook_coverage: hookCoverage,
      mandate_blockers: mandateBlockers,
      risk_matrix: riskMatrix,
      ac_quality: acQuality,
      acceptance_criteria: acceptanceCriteria,
      domain_pack: domainPack,
      git_blast_radius: gitBlast,
      claim_pass_allowed: false,
      extension_execution: {
        api_ran: extensionExec.api_ran,
        journey_ran: extensionExec.journey_ran,
        api_attempted: extensionExec.api_attempted,
        journey_attempted: extensionExec.journey_attempted,
      },
      ...(declaredWaives.length > 0 ? { declared_waives: declaredWaives } : {}),
    });

    const rawExtraBlockers = [
      ...riskMatrixPassBlockers(riskMatrix),
      ...acQualityPassBlockers(acQuality),
      ...oracleStrengthPassBlockers(oraclePreview),
      ...hardening.pass_blockers,
      ...(depthSmokeJson && depthSmokeJson["has_critical"] === true
        ? ["e2_depth_smoke_critical"]
        : []),
    ];
    const waived = applyStructuredWaivesToBlockers(rawExtraBlockers, declaredWaives);
    const liteMode = input.start_request.input["lite_mode"] === true;
    const extraPassBlockers = liteMode
      ? ["lite_mode:ad_hoc_no_pass_claim", ...waived.blockers.filter((b) => b.startsWith("failed_") || b.startsWith("flaky_") || b.startsWith("draft_defects") || b.startsWith("gate:"))]
      : [...waived.blockers];
    const suitePresent = autoSuite !== undefined && "suite_id" in autoSuite;
    const gapExtras: CoverageGapExtras = {
      mandate_blockers: liteMode ? [] : mandateBlockers,
      domain_pack: domainPack,
      journey_cases_registered_not_executed:
        !liteMode && hookCoverage.journey_cases_added && extensionExec.journey_attempted === 0,
      openapi_cases_registered_not_executed:
        hookCoverage.openapi_cases_added && extensionExec.api_attempted === 0,
      stateful_lifecycle_uncovered: !hardening.stateful.covered && !hardening.stateful.waived,
      git_blast_radius: gitBlast,
      ac_quality_high_count: acQuality.findings.filter((f) => f.severity === "high").length,
      oracle_none_count: oraclePreview.oracle_strength.rows.filter((r) => r.strength === "none").length,
      hardening_gaps: hardening.gaps,
    };
    const gaps = deriveCoverageGaps(report, gapExtras);
    const retest = deriveSmartRetestSuggestion(report);
    const checklistOptions: ExpertChecklistFromReportOptions = {
      domainPack: liteMode
        ? {
            present: true,
            high_risk_unconfirmed: false,
            notes: ["lite_mode: domain-pack Expert gate waived for ad-hoc execution"],
          }
        : domainPack,
      e2MandateBlockers: liteMode ? [] : mandateBlockers.map((b) => b.code),
      extraPassBlockers,
      context: "run_auto_qa",
      suiteIdPresent: liteMode || suitePresent,
    };
    const expertChecklistBase = expertChecklistFromQaRunReport(
      report,
      gaps.length,
      String(retest["action"] ?? "unknown"),
      checklistOptions,
    );
    const expertChecklist = liteMode
      ? {
          ...expertChecklistBase,
          claim_pass_allowed: false,
          lite_mode: true,
          host_actions: [
            "lite_mode: ad-hoc run — Expert domain/suite/E2 gates waived; claim_pass_allowed stays false. Re-run without lite_mode for full Expert claim path.",
            ...(Array.isArray(expertChecklistBase["host_actions"])
              ? (expertChecklistBase["host_actions"] as string[]).slice(0, 4)
              : []),
          ],
        }
      : expertChecklistBase;
    const claimPass = expertChecklist["claim_pass_allowed"] === true;
    const judgment = buildExpertJudgment({
      report,
      risk_signals: riskSignals,
      hook_coverage: hookCoverage,
      mandate_blockers: mandateBlockers,
      risk_matrix: riskMatrix,
      ac_quality: acQuality,
      acceptance_criteria: acceptanceCriteria,
      domain_pack: domainPack,
      git_blast_radius: gitBlast,
      claim_pass_allowed: claimPass,
      extension_execution: {
        api_ran: extensionExec.api_ran,
        journey_ran: extensionExec.journey_ran,
        api_attempted: extensionExec.api_attempted,
        journey_attempted: extensionExec.journey_attempted,
      },
      ...(declaredWaives.length > 0 ? { declared_waives: declaredWaives } : {}),
    });
    const sessionReport = draftExpertSessionReport({
      report,
      claim_pass_allowed: claimPass,
      blockers: Array.isArray(expertChecklist["blockers"])
        ? (expertChecklist["blockers"] as unknown[]).map(String)
        : [],
      coverage_gaps: gaps,
      risk_signals: riskSignals,
      hook_coverage: hookCoverage,
      mandate_blockers: mandateBlockers,
      domain_pack: domainPack,
      flake_taxonomy: flakeTaxonomy,
      risk_matrix: riskMatrix,
      ac_quality: acQuality,
      git_blast_radius: gitBlast,
      judgment,
      abuse_residual: {
        title: hardening.abuse_residual.title,
        objective: hardening.abuse_residual.objective,
        time_box_minutes: hardening.abuse_residual.time_box_minutes,
        probes: hardening.abuse_residual.probes,
        note: hardening.abuse_residual.note,
      },
      session_delta_message: hardening.session_delta.message,
      extension_execution: {
        skipped: extensionExec.skipped,
        api_ran: extensionExec.api_ran,
        journey_ran: extensionExec.journey_ran,
        api_attempted: extensionExec.api_attempted,
        journey_attempted: extensionExec.journey_attempted,
        ...(extensionExec.reason !== undefined ? { reason: extensionExec.reason } : {}),
      },
      ...(suitePresent && autoSuite && "suite_id" in autoSuite ? { suite_id: autoSuite.suite_id } : {}),
    });

    const html = renderQaRunReportHtml(report, flakeTaxonomy, checklistOptions, sessionReport);
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
      extension_executed: {
        api_ran: extensionExec.api_ran,
        journey_ran: extensionExec.journey_ran,
      },
      prior_hint_count: priorHints.length,
      depth_smokes_ran: depthSmokesRan,
      session_delta_message: hardening.session_delta.message,
    });

    const reportJson = qaRunReportJson(
      report,
      html,
      writtenPath,
      autoSuite,
      flakeTaxonomy,
      checklistOptions,
      gaps,
      retest,
      expertChecklist,
    );
    return {
      ok: true,
      value: {
        output: {
          ...reportJson,
          expert_extensions: hooks.extensions,
          expert_observations: expertObservations,
          expert_session_report: expertSessionReportJson(sessionReport),
          expert_judgment: expertJudgmentJson(judgment),
          expert_senior_hardening: {
            ...seniorHardeningJson(hardening),
            waive_notes: [...waived.notes],
            blockers_cleared_by_waive: [...waived.cleared],
          },
          depth_smokes: depthSmokeJson,
          expert_risk_matrix: expertRiskMatrixJson(riskMatrix),
          ac_quality_review: {
            schema_version: acQuality.schema_version,
            finding_count: acQuality.finding_count,
            findings: acQuality.findings.map((f) => ({ ...f })),
            note: acQuality.note,
          },
          git_blast_radius: gitBlastRadiusJson(gitBlast),
          extension_execution: {
            skipped: extensionExec.skipped,
            ...(extensionExec.reason !== undefined ? { reason: extensionExec.reason } : {}),
            api_ran: extensionExec.api_ran,
            journey_ran: extensionExec.journey_ran,
            api_attempted: extensionExec.api_attempted,
            journey_attempted: extensionExec.journey_attempted,
            failed_count: extensionExec.failed_count,
            flaky_count: extensionExec.flaky_count,
          },
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
  checklistOptions: ExpertChecklistFromReportOptions | undefined,
  gaps: readonly JsonObject[],
  retest: JsonObject,
  expertChecklist: JsonObject,
): JsonObject {
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
    expert_checklist: expertChecklist,
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
  // Defect ids are already `DEF-DRAFT:<caseId>` — do not double-prefix.
  const relatedDefectIds = report.draft_defects.map((d) => d.id);

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

type CoverageGapExtras = Readonly<{
  mandate_blockers?: readonly { code: string; message: string }[];
  domain_pack?: DomainPackGateInput;
  journey_cases_registered_not_executed?: boolean;
  openapi_cases_registered_not_executed?: boolean;
  stateful_lifecycle_uncovered?: boolean;
  git_blast_radius?: Awaited<ReturnType<typeof assessGitBlastRadius>>;
  ac_quality_high_count?: number;
  oracle_none_count?: number;
  hardening_gaps?: readonly JsonObject[];
}>;

/**
 * Derives an explicit "what was NOT tested" summary from run data.
 * Expert QA rule: never claim pass by silence — surface gaps proactively.
 */
function deriveCoverageGaps(report: QaRunReport, extras?: CoverageGapExtras): readonly JsonObject[] {
  const gaps: JsonObject[] = [];

  const notExecuted = report.test_cases.filter((tc) => tc.outcome === "not_executed");
  if (notExecuted.length > 0) {
    gaps.push({
      gap: "not_executed_test_cases",
      count: notExecuted.length,
      message: `${notExecuted.length} test case(s) were not executed — AC may be unbound or execution was skipped.`,
      test_case_ids: notExecuted.map((tc) => tc.test_case_id),
      expert_note: "A human Expert never counts not_executed as silent pass.",
    });
  }

  if (report.generation_findings.length > 0) {
    gaps.push({
      gap: "unbindable_acceptance_criteria",
      count: report.generation_findings.length,
      message: `${report.generation_findings.length} acceptance criterion/criteria could not be bound to any discovered UI element.`,
      expert_note: "Push back on AC quality or enrich discovery — do not invent bindings.",
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

  for (const mandate of extras?.mandate_blockers ?? []) {
    gaps.push({
      gap: mandate.code,
      message: mandate.message,
      expert_note: "E2 smell not exercised — Senior Expert would block 'done' until closed or explicitly waived with reason.",
    });
  }

  if (extras?.journey_cases_registered_not_executed === true) {
    gaps.push({
      gap: "journey_cases_registered_not_executed",
      message:
        "Multi-page journey cases were added to the suite but not executed in this pass — set execute_extension_cases (default true) or run_regression_suite.",
      expert_note: "Registering journeys ≠ testing journeys.",
    });
  }

  if (extras?.openapi_cases_registered_not_executed === true) {
    gaps.push({
      gap: "api_smoke_registered_not_executed",
      message:
        "OpenAPI smoke cases were merged into the suite but not executed in this pass — ensure apiSmoke is configured / api_base_url set, or run_regression_suite.",
    });
  }

  if ((extras?.ac_quality_high_count ?? 0) > 0) {
    const highCount = extras!.ac_quality_high_count ?? 0;
    gaps.push({
      gap: "ac_quality_high",
      count: highCount,
      message: `${highCount} high-severity AC quality finding(s) — Expert pushback required before pass claims.`,
    });
  }

  if ((extras?.oracle_none_count ?? 0) > 0) {
    const noneCount = extras!.oracle_none_count ?? 0;
    gaps.push({
      gap: "oracle_strength_none",
      count: noneCount,
      message: `${noneCount} AC have no executable oracle — Senior Expert refuses unverifiable pass.`,
    });
  }

  if (extras?.stateful_lifecycle_uncovered === true) {
    // Prefer hardening gap if present (richer checklist); else minimal
    const hasHardeningStateful = (extras.hardening_gaps ?? []).some((g) => g["gap"] === "stateful_data_lifecycle");
    if (!hasHardeningStateful) {
      gaps.push({
        gap: "stateful_data_lifecycle",
        message:
          "No durable fixture create→use→cleanup oracle in this loop — data pollution / orphan records may be invisible.",
        expert_note: "Document setup/teardown or waive with reason; residual until evidenced.",
      });
    }
  }

  for (const hg of extras?.hardening_gaps ?? []) {
    gaps.push({ ...hg });
  }

  if (extras?.git_blast_radius?.available && extras.git_blast_radius.changed_files.length > 0) {
    gaps.push({
      gap: "diff_blast_radius",
      count: extras.git_blast_radius.changed_files.length,
      message: extras.git_blast_radius.message,
      hotspots: [...extras.git_blast_radius.hotspots],
      suggested_retest_focus: [...extras.git_blast_radius.suggested_retest_focus],
      expert_note: "Filenames are hints, not oracles — map to screens/AC before claiming coverage.",
    });
  }

  if (extras?.domain_pack && !extras.domain_pack.present) {
    gaps.push({
      gap: "domain_pack_absent",
      message: "No product domain-knowledge pack — money/permission/legacy risks may be invisible.",
    });
  } else if (extras?.domain_pack?.high_risk_unconfirmed) {
    gaps.push({
      gap: "domain_high_risk_unconfirmed",
      message: "Domain pack still has money/permission/legacy stubs or TODOs awaiting human confirm.",
      ...(extras.domain_pack.pack_path !== undefined ? { pack_path: extras.domain_pack.pack_path } : {}),
    });
  }

  gaps.push({
    gap: "scope_limits",
    message:
      "This run covers UI naming smoke + generated AC variants (+ optional E2 hooks/extension subset). Not covered unless separately evidenced: full WCAG/axe, load/perf, penetration testing, complete API authz matrix, cross-browser parity.",
    not_covered: [
      "full_wcag",
      "load_test",
      "pen_test",
      "api_authz_matrix_complete",
      "cross_browser",
    ],
  });

  return gaps;
}

function mergeExtensionResultsIntoReport(
  report: QaRunReport,
  extensionResults: readonly QaRunTestCaseResult[],
): QaRunReport {
  const test_cases = [...report.test_cases, ...extensionResults];
  const summary = summarizeQaRunTestCases(test_cases);
  const extensionDefects = draftDefectsFromQaRun({
    workspace_id: report.workspace_id,
    requirement_ref: report.requirement_ref,
    target_url: report.target_url,
    environment_ref: `environment:${report.requirement_ref}`,
    test_cases: extensionResults,
  });
  const draft_defects = [...report.draft_defects, ...extensionDefects];
  const analysis = buildProfessionalQaAnalysis({
    test_cases,
    generation_findings: report.generation_findings,
    draft_defects,
    summary,
    accessibility_smoke: report.accessibility_smoke,
  });
  return {
    ...report,
    test_cases,
    summary,
    draft_defects,
    variant_coverage: analysis.variant_coverage,
    residual_risks: analysis.residual_risks,
    release_recommendation: analysis.release_recommendation,
    release_recommendation_rationale: analysis.release_recommendation_rationale,
  };
}

function readDeclaredWaives(
  value: JsonValue | undefined,
): readonly Readonly<{ risk_id: string; reason_code: string; rationale: string }>[] {
  if (!Array.isArray(value)) return [];
  const out: Array<{ risk_id: string; reason_code: string; rationale: string }> = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const obj = entry as JsonObject;
    const risk_id = typeof obj["risk_id"] === "string" ? obj["risk_id"].trim() : "";
    const reason_code = typeof obj["reason_code"] === "string" ? obj["reason_code"].trim() : "";
    const rationale = typeof obj["rationale"] === "string" ? obj["rationale"].trim() : "";
    if (risk_id && reason_code && rationale.length >= 12) {
      out.push({ risk_id, reason_code, rationale });
    }
  }
  return out;
}

function findPriorSuite(
  registry: RegressionSuiteRegistry | undefined,
  workspaceId: string,
  currentSuiteId: string | undefined,
): Readonly<{ suite_id: string; case_count: number }> | undefined {
  if (registry === undefined) return undefined;
  const listed = registry.list(workspaceId);
  const prior = listed
    .filter((s) => s.id !== currentSuiteId)
    .sort((a, b) => b.registered_at.localeCompare(a.registered_at))[0];
  if (prior === undefined) return undefined;
  return { suite_id: prior.id, case_count: prior.case_count };
}
