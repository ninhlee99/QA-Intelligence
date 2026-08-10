/**
 * MCP adapters for TestDataset registry (SPEC-208 create path).
 */
import type { InMemoryWorkspaceDatasetRegistry } from "./workspace-dataset-registry.js";
import type { TestDataClassification } from "./public.js";
import type { JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type DatasetRegistryRuntimeExecutorDependencies = Readonly<{
  registry: InMemoryWorkspaceDatasetRegistry;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list";
  authorizer?: WorkspaceAuthorizer;
}>;

export class DatasetRegistryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DatasetRegistryRuntimeExecutorDependencies;

  constructor(dependencies: DatasetRegistryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const permission = this.#dependencies.mode === "register" ? "test_dataset:create" : "test_dataset:read";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: this.#dependencies.mode === "register" ? "register test dataset" : "list test datasets",
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
      const datasets = this.#dependencies.registry.list(workspaceId);
      return {
        ok: true,
        value: {
          output: {
            workspace_id: workspaceId,
            datasets: datasets.map((dataset) => ({
              id: dataset.id,
              version: dataset.version,
              status: dataset.status,
              purpose: dataset.purpose,
              classification: dataset.classification,
              traced_test_refs: [...dataset.traced_test_refs],
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
          evidence: [`workspace:${workspaceId}`, `dataset-count:${datasets.length}`],
          cleanup_status: "not_required",
          knowledge_candidates: [],
        },
      };
    }

    const purpose = readString(input.start_request.input["purpose"]);
    if (purpose === undefined) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "register_test_dataset requires purpose."),
      };
    }
    const classification = readClassification(input.start_request.input["classification"]);
    const owner = readString(input.start_request.input["owner"]);
    const id = readString(input.start_request.input["id"]);
    const environmentScope = readString(input.start_request.input["environment_scope"]);
    const traced = readStringArray(input.start_request.input["traced_test_refs"]);

    const registered = this.#dependencies.registry.register({
      workspace_id: workspaceId,
      purpose,
      ...(classification !== undefined ? { classification } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(environmentScope !== undefined ? { environment_scope: environmentScope } : {}),
      ...(traced !== undefined ? { traced_test_refs: traced } : {}),
    });
    if (!registered.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", registered.message) };
    }

    return {
      ok: true,
      value: {
        output: { ...registered.dataset },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`workspace:${workspaceId}`, registered.dataset.id],
        uncertainty: { level: "low", reasons: ["Registry stores governance metadata only — not executable row payloads."] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`workspace:${workspaceId}`, `dataset:${registered.dataset.id}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DatasetRegistryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the dataset registry executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Dataset registry Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function versions(
  dependencies: DatasetRegistryRuntimeExecutorDependencies,
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

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
  return items.length > 0 ? items : undefined;
}

function readClassification(value: JsonValue | undefined): TestDataClassification | undefined {
  if (typeof value !== "string") return undefined;
  const allowed: TestDataClassification[] = [
    "synthetic",
    "generated_from_template",
    "masked_production_derived",
    "reference",
    "seeded_environment",
    "ephemeral_execution",
    "adversarial_and_boundary",
    "ai_evaluation_dataset",
  ];
  return allowed.find((item) => item === value.trim());
}
