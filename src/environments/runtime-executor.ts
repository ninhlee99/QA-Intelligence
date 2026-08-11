/**
 * MCP adapters for Workspace environment registry (SPEC-512 §12).
 */
import type { InMemoryWorkspaceEnvironmentRegistry } from "./workspace-environment-registry.js";
import type { JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type EnvironmentRegistryRuntimeExecutorDependencies = Readonly<{
  registry: InMemoryWorkspaceEnvironmentRegistry;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list";
  authorizer?: WorkspaceAuthorizer;
}>;

export class EnvironmentRegistryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: EnvironmentRegistryRuntimeExecutorDependencies;

  constructor(dependencies: EnvironmentRegistryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const permission = this.#dependencies.mode === "register" ? "environment:register" : "environment:read";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: this.#dependencies.mode === "register" ? "register workspace environment" : "list workspace environments",
        consequence_class: this.#dependencies.mode === "register" ? "reversible" : "advisory",
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
      const records = this.#dependencies.registry.list(workspaceId);
      return {
        ok: true,
        value: {
          output: {
            workspace_id: workspaceId,
            environments: records.map((record) => ({
              environment_ref: record.environment_ref,
              base_url: record.base_url,
              label: record.label,
              registered_at: record.registered_at,
            })),
          },
          output_validated: true,
          satisfied_evidence_requirements: [],
          resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
          rule_results: [],
          skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
          tool_usage: [],
          citations: [`workspace:${workspaceId}`],
          uncertainty: { level: "none", reasons: [] },
          policy_events: [],
          usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
          evidence: [`workspace:${workspaceId}`, `environment-count:${records.length}`],
          cleanup_status: "not_required",
          knowledge_candidates: [],
        },
      };
    }

    const environmentRef = readString(input.start_request.input["environment_ref"]);
    const baseUrl = readString(input.start_request.input["base_url"]);
    if (environmentRef === undefined || baseUrl === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "register_workspace_environment requires environment_ref (environment:…) and base_url.",
        ),
      };
    }
    const label = readString(input.start_request.input["label"]);
    const registered = this.#dependencies.registry.register({
      workspace_id: workspaceId,
      environment_ref: environmentRef,
      base_url: baseUrl,
      ...(label !== undefined ? { label } : {}),
    });
    if (!registered.ok) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", registered.message),
      };
    }

    return {
      ok: true,
      value: {
        output: {
          environment_ref: registered.record.environment_ref,
          base_url: registered.record.base_url,
          label: registered.record.label,
          registered_at: registered.record.registered_at,
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`workspace:${workspaceId}`, registered.record.environment_ref],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`workspace:${workspaceId}`, `environment-ref:${registered.record.environment_ref}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: EnvironmentRegistryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the environment registry executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Environment registry Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function versions(
  dependencies: EnvironmentRegistryRuntimeExecutorDependencies,
  policyVersion: string,
): Readonly<Record<string, string>> {
  return {
    agent: `${dependencies.expected_agent.id}@${dependencies.expected_agent.version}`,
    policy: policyVersion,
    skill: `${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`,
  };
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
