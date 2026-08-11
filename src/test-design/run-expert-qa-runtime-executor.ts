/**
 * Expert facade: optional domain pack bootstrap + full run_auto_qa pipeline
 * in one MCP tool so hosts need not chain bootstrap → run_auto_qa manually.
 */
import { bootstrapDomainPack } from "../domain-pack/bootstrap-domain-pack.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import type { RunAutoQaPipelineRuntimeExecutor } from "./run-auto-qa-pipeline-runtime-executor.js";

export type RunExpertQaRuntimeExecutorDependencies = Readonly<{
  autoQa: RunAutoQaPipelineRuntimeExecutor;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  /** Agent/skill the inner auto-qa executor validates against. */
  auto_qa_agent: VersionReference;
  auto_qa_skill: VersionReference;
}>;

export class RunExpertQaRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RunExpertQaRuntimeExecutorDependencies;

  constructor(dependencies: RunExpertQaRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const productRoot = readString(input.start_request.input["product_root"]);
    const packDirnameRaw = readString(input.start_request.input["pack_dirname"]);
    const pack_dirname =
      packDirnameRaw === ".qa-domain" ? (".qa-domain" as const) : ("domain-knowledge" as const);

    let domainPack: JsonObject;
    if (productRoot !== undefined) {
      const requestContext =
        readString(input.start_request.input["request_context"]) ??
        buildRequestContext(input.start_request.input);
      const result = bootstrapDomainPack({
        product_root: productRoot,
        ...(requestContext !== undefined ? { request_context: requestContext } : {}),
        pack_dirname,
      });
      if (!result.ok) {
        domainPack = { ok: false, message: result.message };
      } else {
        domainPack = {
          ok: true,
          pack_path: result.pack_path,
          created: result.created,
          updated_files: [...result.updated_files],
          notes: [...result.notes],
        };
      }
    } else {
      domainPack = {
        ok: false,
        skipped: true,
        reason: "product_root_absent",
        message: "Pass absolute product_root to auto-bootstrap domain-knowledge/ in this call.",
      };
    }

    const innerInput: AgentRunExecutorInput = {
      ...input,
      start_request: {
        ...input.start_request,
        agent: this.#dependencies.auto_qa_agent,
        allowed_skills: [this.#dependencies.auto_qa_skill],
        purpose: input.start_request.purpose,
      },
    };

    const autoResult = await this.#dependencies.autoQa.execute(innerInput);
    if (!autoResult.ok) return autoResult;

    const output = {
      ...(autoResult.value.output as JsonObject),
      domain_pack: domainPack,
      expert_facade: {
        tool: "run_expert_qa",
        wrapped: ["bootstrap_domain_pack?", "run_auto_qa"],
        note: "Single Expert entry — honor expert_checklist; suite_id from auto_registered_suite when present.",
      },
    };

    return {
      ok: true,
      value: {
        ...autoResult.value,
        output,
        resolved_versions: {
          ...autoResult.value.resolved_versions,
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        skill_usage: [
          `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          ...autoResult.value.skill_usage,
        ],
        citations: [
          ...autoResult.value.citations,
          ...(typeof domainPack["pack_path"] === "string" ? [`pack:${domainPack["pack_path"]}`] : []),
        ],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RunExpertQaRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by run_expert_qa.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure("policy", "authorization_denied", "run_expert_qa skill not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function buildRequestContext(input: Readonly<Record<string, JsonValue | undefined>>): string | undefined {
  const parts: string[] = [];
  const url = readString(input["url"]);
  if (url !== undefined) parts.push(`URL: ${url}`);
  const title = readString(input["requirement_title"]);
  if (title !== undefined) parts.push(`Title: ${title}`);
  const ac = input["acceptance_criteria"];
  if (Array.isArray(ac)) {
    for (const item of ac.slice(0, 8)) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const statement = readString((item as JsonObject)["statement"]);
        if (statement !== undefined) parts.push(`AC: ${statement}`);
      }
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
