/**
 * SPEC-105 §9a MCP seam: raiseMistakeRecurrenceCandidate — never promotes.
 */
import { raiseMistakeRecurrenceCandidate } from "./public.js";
import type { MistakeOccurrence, RecurrenceAssessment } from "./mistake-recurrence.js";
import type { CandidateRepository } from "../candidate-repository/public.js";
import type { FailureAvoidanceTrigger } from "../memory/failure-avoidance.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type RaiseMistakeRecurrenceCandidateRuntimeExecutorDependencies = Readonly<{
  candidateRepository: CandidateRepository;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class RaiseMistakeRecurrenceCandidateRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RaiseMistakeRecurrenceCandidateRuntimeExecutorDependencies;

  constructor(dependencies: RaiseMistakeRecurrenceCandidateRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const occurrence = readOccurrence(input.start_request.input["occurrence"], input.reference.workspace_id);
    if (occurrence === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "raise_mistake_recurrence_candidate requires occurrence { causal_mistake_key, trigger, source_ref, occurred_at? }.",
        ),
      };
    }

    const assessment = readAssessment(input.start_request.input["assessment"]);
    if (assessment === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "assessment must be { recurring:false } or { recurring:true, occurrence_count, affected_runs, first_observed_at }.",
        ),
      };
    }

    const causalMistake = readString(input.start_request.input["causal_mistake"]) ?? occurrence.causal_mistake_key;
    const owner = readString(input.start_request.input["owner"]) ?? "qa-intelligence-learning-stub";
    const expiresAt =
      readString(input.start_request.input["expires_at"]) ??
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const idempotencyKey =
      readString(input.start_request.input["idempotency_key"]) ??
      `mistake-recurrence:${occurrence.causal_mistake_key}:${input.execution.operation_id}`;
    const priorRefs = readStringArray(input.start_request.input["prior_avoidance_fact_refs"]) ?? [];

    const raised = await raiseMistakeRecurrenceCandidate(this.#dependencies.candidateRepository, {
      context: input.execution.workspace_context,
      occurrence,
      assessment,
      causal_mistake: causalMistake,
      prior_avoidance_fact_refs: priorRefs,
      owner,
      expires_at: expiresAt,
      idempotency_key: idempotencyKey,
    });

    if (!raised.ok) {
      return {
        ok: false,
        failure: failure(
          raised.failure.code === "not_recurring" ? "orchestration" : "skill",
          raised.failure.code === "not_recurring" ? "invalid_request" : "skill_failure",
          raised.failure.message,
          raised.failure.retryable,
        ),
      };
    }

    return {
      ok: true,
      value: {
        output: {
          candidate_id: raised.value.id,
          status: raised.value.status,
          discovery_source: raised.value.discovery_source,
          rationale: raised.value.rationale,
          supporting_evidence_refs: [...raised.value.supporting_evidence_refs],
          note: "Candidate created only — never promoted to accepted knowledge by this tool.",
        } as JsonObject,
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["candidate-repository"],
        citations: [`workspace:${input.reference.workspace_id}`, raised.value.id],
        uncertainty: {
          level: "medium",
          reasons: ["Single-signal recurrence; human validation required before any promotion (SPEC-105 §9a)."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 1, retries: 0 },
        evidence: [`candidate:${raised.value.id}`, `causal:${occurrence.causal_mistake_key}`],
        cleanup_status: "not_required",
        knowledge_candidates: [raised.value.id],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RaiseMistakeRecurrenceCandidateRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the learning-engine executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Learning-engine Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
  return items.length > 0 ? items : undefined;
}

function readOccurrence(value: JsonValue | undefined, workspaceId: string): MistakeOccurrence | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as JsonObject;
  const causal = readString(obj["causal_mistake_key"]);
  const trigger = readTrigger(obj["trigger"]);
  const sourceRef = readString(obj["source_ref"]);
  if (causal === undefined || trigger === undefined || sourceRef === undefined) return undefined;
  return {
    workspace_id: workspaceId,
    causal_mistake_key: causal,
    trigger,
    source_ref: sourceRef,
    occurred_at: readString(obj["occurred_at"]) ?? new Date().toISOString(),
  };
}

function readTrigger(value: JsonValue | undefined): FailureAvoidanceTrigger | undefined {
  if (typeof value !== "string") return undefined;
  const allowed: FailureAvoidanceTrigger[] = [
    "defect",
    "incorrect_verdict",
    "blocked_execution",
    "failed_execution",
    "human_corrected_decision",
  ];
  return allowed.find((item) => item === value.trim());
}

function readAssessment(value: JsonValue | undefined): RecurrenceAssessment | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as JsonObject;
  if (obj["recurring"] === false) return { recurring: false };
  if (obj["recurring"] !== true) return undefined;
  const count = obj["occurrence_count"];
  const first = readString(obj["first_observed_at"]);
  const runs = readStringArray(obj["affected_runs"]);
  if (typeof count !== "number" || !Number.isFinite(count) || count < 2 || first === undefined || runs === undefined) {
    return undefined;
  }
  return {
    recurring: true,
    occurrence_count: count,
    affected_runs: runs,
    first_observed_at: first,
  };
}
