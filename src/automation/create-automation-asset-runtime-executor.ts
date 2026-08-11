/**
 * MCP adapter for SPEC-209 create_automation_asset stub.
 * Persists under `.qa-automation-assets/` and defaults execution_interface
 * to `mcp:run_regression_suite`.
 */
import { createAutomationAssetStub } from "./create-automation-asset-stub.js";
import { persistAutomationAsset } from "./persist-automation-asset.js";
import type { JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type AutomationAssetStubRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  authorizer?: WorkspaceAuthorizer;
  /** When set, write asset JSON under this root (workspace subdir). */
  persistRootDir?: string;
}>;

export class AutomationAssetStubRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: AutomationAssetStubRuntimeExecutorDependencies;

  constructor(dependencies: AutomationAssetStubRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: "create automation asset stub",
        consequence_class: "reversible",
        required_permissions: ["automation_asset:create"],
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

    const refs = readStringArray(input.start_request.input["implemented_test_case_refs"]);
    if (refs === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "create_automation_asset requires implemented_test_case_refs (non-empty string array).",
        ),
      };
    }

    const owner = readString(input.start_request.input["owner"]);
    const id = readString(input.start_request.input["id"]);
    const constraints = readStringArray(input.start_request.input["environment_constraints"]);
    const executionInterface = readString(input.start_request.input["execution_interface"]);
    const regressionSuiteId = readString(input.start_request.input["regression_suite_id"]);

    const created = createAutomationAssetStub({
      workspace_id: workspaceId,
      implemented_test_case_refs: refs,
      ...(owner !== undefined ? { owner } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(constraints !== undefined ? { environment_constraints: constraints } : {}),
      ...(executionInterface !== undefined ? { execution_interface: executionInterface } : {}),
      ...(regressionSuiteId !== undefined ? { regression_suite_id: regressionSuiteId } : {}),
    });
    if (!created.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", created.message) };
    }

    let persistedPath: string | undefined;
    if (this.#dependencies.persistRootDir !== undefined) {
      const persisted = persistAutomationAsset({
        rootDir: this.#dependencies.persistRootDir,
        workspace_id: workspaceId,
        asset: created.asset,
      });
      persistedPath = persisted.persisted_path;
    }

    return {
      ok: true,
      value: {
        output: {
          ...created.asset,
          ...(persistedPath !== undefined ? { persisted_path: persistedPath } : {}),
          run_hint:
            "Re-execute bound cases via run_regression_suite (pass regression_suite_id when registered).",
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
        citations: [
          `workspace:${workspaceId}`,
          created.asset.id,
          ...refs,
          ...(persistedPath !== undefined ? [`persisted:${persistedPath}`] : []),
        ],
        uncertainty: {
          level: "low",
          reasons: [
            "Governance stub bound to mcp:run_regression_suite — not a compiled script package.",
          ],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [
          `workspace:${workspaceId}`,
          `automation-asset:${created.asset.id}`,
          `execution-interface:${created.asset.execution_interface}`,
          ...(persistedPath !== undefined ? [`persisted:${persistedPath}`] : []),
        ],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: AutomationAssetStubRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the automation asset stub executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Automation asset stub Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
  return items.length > 0 ? items : undefined;
}
