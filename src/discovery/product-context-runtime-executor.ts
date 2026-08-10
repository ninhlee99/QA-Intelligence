/**
 * Runtime adapter for DiscoverProductContext (SPEC-201 knowledge-store path).
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import type { DiscoverProductContext } from "./discover-product-context.js";
import type { DiscoveryFailure, DiscoveryReport } from "./public.js";

export type ProductContextDiscoveryRuntimeExecutorDependencies = Readonly<{
  skill: DiscoverProductContext;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class ProductContextDiscoveryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ProductContextDiscoveryRuntimeExecutorDependencies;

  constructor(dependencies: ProductContextDiscoveryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input;
    const objective = typeof raw["objective"] === "string" ? raw["objective"].trim() : "";
    if (!objective) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "discover_product_context requires a non-empty objective."),
      };
    }

    const scopesRaw = raw["knowledge_scopes"];
    let knowledge_scopes: string[];
    if (Array.isArray(scopesRaw) && scopesRaw.length > 0) {
      knowledge_scopes = [];
      for (const item of scopesRaw) {
        if (typeof item !== "string" || item.trim().length === 0) {
          return {
            ok: false,
            failure: failure("orchestration", "invalid_request", "knowledge_scopes entries must be non-empty strings."),
          };
        }
        knowledge_scopes.push(item.trim());
      }
    } else {
      knowledge_scopes = ["requirements", "architecture", "risk"];
    }

    const capability_id =
      typeof raw["capability_id"] === "string" && raw["capability_id"].trim()
        ? raw["capability_id"].trim()
        : undefined;
    const knowledge_snapshot =
      typeof raw["knowledge_snapshot"] === "string" && raw["knowledge_snapshot"].trim()
        ? raw["knowledge_snapshot"].trim()
        : "0.1.0";

    const discovered = await this.#dependencies.skill.discover({
      operation_id: input.execution.operation_id,
      context: input.execution.workspace_context,
      scope: {
        workspace_id: input.reference.workspace_id,
        knowledge_scopes,
        ...(capability_id !== undefined ? { capability_id } : {}),
      },
      objective,
      knowledge_snapshot,
    });
    if (!discovered.ok) return { ok: false, failure: mapFailure(discovered.failure) };

    const report = discovered.value;
    const evidence = unique([
      `workspace:${report.workspace_id}`,
      `knowledge-snapshot:${report.knowledge_snapshot}`,
      ...report.findings.flatMap((f) => f.evidence),
    ]);

    return {
      ok: true,
      value: {
        output: reportToJson(report),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          knowledge_snapshot: report.knowledge_snapshot,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["knowledge-search@0.1.0"],
        citations: evidence,
        uncertainty: {
          level: report.findings.length === 0 ? "medium" : "low",
          reasons:
            report.findings.length === 0
              ? ["No Knowledge Store hits — surface may be empty in this Workspace seed."]
              : [],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 1, retries: 0 },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function reportToJson(report: DiscoveryReport): JsonObject {
  return {
    schema_version: report.schema_version,
    workspace_id: report.workspace_id,
    objective: report.objective,
    knowledge_snapshot: report.knowledge_snapshot,
    scope: {
      workspace_id: report.scope.workspace_id,
      knowledge_scopes: [...report.scope.knowledge_scopes],
      capability_id: report.scope.capability_id ?? null,
    },
    findings: report.findings.map((f) => ({
      id: f.id,
      basis: f.basis,
      statement: f.statement,
      evidence: [...f.evidence],
      authority_status: f.authority_status,
      relevance: f.relevance,
    })),
    known_unknown_register: report.known_unknown_register.map((e) => ({ ...e, finding_ids: [...e.finding_ids] })),
    conflict_register: report.conflict_register.map((e) => ({
      ...e,
      conflicting_finding_ids: [...e.conflicting_finding_ids],
    })),
    clarification_questions: report.clarification_questions.map((q) => ({ ...q })),
    coverage: [...report.coverage],
    limitations: [...report.limitations],
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ProductContextDiscoveryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by product-context discovery.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((s) => s.id === dependencies.expected_skill.id && s.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Discover Product Context Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function mapFailure(skillFailure: DiscoveryFailure): AgentRunFailure {
  if (skillFailure.class === "authorization") {
    return failure("policy", "authorization_denied", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  if (skillFailure.class === "knowledge") {
    return failure("infrastructure", "infrastructure_failure", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  return failure("orchestration", "invalid_request", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
}
