/**
 * MCP adapter: list Learning Engine candidates (read-side, never promotes).
 */
import type { CandidateRepository } from "../candidate-repository/public.js";
import type { JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type ListLearningCandidatesRuntimeExecutorDependencies = Readonly<{
  candidateRepository: CandidateRepository;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class ListLearningCandidatesRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ListLearningCandidatesRuntimeExecutorDependencies;

  constructor(dependencies: ListLearningCandidatesRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const discoverySource =
      typeof input.start_request.input["discovery_source"] === "string" &&
      input.start_request.input["discovery_source"].trim().length > 0
        ? input.start_request.input["discovery_source"].trim()
        : "mistake-recurrence";

    const queried = await this.#dependencies.candidateRepository.query({
      context: input.execution.workspace_context,
      discovery_source: discoverySource,
    });
    if (!queried.ok) {
      return {
        ok: false,
        failure: failure(
          "infrastructure",
          "infrastructure_failure",
          queried.failure.message,
          queried.failure.retryable,
        ),
      };
    }

    const candidates = queried.value.map((candidate) => ({
      id: candidate.id,
      status: candidate.status,
      discovery_source: candidate.discovery_source,
      rationale: candidate.rationale,
      confidence: candidate.confidence,
      supporting_evidence_refs: [...candidate.supporting_evidence_refs],
      uncertainty_reasons: [...candidate.uncertainty_reasons],
    }));

    return {
      ok: true,
      value: {
        output: {
          workspace_id: input.reference.workspace_id,
          discovery_source: discoverySource,
          candidates,
          note: "Read-only — never auto-promotes. Human triage required (SPEC-105).",
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
        citations: [`candidate-count:${candidates.length}`, `source:${discoverySource}`],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`candidate-count:${candidates.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ListLearningCandidatesRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "List learning candidates Skill is not present in retained Skill authority.");
  }
  return undefined;
}
