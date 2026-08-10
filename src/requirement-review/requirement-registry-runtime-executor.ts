/**
 * MCP adapters for Requirement ingest (SPEC-202 register path).
 */
import type { InMemoryRequirementResolver } from "../adapters/memory/requirement-resolver.js";
import type {
  JsonObject,
  JsonValue,
  Requirement,
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

export type RequirementRegistryRuntimeExecutorDependencies = Readonly<{
  resolver: InMemoryRequirementResolver;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list";
  authorizer?: WorkspaceAuthorizer;
}>;

export class RequirementRegistryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RequirementRegistryRuntimeExecutorDependencies;

  constructor(dependencies: RequirementRegistryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const permission = this.#dependencies.mode === "register" ? "requirement:create" : "requirement:read";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: this.#dependencies.mode === "register" ? "register requirement" : "list requirements",
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
      const requirements = this.#dependencies.resolver.list();
      return {
        ok: true,
        value: {
          output: { workspace_id: workspaceId, requirements: [...requirements] },
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
          evidence: [`workspace:${workspaceId}`, `requirement-count:${requirements.length}`],
          cleanup_status: "not_required",
          knowledge_candidates: [],
        },
      };
    }

    const raw = input.start_request.input["requirement"];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "register_requirement requires a requirement object."),
      };
    }
    const requirement = normalizeRequirement(raw as JsonObject, workspaceId);
    if (!requirement.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", requirement.message) };
    }
    const registered = this.#dependencies.resolver.register(requirement.value);
    if (!registered.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", registered.message) };
    }

    return {
      ok: true,
      value: {
        output: { requirement_ref: registered.ref, title: requirement.value.title, status: requirement.value.status },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`workspace:${workspaceId}`, registered.ref],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`workspace:${workspaceId}`, `requirement-ref:${registered.ref}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function normalizeRequirement(
  raw: JsonObject,
  workspaceId: string,
): Readonly<{ ok: true; value: Requirement }> | Readonly<{ ok: false; message: string }> {
  const id = readString(raw["id"]);
  const version = readString(raw["version"]) ?? "1.0.0";
  const title = readString(raw["title"]);
  const statement = readString(raw["statement"]);
  const owner = readString(raw["owner"]) ?? "unassigned";
  const capabilityId = readString(raw["capability_id"]) ?? "unspecified";
  if (id === undefined || title === undefined || statement === undefined) {
    return { ok: false, message: "requirement requires id, title, and statement." };
  }
  const statusRaw = readString(raw["status"]) ?? "draft";
  const status = (
    [
      "draft",
      "in_review",
      "accepted",
      "implemented",
      "verified",
      "deprecated",
      "superseded",
    ] as const
  ).find((item) => item === statusRaw);
  if (status === undefined) {
    return { ok: false, message: `Invalid requirement.status "${statusRaw}".` };
  }
  const acceptance = Array.isArray(raw["acceptance_criteria"])
    ? (raw["acceptance_criteria"] as JsonObject[])
    : [];
  const source = readStringArray(raw["source"]) ?? ["mcp:register_requirement"];
  const traceability = Array.isArray(raw["traceability"])
    ? (raw["traceability"] as Requirement["traceability"])
    : [];

  const assumptions = readStringArray(raw["assumptions"]);
  const rationale = readString(raw["rationale"]);

  return {
    ok: true,
    value: {
      id,
      version,
      status,
      title,
      statement,
      source,
      owner,
      capability_id: capabilityId,
      scope: { workspace_id: workspaceId },
      acceptance_criteria: acceptance,
      ...(assumptions !== undefined ? { assumptions } : {}),
      ...(rationale !== undefined ? { rationale } : {}),
      traceability,
    },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RequirementRegistryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the requirement registry executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Requirement registry Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function versions(
  dependencies: RequirementRegistryRuntimeExecutorDependencies,
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
