/**
 * MCP hard refuse for pass-like host claims when expert_checklist forbids.
 */
import { validateExpertClaim } from "../reporting/expert-checklist.js";
import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type ValidateExpertClaimRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class ValidateExpertClaimRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ValidateExpertClaimRuntimeExecutorDependencies;

  constructor(dependencies: ValidateExpertClaimRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const proposed = input.start_request.input["proposed_claim"];
    if (typeof proposed !== "string" || proposed.trim().length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "validate_expert_claim requires proposed_claim string (the wording you want to tell the user).",
        ),
      };
    }
    const checklistRaw = input.start_request.input["expert_checklist"];
    if (checklistRaw === null || typeof checklistRaw !== "object" || Array.isArray(checklistRaw)) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "validate_expert_claim requires expert_checklist object from run_expert_qa or run_regression_suite.",
        ),
      };
    }

    const result = validateExpertClaim({
      proposed_claim: proposed,
      expert_checklist: checklistRaw as JsonObject,
    });

    const output: JsonObject = {
      allowed: result.allowed,
      claim_pass_allowed: result.claim_pass_allowed,
      refuse_reason: result.refuse_reason,
      normalized_claim_kind: result.normalized_claim_kind,
      host_must: [...result.host_must],
      note: result.allowed
        ? "Claim wording permitted under automation gate — human release_signoff still required."
        : "REFUSED — do not green-wash. Rewrite user-facing result as blocked/incomplete.",
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
        citations: [
          `allowed:${result.allowed}`,
          `claim_pass_allowed:${result.claim_pass_allowed}`,
        ],
        uncertainty: {
          level: result.allowed ? "low" : "none",
          reasons: result.refuse_reason !== null ? [result.refuse_reason] : [],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`allowed:${result.allowed}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: ValidateExpertClaimRuntimeExecutorDependencies,
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
