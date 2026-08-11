/**
 * MCP adapters: regression suite register/list + run; OpenAPI→cases;
 * defect tracker export; UI surface compare.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import { ExecuteBrowserTest, MAX_FLAKE_TRIALS } from "../execution/execute-browser-test.js";
import { ExecuteApiSmoke } from "../api-testing/execute-api-smoke.js";
import { openApiToApiSmokeCases } from "../api-testing/openapi-to-smoke-cases.js";
import type { ApiSmokeCase } from "../api-testing/public.js";
import { draftDefectsFromQaRun } from "../bug-analysis/draft-defects-from-qa-run.js";
import { formatDefectsForTracker, type DefectExportFormat } from "../bug-analysis/format-defects-for-tracker.js";
import { fileDefectsToTracker, type DefectTrackerProvider } from "../bug-analysis/file-defects-to-tracker.js";
import { assessDomainPackGate } from "../domain-pack/assess-domain-pack-gate.js";
import { deriveExpertChecklist } from "../reporting/expert-checklist.js";
import type { FileBackedKnowledgeSearch } from "../knowledge/file-backed-knowledge-search.js";
import { resolveBearerToken, resolvePasswordInput } from "../credentials/resolve-secret-input.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import type { Defect } from "../bug-analysis/public.js";
import { compareUiSurfaces } from "../discovery/compare-ui-surfaces.js";
import {
  discoverAndCompareRoleSurfaces,
  type RoleSessionLogin,
} from "../discovery/discover-and-compare-role-surfaces.js";
import type { SemanticUiElement } from "../discovery/public.js";
import { buildProfessionalQaAnalysis } from "../reporting/qa-professional-analysis.js";
import type { QaRunTestCaseOutcome, QaRunTestCaseResult } from "../reporting/qa-run-report.js";
import type {
  JsonObject,
  JsonValue,
  VersionReference,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { testCaseToExecutionPlan } from "./to-execution-plan.js";
import type { TestCase, TestCaseGeneratedAssertion } from "./public.js";
import {
  InMemoryRegressionSuiteRegistry,
  type RegressionCase,
} from "./regression-suite-registry.js";
import type { FileBackedRegressionSuiteRegistry } from "./file-backed-regression-suite-registry.js";
import type { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import { buildDefectEvidencePack } from "../bug-analysis/defect-evidence-pack.js";

export type RegressionSuiteRegistry = InMemoryRegressionSuiteRegistry | FileBackedRegressionSuiteRegistry;

export type RegressionSuiteRuntimeExecutorDependencies = Readonly<{
  registry: RegressionSuiteRegistry;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list" | "run";
  authorizer?: WorkspaceAuthorizer;
  clock: { now(): Date };
  browserAuthorizer: WorkspaceAuthorizer;
  apiSmoke?: ExecuteApiSmoke;
  credentials?: import("../credentials/workspace-credential-registry.js").WorkspaceCredentialRegistry;
}>;

export class RegressionSuiteRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RegressionSuiteRuntimeExecutorDependencies;

  constructor(dependencies: RegressionSuiteRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const permission =
        this.#dependencies.mode === "list" ? "execution:read" : "execution:execute";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: `regression suite ${this.#dependencies.mode}`,
        consequence_class: this.#dependencies.mode === "list" ? "advisory" : "reversible",
        required_permissions: [permission],
        resource_refs: [`workspace:${workspaceId}`],
      });
      if (!authorization.ok) {
        return {
          ok: false,
          failure: failure(
            "policy",
            "authorization_denied",
            authorization.failure.message,
            authorization.failure.retryable,
            [...authorization.failure.evidence],
          ),
        };
      }
    }

    if (this.#dependencies.mode === "list") {
      const suites = this.#dependencies.registry.list(workspaceId);
      return success(this.#dependencies, input, {
        workspace_id: workspaceId,
        suites: [...suites],
      }, [`suite-count:${suites.length}`]);
    }

    if (this.#dependencies.mode === "register") {
      const label = readString(input.start_request.input["label"]);
      const cases = parseRegressionCases(input.start_request.input["cases"]);
      if (label === undefined || cases === undefined) {
        return {
          ok: false,
          failure: failure(
            "orchestration",
            "invalid_request",
            "register_regression_suite requires label and non-empty cases[{kind:browser|api,...}].",
          ),
        };
      }
      const id = readString(input.start_request.input["id"]);
      const environmentRef = readString(input.start_request.input["environment_ref"]);
      const baseUrl = readString(input.start_request.input["base_url"]);
      const registered = this.#dependencies.registry.register({
        workspace_id: workspaceId,
        label,
        cases,
        ...(id !== undefined ? { id } : {}),
        ...(environmentRef !== undefined ? { environment_ref: environmentRef } : {}),
        ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
      });
      if (!registered.ok) {
        return { ok: false, failure: failure("orchestration", "invalid_request", registered.message) };
      }
      const outputWithPath: JsonObject =
        "persisted_path" in registered && typeof registered.persisted_path === "string"
          ? {
              suite_id: registered.suite.id,
              label: registered.suite.label,
              case_count: registered.suite.cases.length,
              registered_at: registered.suite.registered_at,
              persisted_path: registered.persisted_path,
            }
          : {
              suite_id: registered.suite.id,
              label: registered.suite.label,
              case_count: registered.suite.cases.length,
              registered_at: registered.suite.registered_at,
            };
      const evidence = [`suite:${registered.suite.id}`];
      if ("persisted_path" in registered && typeof registered.persisted_path === "string") {
        evidence.push(`persisted:${registered.persisted_path}`);
      }
      return success(this.#dependencies, input, outputWithPath, evidence);
    }

    // run
    const suiteId = readString(input.start_request.input["suite_id"]);
    if (suiteId === undefined) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "run_regression_suite requires suite_id."),
      };
    }
    const suite = this.#dependencies.registry.get(workspaceId, suiteId);
    if (suite === undefined) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", `Unknown suite_id "${suiteId}".`),
      };
    }

    const caseIds = readStringArray(input.start_request.input["case_ids"]);
    const relatedDefectIds = readStringArray(input.start_request.input["related_defect_ids"]);
    const fieldValues = readFieldValuesMap(input.start_request.input["field_values"]);
    const casesToRun = filterRegressionCases(suite.cases, caseIds, relatedDefectIds);
    if (casesToRun.length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "run_regression_suite: no cases matched case_ids / related_defect_ids filters (or suite empty).",
        ),
      };
    }

    const results: JsonObject[] = [];
    const qaResults: QaRunTestCaseResult[] = [];
    let nonPassed = 0;

    for (const item of casesToRun) {
      if (item.kind === "api") {
        if (this.#dependencies.apiSmoke === undefined) {
          const row = regressionRow("api", item.case.id, "not_executed", "API smoke skill not wired.", []);
          results.push(row.json);
          qaResults.push(row.qa);
          nonPassed += 1;
          continue;
        }
        const baseUrl =
          readString(input.start_request.input["base_url"]) ??
          suite.base_url;
        if (baseUrl === undefined) {
          const row = regressionRow("api", item.case.id, "not_executed", "base_url required for API cases.", []);
          results.push(row.json);
          qaResults.push(row.qa);
          nonPassed += 1;
          continue;
        }
        const run = await this.#dependencies.apiSmoke.run({
          operation_id: `${input.execution.operation_id}:${item.case.id}`,
          workspace_id: workspaceId,
          context: input.execution.workspace_context,
          base_url: baseUrl,
          cases: [item.case],
        });
        if (!run.ok) {
          const row = regressionRow("api", item.case.id, "failed", run.failure.message, [
            `api-failure:${run.failure.message}`,
          ]);
          results.push(row.json);
          qaResults.push(row.qa);
          nonPassed += 1;
          continue;
        }
        const caseResult = run.value.cases[0];
        const rawOutcome = String(caseResult?.outcome ?? run.value.outcome);
        const outcome = mapQaOutcome(rawOutcome);
        const row = regressionRow(
          "api",
          item.case.id,
          outcome,
          caseResult?.message ?? "",
          [`api-outcome:${rawOutcome}`],
        );
        results.push(row.json);
        qaResults.push(row.qa);
        if (outcome !== "passed") nonPassed += 1;
        continue;
      }

      const converted = testCaseToExecutionPlan(
        item.test_case,
        [item.generated_assertion],
        fieldValues,
      );
      if (!converted.ok) {
        const row = regressionRow("browser", item.test_case.id, "not_executed", converted.failure.message, [
          `plan:${converted.failure.message}`,
        ]);
        results.push(row.json);
        qaResults.push(row.qa);
        nonPassed += 1;
        continue;
      }

      const screenshotDir = join(process.cwd(), ".qa-screenshots", input.execution.operation_id, item.test_case.id);
      const traceDir = join(process.cwd(), ".qa-traces", input.execution.operation_id, item.test_case.id);
      await mkdir(screenshotDir, { recursive: true }).catch(() => undefined);
      await mkdir(traceDir, { recursive: true }).catch(() => undefined);
      const plans = new Map<string, PlaywrightExecutionPlan>(
        Array.from({ length: MAX_FLAKE_TRIALS }, (_, i) => {
          const key = i === 0 ? item.test_case.id : `${item.test_case.id}:trial-${i + 1}`;
          return [key, converted.value] as const;
        }),
      );
      const engine = new PlaywrightExecutionEngine({
        clock: this.#dependencies.clock,
        authorizer: this.#dependencies.browserAuthorizer,
        provider: { id: "playwright-execution-engine", version: "0.1.0" },
        plans,
        ...(this.#dependencies.credentials !== undefined ? { secrets: this.#dependencies.credentials } : {}),
        screenshotDir,
        traceDir,
      });
      const skill = new ExecuteBrowserTest({
        engine,
        clock: this.#dependencies.clock,
        provider_ref: "playwright-execution-engine@0.1.0",
      });
      const executed = await skill.run({
        operation_id: `${input.execution.operation_id}:${item.test_case.id}`,
        workspace: input.execution.workspace_context,
        execution: { execution_id: input.reference.run_id, attempt_id: item.test_case.id },
        test_case_ref: item.test_case.id,
        environment_ref: suite.environment_ref ?? "regression",
        deadline: input.start_request.deadline,
      });
      if (!executed.ok) {
        const row = regressionRow("browser", item.test_case.id, "failed", executed.failure.message, [
          ...executed.failure.evidence,
        ]);
        results.push(row.json);
        qaResults.push(row.qa);
        nonPassed += 1;
        continue;
      }
      const outcome = mapQaOutcome(String(executed.value.outcome ?? "indeterminate"));
      const evidence = [...(executed.value.evidence ?? [])];
      const row = regressionRow(
        "browser",
        item.test_case.id,
        outcome,
        `evidence:${evidence.length}`,
        evidence,
        item.test_case.purpose,
      );
      results.push(row.json);
      qaResults.push(row.qa);
      if (outcome !== "passed") nonPassed += 1;
    }

    const requirementRef =
      readString(input.start_request.input["requirement_ref"]) ?? `regression-suite:${suite.id}`;
    const targetUrl =
      readString(input.start_request.input["target_url"]) ??
      suite.base_url ??
      `suite:${suite.id}`;
    const environmentRef = suite.environment_ref ?? "regression";
    const draft_defects = draftDefectsFromQaRun({
      workspace_id: workspaceId,
      requirement_ref: requirementRef,
      target_url: targetUrl,
      environment_ref: environmentRef,
      test_cases: qaResults,
    });
    const summary = {
      generated: qaResults.length,
      executed: qaResults.filter((r) => r.outcome !== "not_executed").length,
      passed: qaResults.filter((r) => r.outcome === "passed").length,
      failed: qaResults.filter((r) => r.outcome === "failed").length,
      flaky: qaResults.filter((r) => r.outcome === "flaky").length,
      not_executed: qaResults.filter((r) => r.outcome === "not_executed").length,
    };
    const analysis = buildProfessionalQaAnalysis({
      test_cases: qaResults,
      generation_findings: [],
      draft_defects,
      summary,
    });

    const smartRetestAction =
      summary.failed > 0 || summary.flaky > 0 ? "targeted_retest" : "no_retest_needed";
    const coverageGapCount =
      1 + (summary.not_executed > 0 ? 1 : 0) + (draft_defects.length > 0 ? 1 : 0);
    const expert_checklist = deriveExpertChecklist({
      release_recommendation: analysis.release_recommendation,
      release_recommendation_rationale: analysis.release_recommendation_rationale,
      test_cases: qaResults,
      summary,
      draft_defect_count: draft_defects.length,
      coverage_gap_count: coverageGapCount,
      smart_retest_action: smartRetestAction,
      suite_id_present: true,
      domain_pack: assessDomainPackGate({
        ...(typeof input.start_request.input["product_root"] === "string"
          ? { product_root: input.start_request.input["product_root"] }
          : {}),
        acknowledge_domain_pack_absent: input.start_request.input["acknowledge_domain_pack_absent"] === true,
        domain_high_risk_confirmed: input.start_request.input["domain_high_risk_confirmed"] === true,
      }),
      context: "run_regression_suite",
    });

    return success(
      this.#dependencies,
      input,
      {
        suite_id: suite.id,
        label: suite.label,
        outcome: nonPassed === 0 ? "passed" : "failed",
        failed_count: nonPassed,
        case_count_run: casesToRun.length,
        case_count_suite: suite.cases.length,
        results,
        draft_defects: draft_defects.map((d) => ({ ...d })),
        release_recommendation: analysis.release_recommendation,
        release_recommendation_rationale: analysis.release_recommendation_rationale,
        residual_risks: analysis.residual_risks.map((r) => ({ ...r })),
        variant_coverage: analysis.variant_coverage.map((r) => ({ ...r })),
        summary,
        expert_checklist,
        smart_retest_suggestion:
          smartRetestAction === "no_retest_needed"
            ? {
                action: "no_retest_needed",
                message: "All executed regression cases passed.",
              }
            : {
                action: "targeted_retest",
                message: "Re-run only failed/flaky case_ids after fix.",
                failed_case_ids: qaResults.filter((r) => r.outcome === "failed").map((r) => r.test_case_id),
                flaky_case_ids: qaResults.filter((r) => r.outcome === "flaky").map((r) => r.test_case_id),
              },
      },
      [
        `suite:${suite.id}`,
        `failed:${nonPassed}`,
        `release:${analysis.release_recommendation}`,
        `draft-defects:${draft_defects.length}`,
        `claim_pass_allowed:${expert_checklist["claim_pass_allowed"] === true}`,
      ],
    );
  }
}

export type OpenApiSmokeRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class OpenApiSmokeRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: OpenApiSmokeRuntimeExecutorDependencies;

  constructor(dependencies: OpenApiSmokeRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const doc = input.start_request.input["openapi"];
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "generate_api_smoke_from_openapi requires openapi object (OpenAPI 3 JSON)."),
      };
    }
    const includeAuthz = input.start_request.input["include_authz_negatives"] === true;
    const includeWrongRole = input.start_request.input["include_wrong_role_negatives"] === true;
    const converted = openApiToApiSmokeCases(doc as JsonObject, {
      ...(includeAuthz ? { include_authz_negatives: true } : {}),
      ...(includeWrongRole ? { include_wrong_role_negatives: true } : {}),
    });
    if (!converted.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", converted.message) };
    }
    return {
      ok: true,
      value: {
        output: {
          cases: converted.cases.map((item) => ({ ...item })),
          warnings: [...converted.warnings],
          note: "Pass cases to execute_api_smoke with base_url (+ alternate_bearer_token_secret_ref when cases use auth=alternate_bearer). Path-template params are not substituted.",
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`case-count:${converted.cases.length}`],
        uncertainty: { level: "low", reasons: ["Status asserts only — no request body invention."] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`case-count:${converted.cases.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

export type DefectExportRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class DefectExportRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DefectExportRuntimeExecutorDependencies;

  constructor(dependencies: DefectExportRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input["defects"];
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "export_defects_for_tracker requires non-empty defects array."),
      };
    }
    const formatRaw = readString(input.start_request.input["format"]) ?? "markdown";
    const format: DefectExportFormat = formatRaw === "jira_description" ? "jira_description" : "markdown";
    const defects = raw as unknown as Defect[];
    const text = formatDefectsForTracker(defects, format);
    const evidence_packs = defects.map((defect) => ({
      defect_id: defect.id,
      ...buildDefectEvidencePack(defect),
    }));
    const quality_warnings = deriveDefectExportQualityWarnings(defects);
    return {
      ok: true,
      value: {
        output: { format, text, defect_count: raw.length, evidence_packs, quality_warnings },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`defect-count:${raw.length}`],
        uncertainty: {
          level: "low",
          reasons: ["Export text + evidence pack — does not file to Jira/Linear; Host pastes or integrates."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`defect-count:${raw.length}`, `format:${format}`, `evidence-packs:${evidence_packs.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

export type DefectFileRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  credentials?: WorkspaceCredentialRegistry;
}>;

export class DefectFileRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DefectFileRuntimeExecutorDependencies;

  constructor(dependencies: DefectFileRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input["defects"];
    if (!Array.isArray(raw) || raw.length === 0) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "file_defects_to_tracker requires non-empty defects array."),
      };
    }
    const providerRaw = readString(input.start_request.input["provider"]) ?? "webhook";
    if (providerRaw !== "jira_rest" && providerRaw !== "linear_graphql" && providerRaw !== "webhook") {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "provider must be jira_rest | linear_graphql | webhook."),
      };
    }
    const provider = providerRaw as DefectTrackerProvider;
    const baseUrl = readString(input.start_request.input["base_url"]);
    if (baseUrl === undefined) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "base_url is required.") };
    }
    const projectOrTeam = readString(input.start_request.input["project_or_team"]) ?? "";
    const bearer = resolveBearerToken({
      registry: this.#dependencies.credentials,
      workspaceId: input.reference.workspace_id,
      ...(readString(input.start_request.input["bearer_token"]) !== undefined
        ? { token: readString(input.start_request.input["bearer_token"])! }
        : {}),
      ...(readString(input.start_request.input["bearer_token_secret_ref"]) !== undefined
        ? { token_secret_ref: readString(input.start_request.input["bearer_token_secret_ref"])! }
        : {}),
    });
    if (!bearer.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", bearer.message) };
    }
    if (bearer.value === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "bearer_token or bearer_token_secret_ref is required (never invent tokens).",
        ),
      };
    }

    const filed = await fileDefectsToTracker({
      defects: raw as unknown as Defect[],
      provider,
      base_url: baseUrl,
      bearer_token: bearer.value,
      project_or_team: projectOrTeam,
      confirm_file: input.start_request.input["confirm_file"] === true,
      ...(readString(input.start_request.input["jira_issue_type"]) !== undefined
        ? { jira_issue_type: readString(input.start_request.input["jira_issue_type"])! }
        : {}),
    });
    if (!filed.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", filed.message) };
    }

    return {
      ok: true,
      value: {
        output: {
          dry_run: filed.value.dry_run,
          provider: filed.value.provider,
          base_url: filed.value.base_url,
          honesty: filed.value.honesty,
          payloads: filed.value.payloads.map((payload) => ({
            defect_id: payload.defect_id,
            method: payload.method,
            url: payload.url,
            body: payload.body as JsonValue,
          })),
          results: filed.value.results.map((result) => ({
            defect_id: result.defect_id,
            ok: result.ok,
            message: result.message,
            ...(result.remote_id !== undefined ? { remote_id: result.remote_id } : {}),
            ...(result.remote_url !== undefined ? { remote_url: result.remote_url } : {}),
            ...(result.status !== undefined ? { status: result.status } : {}),
          })),
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`defect-count:${raw.length}`, `provider:${provider}`, `dry-run:${filed.value.dry_run}`],
        uncertainty: {
          level: filed.value.dry_run ? "low" : "medium",
          reasons: [filed.value.honesty],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: filed.value.dry_run ? 0 : raw.length, retries: 0 },
        evidence: [
          `defect-count:${raw.length}`,
          `provider:${provider}`,
          `dry-run:${filed.value.dry_run}`,
          ...filed.value.results.map((result) => `defect:${result.defect_id}:${result.ok ? "ok" : "fail"}`),
        ],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

export type KnowledgeRegisterRuntimeExecutorDependencies = Readonly<{
  knowledge: FileBackedKnowledgeSearch;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class KnowledgeRegisterRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: KnowledgeRegisterRuntimeExecutorDependencies;

  constructor(dependencies: KnowledgeRegisterRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const knowledgeRef = readString(input.start_request.input["knowledge_ref"]);
    const title = readString(input.start_request.input["title"]);
    const excerpt = readString(input.start_request.input["excerpt"]);
    if (knowledgeRef === undefined || title === undefined || excerpt === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "register_knowledge_record requires knowledge_ref, title, and excerpt.",
        ),
      };
    }
    const upserted = this.#dependencies.knowledge.upsertRecord({
      workspace_id: input.reference.workspace_id,
      knowledge_snapshot: "0.1.0",
      knowledge_ref: knowledgeRef,
      title,
      excerpt,
      authority_status: readString(input.start_request.input["authority_status"]) ?? "accepted",
      scopes: readStringArray(input.start_request.input["scopes"]) ?? ["product-context"],
      applicability: { workspace_id: input.reference.workspace_id },
      provenance: readStringArray(input.start_request.input["provenance"]) ?? ["mcp:register_knowledge_record"],
      evidence: readStringArray(input.start_request.input["evidence"]) ?? [],
    });
    if (!upserted.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", upserted.message) };
    }

    return {
      ok: true,
      value: {
        output: {
          knowledge_ref: knowledgeRef,
          persisted_path: upserted.persisted_path,
          count: upserted.count,
          note: "Durable under .qa-knowledge/ — not a governed multi-tenant Knowledge Store. Never invent product truth.",
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`knowledge:${knowledgeRef}`],
        uncertainty: { level: "low", reasons: ["Caller-authored knowledge only — not LLM-invented."] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`knowledge:${knowledgeRef}`, `persisted:${upserted.persisted_path}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

export type CompareUiSurfacesRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class CompareUiSurfacesRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: CompareUiSurfacesRuntimeExecutorDependencies;

  constructor(dependencies: CompareUiSurfacesRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const elementsA = readElements(input.start_request.input["elements_a"]);
    const elementsB = readElements(input.start_request.input["elements_b"]);
    if (elementsA === undefined || elementsB === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "compare_ui_surfaces requires elements_a and elements_b arrays from prior discovery.",
        ),
      };
    }
    const labelA = readString(input.start_request.input["label_a"]) ?? "surface_a";
    const labelB = readString(input.start_request.input["label_b"]) ?? "surface_b";
    const compared = compareUiSurfaces({
      label_a: labelA,
      label_b: labelB,
      elements_a: elementsA,
      elements_b: elementsB,
    });
    return {
      ok: true,
      value: {
        output: { ...compared },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [compared.summary],
        uncertainty: {
          level: "low",
          reasons: ["Compares named controls only — Host must supply maps from distinct role sessions."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [
          `only-a:${compared.only_in_a.length}`,
          `only-b:${compared.only_in_b.length}`,
          `shared:${compared.shared.length}`,
        ],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

export type RoleSurfaceCompareRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  discoverAfterLogin: DiscoverAfterLogin;
  credentials?: WorkspaceCredentialRegistry;
}>;

export class RoleSurfaceCompareRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RoleSurfaceCompareRuntimeExecutorDependencies;

  constructor(dependencies: RoleSurfaceCompareRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const roleA = parseRoleSession(input.start_request.input["role_a"], "role_a");
    const roleB = parseRoleSession(input.start_request.input["role_b"], "role_b");
    if (!roleA.ok) return { ok: false, failure: failure("orchestration", "invalid_request", roleA.message) };
    if (!roleB.ok) return { ok: false, failure: failure("orchestration", "invalid_request", roleB.message) };

    const resolvedA = resolveRolePassword(roleA.value, this.#dependencies.credentials, input.reference.workspace_id);
    if (!resolvedA.ok) return { ok: false, failure: failure("orchestration", "invalid_request", resolvedA.message) };
    const resolvedB = resolveRolePassword(roleB.value, this.#dependencies.credentials, input.reference.workspace_id);
    if (!resolvedB.ok) return { ok: false, failure: failure("orchestration", "invalid_request", resolvedB.message) };

    const compared = await discoverAndCompareRoleSurfaces(
      { discoverAfterLogin: this.#dependencies.discoverAfterLogin },
      {
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        role_a: resolvedA.value,
        role_b: resolvedB.value,
      },
    );
    if (!compared.ok) {
      return {
        ok: false,
        failure: failure(
          compared.failure.class === "authorization" ? "policy" : "infrastructure",
          compared.failure.class === "authorization" ? "authorization_denied" : "infrastructure_failure",
          compared.failure.message,
          compared.failure.retryable,
          compared.failure.evidence,
        ),
      };
    }

    const { value } = compared;
    return {
      ok: true,
      value: {
        output: {
          label_a: value.label_a,
          label_b: value.label_b,
          map_a: { ...value.map_a, elements: value.map_a.elements.map((el) => ({ ...el })) },
          map_b: { ...value.map_b, elements: value.map_b.elements.map((el) => ({ ...el })) },
          diff: { ...value.diff },
          note: "Orchestrated dual after-login capture + named-control diff — not a permission model.",
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["discover_ui_surface_after_login×2"],
        citations: [value.diff.summary],
        uncertainty: {
          level: "low",
          reasons: ["Diff is named-control only; Host interprets authz meaning."],
        },
        policy_events: [],
        usage: { steps: 2, duration_seconds: 0, tool_calls: 2, retries: 0 },
        evidence: [
          `only-a:${value.diff.only_in_a.length}`,
          `only-b:${value.diff.only_in_b.length}`,
          `shared:${value.diff.shared.length}`,
        ],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

type RoleSessionWithSecret = RoleSessionLogin & { password_secret_ref?: string };

function parseRoleSession(
  value: JsonValue | undefined,
  label: string,
): Readonly<{ ok: true; value: RoleSessionWithSecret }> | Readonly<{ ok: false; message: string }> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: `${label} must be an object.` };
  }
  const obj = value as JsonObject;
  const roleLabel = readString(obj["label"]) ?? label;
  const loginUrl = readString(obj["login_url"]);
  const targetUrl = readString(obj["target_url"]);
  if (loginUrl === undefined || targetUrl === undefined) {
    return { ok: false, message: `${label} requires login_url and target_url.` };
  }
  return {
    ok: true,
    value: {
      label: roleLabel,
      login_url: loginUrl,
      target_url: targetUrl,
      ...(readString(obj["username_field_name"]) !== undefined
        ? { username_field_name: readString(obj["username_field_name"])! }
        : {}),
      ...(readString(obj["username"]) !== undefined ? { username: readString(obj["username"])! } : {}),
      ...(readString(obj["password_field_name"]) !== undefined
        ? { password_field_name: readString(obj["password_field_name"])! }
        : {}),
      ...(readString(obj["password"]) !== undefined ? { password: readString(obj["password"])! } : {}),
      ...(readString(obj["password_secret_ref"]) !== undefined
        ? { password_secret_ref: readString(obj["password_secret_ref"])! }
        : {}),
      ...(readString(obj["submit_action_name"]) !== undefined
        ? { submit_action_name: readString(obj["submit_action_name"])! }
        : {}),
      ...(readString(obj["sso_action_name"]) !== undefined
        ? { sso_action_name: readString(obj["sso_action_name"])! }
        : {}),
      ...(readString(obj["sso_wait_url_includes"]) !== undefined
        ? { sso_wait_url_includes: readString(obj["sso_wait_url_includes"])! }
        : {}),
      ...(readString(obj["basic_auth_username"]) !== undefined
        ? { basic_auth_username: readString(obj["basic_auth_username"])! }
        : {}),
      ...(readString(obj["basic_auth_password"]) !== undefined
        ? { basic_auth_password: readString(obj["basic_auth_password"])! }
        : {}),
    },
  };
}

function resolveRolePassword(
  role: RoleSessionWithSecret,
  credentials: WorkspaceCredentialRegistry | undefined,
  workspaceId: string,
): Readonly<{ ok: true; value: RoleSessionLogin }> | Readonly<{ ok: false; message: string }> {
  if (role.sso_action_name) {
    const { password_secret_ref: _drop, ...rest } = role;
    return { ok: true, value: rest };
  }
  const passwordResolved = resolvePasswordInput({
    registry: credentials,
    workspaceId,
    ...(role.password !== undefined ? { password: role.password } : {}),
    ...(role.password_secret_ref !== undefined ? { password_secret_ref: role.password_secret_ref } : {}),
  });
  if (!passwordResolved.ok) return { ok: false, message: passwordResolved.message };
  const { password_secret_ref: _drop, ...rest } = role;
  return {
    ok: true,
    value: {
      ...rest,
      password: passwordResolved.value,
    },
  };
}

function success(
  dependencies: RegressionSuiteRuntimeExecutorDependencies,
  input: AgentRunExecutorInput,
  output: JsonObject,
  evidence: readonly string[],
): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output,
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: `${dependencies.expected_agent.id}@${dependencies.expected_agent.version}`,
        policy: input.start_request.policy_version,
        skill: `${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`,
      },
      rule_results: [],
      skill_usage: [`${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`],
      tool_usage: [],
      citations: [...evidence],
      uncertainty: { level: "none", reasons: [] },
      policy_events: [],
      usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
      evidence: [...evidence],
      cleanup_status: "not_required",
      knowledge_candidates: [],
    },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: Readonly<{ expected_agent: VersionReference; expected_skill: VersionReference }>,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

function parseRegressionCases(value: JsonValue | undefined): readonly RegressionCase[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const cases: RegressionCase[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    if (obj["kind"] === "api") {
      const apiCase = obj["case"];
      if (apiCase === null || typeof apiCase !== "object" || Array.isArray(apiCase)) return undefined;
      cases.push({ kind: "api", case: apiCase as unknown as ApiSmokeCase });
      continue;
    }
    if (obj["kind"] === "browser") {
      const testCase = obj["test_case"];
      const assertion = obj["generated_assertion"];
      if (
        testCase === null ||
        typeof testCase !== "object" ||
        Array.isArray(testCase) ||
        assertion === null ||
        typeof assertion !== "object" ||
        Array.isArray(assertion)
      ) {
        return undefined;
      }
      cases.push({
        kind: "browser",
        test_case: testCase as unknown as TestCase,
        generated_assertion: assertion as unknown as TestCaseGeneratedAssertion,
      });
      continue;
    }
    return undefined;
  }
  return cases;
}

function readElements(value: JsonValue | undefined): readonly SemanticUiElement[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const elements: SemanticUiElement[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    if (typeof obj["id"] !== "string" || typeof obj["kind"] !== "string") return undefined;
    if (obj["kind"] !== "page" && obj["kind"] !== "field" && obj["kind"] !== "action") return undefined;
    elements.push({
      id: obj["id"],
      kind: obj["kind"],
      source_node_id: typeof obj["source_node_id"] === "string" ? obj["source_node_id"] : `node:${obj["id"]}`,
      confidence: typeof obj["confidence"] === "number" ? obj["confidence"] : 1,
      ...(typeof obj["accessible_name"] === "string" ? { accessible_name: obj["accessible_name"] } : {}),
      ...(typeof obj["accessible_role"] === "string" ? { accessible_role: obj["accessible_role"] } : {}),
    });
  }
  return elements;
}

function readFieldValuesMap(value: JsonValue | undefined): ReadonlyMap<string, string> | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const map = new Map<string, string>();
  for (const [key, raw] of Object.entries(value as JsonObject)) {
    if (typeof raw === "string" && key.trim().length > 0) map.set(key.trim(), raw);
  }
  return map.size > 0 ? map : undefined;
}

function filterRegressionCases(
  cases: readonly RegressionCase[],
  caseIds: readonly string[] | undefined,
  relatedDefectIds: readonly string[] | undefined,
): readonly RegressionCase[] {
  let filtered = [...cases];
  if (caseIds !== undefined && caseIds.length > 0) {
    const wanted = new Set(caseIds);
    filtered = filtered.filter((item) => {
      const id = item.kind === "api" ? item.case.id : item.test_case.id;
      return wanted.has(id);
    });
  }
  if (relatedDefectIds !== undefined && relatedDefectIds.length > 0) {
    // DEF-DRAFT:<test_case_id> → extract suffix; also accept raw test ids.
    const wanted = new Set<string>();
    for (const ref of relatedDefectIds) {
      const trimmed = ref.trim();
      wanted.add(trimmed);
      const draftPrefix = "DEF-DRAFT:";
      if (trimmed.startsWith(draftPrefix)) wanted.add(trimmed.slice(draftPrefix.length));
    }
    filtered = filtered.filter((item) => {
      const id = item.kind === "api" ? item.case.id : item.test_case.id;
      return wanted.has(id);
    });
  }
  return filtered;
}

/**
 * Pre-export quality gate — non-blocking but surfaces integrity issues
 * before a defect is pasted/filed to an external tracker.
 */
