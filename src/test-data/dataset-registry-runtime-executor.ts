/**
 * MCP adapters for TestDataset registry (SPEC-208 create/resolve path).
 */
import type { WorkspaceDatasetRegistry } from "./file-backed-workspace-dataset-registry.js";
import type { TestDataClassification } from "./public.js";
import type { JsonObject, JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type DatasetRegistryRuntimeExecutorDependencies = Readonly<{
  registry: WorkspaceDatasetRegistry;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list" | "resolve";
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
      const permission =
        this.#dependencies.mode === "register" ? "test_dataset:create" : "test_dataset:read";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose:
          this.#dependencies.mode === "register"
            ? "register test dataset"
            : this.#dependencies.mode === "resolve"
              ? "resolve test dataset field samples"
              : "list test datasets",
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
              field_sample_keys: dataset.field_samples ? Object.keys(dataset.field_samples) : [],
              field_sample_count: dataset.field_samples ? Object.keys(dataset.field_samples).length : 0,
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

    if (this.#dependencies.mode === "resolve") {
      const datasetId = readString(input.start_request.input["dataset_id"]);
      if (datasetId === undefined) {
        return {
          ok: false,
          failure: failure(
            "orchestration",
            "invalid_request",
            "resolve_test_dataset_fields requires dataset_id.",
          ),
        };
      }
      const dataset = this.#dependencies.registry.get(workspaceId, datasetId);
      if (dataset === undefined) {
        return {
          ok: false,
          failure: failure(
            "orchestration",
            "invalid_request",
            `Unknown dataset_id "${datasetId}" for this Workspace.`,
          ),
        };
      }
      const fieldValues = { ...(dataset.field_samples ?? {}) };
      const keys = Object.keys(fieldValues);
      return {
        ok: true,
        value: {
          output: {
            dataset_id: dataset.id,
            classification: dataset.classification,
            field_values: fieldValues,
            field_sample_keys: keys,
            note:
              keys.length === 0
                ? "Dataset has no field_samples — pass field_values manually or re-register with synthetic samples."
                : "Pass field_values to execute_generated_test_case / run_regression_suite. Secrets still use field_secret_refs.",
          },
          output_validated: true,
          satisfied_evidence_requirements: [],
          resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
          rule_results: [],
          skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
          tool_usage: [],
          citations: [`workspace:${workspaceId}`, `dataset:${dataset.id}`, `sample-keys:${keys.length}`],
          uncertainty: {
            level: keys.length === 0 ? "medium" : "low",
            reasons:
              keys.length === 0
                ? ["No synthetic field_samples on this dataset."]
                : ["Synthetic fills only — not production data."],
          },
          policy_events: [],
          usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
          evidence: [`workspace:${workspaceId}`, `dataset:${dataset.id}`, `field-count:${keys.length}`],
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
    const fieldSamples = readFieldSamples(input.start_request.input["field_samples"]);

    const registered = this.#dependencies.registry.register({
      workspace_id: workspaceId,
      purpose,
      ...(classification !== undefined ? { classification } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(environmentScope !== undefined ? { environment_scope: environmentScope } : {}),
      ...(traced !== undefined ? { traced_test_refs: traced } : {}),
      ...(fieldSamples !== undefined ? { field_samples: fieldSamples } : {}),
    });
    if (!registered.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", registered.message) };
    }

    const persistedPath =
      "persisted_path" in registered && typeof registered.persisted_path === "string"
        ? registered.persisted_path
        : undefined;

    return {
      ok: true,
      value: {
        output: {
          ...registered.dataset,
          ...(persistedPath !== undefined ? { persisted_path: persistedPath } : {}),
          field_sample_keys: registered.dataset.field_samples
            ? Object.keys(registered.dataset.field_samples)
            : [],
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [
          `workspace:${workspaceId}`,
          registered.dataset.id,
          ...(persistedPath !== undefined ? [`persisted:${persistedPath}`] : []),
        ],
        uncertainty: {
          level: "low",
          reasons: [
            registered.dataset.field_samples
              ? "Synthetic field_samples stored — secrets must use credential registry."
              : "Governance metadata registered; add field_samples (synthetic) for usable fills.",
          ],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [
          `workspace:${workspaceId}`,
          `dataset:${registered.dataset.id}`,
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

function readFieldSamples(value: JsonValue | undefined): Readonly<Record<string, string>> | undefined {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as JsonObject)) {
    if (typeof raw === "string") out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
