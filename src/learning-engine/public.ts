import type { CandidateRepository, CandidateRepositoryFailure } from "../candidate-repository/public.js";
import type { KnowledgeCandidate } from "../knowledge/public.js";
import type { StableResult, WorkspaceContext } from "../requirement-review/public.js";
import type { MistakeOccurrence, RecurrenceAssessment } from "./mistake-recurrence.js";

/**
 * SPEC-105 (Learning Engine) tracer bullet, scoped to §9a (Mistake and
 * Failure-Recurrence Prevention) — the engine's §6 workflow's "Create
 * Candidate" step for this one signal type. Observe/Normalize/Detect
 * Pattern/Form Hypothesis/Collect Evidence are `MistakeRecurrenceTracker`'s
 * job (`./mistake-recurrence.js`); Human Validation/Promote/Reject/Expire
 * are `CandidateRepository`'s existing lifecycle operations (SPEC-403,
 * already built). This module is only the seam between the two: it never
 * invents evidence, never promotes, and rejects a non-recurring assessment
 * outright rather than silently downgrading it into a candidate (§9a: "a
 * single occurrence... is not for this engine's full candidate lifecycle").
 *
 * §8 general pattern detection, §9's 8-signal drift detection, §10's full
 * validation criteria, §13 feedback-loop governance, §14's full bias/
 * data-quality assessment, and §15 AI-governance recording (this slice has
 * no AI-assisted step) are explicitly out of scope for this tracer bullet.
 */
export type RaiseMistakeRecurrenceCandidateRequest = Readonly<{
  context: WorkspaceContext;
  occurrence: MistakeOccurrence;
  assessment: RecurrenceAssessment;
  causal_mistake: string;
  /** SPEC-105 §9a: "prior avoidance-fact history" — SessionMemory entry/decline refs, if any. */
  prior_avoidance_fact_refs: readonly string[];
  owner: string;
  expires_at: string;
  idempotency_key: string;
}>;

export type LearningEngineFailure =
  | CandidateRepositoryFailure
  | Readonly<{ code: "not_recurring"; message: string; retryable: false }>;

export async function raiseMistakeRecurrenceCandidate(
  candidateRepository: CandidateRepository,
  request: RaiseMistakeRecurrenceCandidateRequest,
): Promise<StableResult<KnowledgeCandidate, LearningEngineFailure>> {
  // §9a: a one-off mistake SHALL NOT reach this path — fail closed rather
  // than silently creating a candidate from an assessment that never
  // proved recurrence.
  if (!request.assessment.recurring) {
    return {
      ok: false,
      failure: {
        code: "not_recurring",
        message: "A non-recurring mistake occurrence cannot raise a Learning Engine candidate; it belongs to SPEC-108's avoidance-fact path.",
        retryable: false,
      },
    };
  }

  const { occurrence, assessment, causal_mistake: causalMistake } = request;
  const recurrenceRef = `mistake-recurrence:${occurrence.causal_mistake_key}:count=${assessment.occurrence_count}`;
  const rationale = [
    `Recurring causal mistake: ${causalMistake}`,
    `Observed ${assessment.occurrence_count} times since ${assessment.first_observed_at} in Workspace "${occurrence.workspace_id}".`,
    `Affected runs: ${assessment.affected_runs.join(", ")}.`,
    "Pattern detection method: deterministic occurrence counting; single-signal, no cross-validation (SPEC-105 §8).",
  ].join(" ");

  const result = await candidateRepository.createIdempotent({
    context: request.context,
    candidate: {
      id: `candidate:${occurrence.causal_mistake_key}`,
      workspace_id: occurrence.workspace_id,
      proposed_claims: [],
      discovery_source: "mistake-recurrence",
      rationale,
      supporting_evidence_refs: [...request.prior_avoidance_fact_refs, recurrenceRef, ...assessment.affected_runs],
      contradicting_evidence_refs: [],
      confidence: 0.5,
      uncertainty_reasons: [
        "single-signal deterministic recurrence count; no representative-coverage or counterexample analysis performed (SPEC-105 §10 out of scope for this tracer bullet)",
      ],
      affected_knowledge_refs: [],
      validation_plan: "Human/governed validation per SPEC-105 §6; post-promotion effectiveness measured per §9a before this causal class is considered resolved.",
      owner: request.owner,
      expires_at: request.expires_at,
    },
    idempotency_key: request.idempotency_key,
  });
  if (!result.ok) return result;
  return { ok: true, value: result.value };
}