function deriveDefectExportQualityWarnings(defects: readonly Defect[]): readonly JsonObject[] {
  const warnings: JsonObject[] = [];

  const withConfirmedCause = defects.filter((d) => d.confirmed_cause != null && d.confirmed_cause !== "");
  if (withConfirmedCause.length > 0) {
    warnings.push({
      rule: "no_confirmed_cause",
      severity: "high",
      message: `${withConfirmedCause.length} defect(s) have confirmed_cause set — this pipeline never confirms root cause. Review before filing.`,
      defect_ids: withConfirmedCause.map((d) => d.id),
    });
  }

  const noEvidence = defects.filter((d) => !d.evidence || d.evidence.length === 0);
  if (noEvidence.length > 0) {
    warnings.push({
      rule: "evidence_required",
      severity: "medium",
      message: `${noEvidence.length} defect(s) have no evidence (screenshot/trace). Hard to reproduce without it.`,
      defect_ids: noEvidence.map((d) => d.id),
    });
  }

  const draftStatus = defects.filter((d) => d.status !== "draft");
  if (draftStatus.length > 0) {
    warnings.push({
      rule: "export_from_draft_only",
      severity: "low",
      message: `${draftStatus.length} defect(s) have status other than "draft" — verify these are intentionally being re-exported.`,
      defect_ids: draftStatus.map((d) => d.id),
    });
  }

  return warnings;
}

function mapQaOutcome(raw: string): QaRunTestCaseOutcome {
  if (raw === "passed" || raw === "failed" || raw === "flaky" || raw === "not_executed") return raw;
  if (raw === "cancelled" || raw === "skipped" || raw === "blocked") return "not_executed";
  return "failed";
}

function regressionRow(
  kind: "browser" | "api",
  caseId: string,
  outcome: QaRunTestCaseOutcome,
  message: string,
  evidence: readonly string[],
  purpose?: string,
): Readonly<{ json: JsonObject; qa: QaRunTestCaseResult }> {
  return {
    json: {
      kind,
      case_id: caseId,
      outcome,
      message,
      evidence: [...evidence],
    },
    qa: {
      test_case_id: caseId,
      purpose: purpose ?? `Regression ${kind} case ${caseId}`,
      variant: "regression",
      outcome,
      ...(outcome === "not_executed" && message ? { skip_reason: message } : {}),
      evidence,
    },
  };
}
