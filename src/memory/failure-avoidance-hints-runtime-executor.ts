/**
 * Phase 11 — list Session Memory failure-avoidance hints (read side of
 * SPEC-108 §7.3). Never invents mistakes; returns only unexpired `avoid:*`
 * entries retained after prior `run_auto_qa` drafts.
 */
import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type { SessionMemory } from "../memory/session-memory.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export const FAILURE_AVOIDANCE_KEY_PREFIX = "avoid:";

export type FailureAvoidanceHintsRuntimeExecutorDependencies = Readonly<{
  sessionMemory: SessionMemory;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class FailureAvoidanceHintsRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: FailureAvoidanceHintsRuntimeExecutorDependencies;

  constructor(dependencies: FailureAvoidanceHintsRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const hints = this.#dependencies.sessionMemory.list(
      input.reference.workspace_id,
      FAILURE_AVOIDANCE_KEY_PREFIX,
    );

    const output: JsonObject = {
      workspace_id: input.reference.workspace_id,
      count: hints.length,
      hints: hints.map((entry) => ({
        key: entry.key,
        causal_mistake: entry.value,
        source_ref: entry.source_ref,
        retained_at: entry.retained_at,
        expires_at: entry.expires_at,
      })),
      limitations: [
        "Hints are Session Memory fast-path only — not promoted Knowledge.",
        "Never treats suspected_cause as confirmed_cause.",
        "Empty list means no prior avoidable defects retained in this MCP process Workspace.",
      ],
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
        tool_usage: ["session-memory@0.1.0"],
        citations: hints.map((h) => h.source_ref),
        uncertainty: {
          level: hints.length === 0 ? "none" : "low",
          reasons: hints.length === 0 ? [] : ["Hints are advisory — re-verify on the live target."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`workspace:${input.reference.workspace_id}`, `avoidance-hints:${hints.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: FailureAvoidanceHintsRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the failure-avoidance hints executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Failure-avoidance hints Skill is not present in retained Skill authority.");
  }
  return undefined;
}
