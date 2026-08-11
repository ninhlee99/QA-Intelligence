/**
 * MCP adapter for bootstrap_domain_pack.
 */
import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { bootstrapDomainPack } from "./bootstrap-domain-pack.js";

export type DomainPackBootstrapRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class DomainPackBootstrapRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DomainPackBootstrapRuntimeExecutorDependencies;

  constructor(dependencies: DomainPackBootstrapRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const productRoot = readString(input.start_request.input["product_root"]);
    if (productRoot === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "bootstrap_domain_pack requires absolute product_root (app under test).",
        ),
      };
    }
    const requestContext = readString(input.start_request.input["request_context"]);
    const packDirnameRaw = readString(input.start_request.input["pack_dirname"]);
    const pack_dirname =
      packDirnameRaw === ".qa-domain" ? (".qa-domain" as const) : ("domain-knowledge" as const);

    const result = bootstrapDomainPack({
      product_root: productRoot,
      ...(requestContext !== undefined ? { request_context: requestContext } : {}),
      pack_dirname,
    });
    if (!result.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", result.message) };
    }

    const output: JsonObject = {
      pack_path: result.pack_path,
      created: result.created,
      updated_files: [...result.updated_files],
      notes: [...result.notes],
    };

    return {
      ok: true,
      value: {
        output,
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
        citations: [`pack:${result.pack_path}`],
        uncertainty: {
          level: "low",
          reasons: ["Auto-seeded domain pack — human should confirm money/permission TODOs."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`pack:${result.pack_path}`, `created:${result.created}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DomainPackBootstrapRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure("policy", "authorization_denied", "Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
