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
import { formatDefectsForTracker, type DefectExportFormat } from "../bug-analysis/format-defects-for-tracker.js";
import { fileDefectsToTracker, type DefectTrackerProvider } from "../bug-analysis/file-defects-to-tracker.js";
import type { FileBackedKnowledgeSearch } from "../knowledge/file-backed-knowledge-search.js";
import { resolveBearerToken } from "../credentials/resolve-secret-input.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import type { Defect } from "../bug-analysis/public.js";
import { compareUiSurfaces } from "../discovery/compare-ui-surfaces.js";
import type { SemanticUiElement } from "../discovery/public.js";
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

    const results: JsonObject[] = [];
    let failed = 0;
    for (const item of suite.cases) {
      if (item.kind === "api") {
        if (this.#dependencies.apiSmoke === undefined) {
          results.push({ kind: "api", case_id: item.case.id, outcome: "not_executed", message: "API smoke skill not wired." });
          failed += 1;
          continue;
        }
        const baseUrl =
          readString(input.start_request.input["base_url"]) ??
          suite.base_url;
        if (baseUrl === undefined) {
          results.push({ kind: "api", case_id: item.case.id, outcome: "not_executed", message: "base_url required for API cases." });
          failed += 1;
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
          results.push({ kind: "api", case_id: item.case.id, outcome: "failed", message: run.failure.message });
          failed += 1;
          continue;
        }
        const caseResult = run.value.cases[0];
        results.push({
          kind: "api",
          case_id: item.case.id,
          outcome: caseResult?.outcome ?? run.value.outcome,
          message: caseResult?.message ?? "",
        });
        if ((caseResult?.outcome ?? run.value.outcome) !== "passed") failed += 1;
        continue;
      }

      const converted = testCaseToExecutionPlan(item.test_case, [item.generated_assertion]);
      if (!converted.ok) {
        results.push({
          kind: "browser",
          case_id: item.test_case.id,
          outcome: "not_executed",
          message: converted.failure.message,
        });
        failed += 1;
        continue;
      }

      const screenshotDir = join(process.cwd(), ".qa-screenshots", input.execution.operation_id, item.test_case.id);
      await mkdir(screenshotDir, { recursive: true }).catch(() => undefined);
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
        results.push({
          kind: "browser",
          case_id: item.test_case.id,
          outcome: "failed",
          message: executed.failure.message,
        });
        failed += 1;
        continue;
      }
      results.push({
        kind: "browser",
        case_id: item.test_case.id,
        outcome: executed.value.outcome ?? "indeterminate",
        message: `evidence:${executed.value.evidence?.length ?? 0}`,
      });
      if (executed.value.outcome !== "passed") failed += 1;
    }

    return success(
      this.#dependencies,
      input,
      {
        suite_id: suite.id,
        label: suite.label,
        outcome: failed === 0 ? "passed" : "failed",
        failed_count: failed,
        results,
      },
      [`suite:${suite.id}`, `failed:${failed}`],
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
    const text = formatDefectsForTracker(raw as unknown as Defect[], format);
    return {
      ok: true,
      value: {
        output: { format, text, defect_count: raw.length },
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
          reasons: ["Export text only — does not file to Jira/Linear; Host pastes or integrates."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`defect-count:${raw.length}`, `format:${format}`],
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
