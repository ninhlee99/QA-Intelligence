import type { ConsequenceClass } from "../requirement-review/public.js";
import type {
  ApplicabilityScope,
  SessionMemoryCandidate,
  SessionMemoryDeclineReason,
  SessionMemoryEntry,
} from "./session-memory.js";
import { SessionMemory } from "./session-memory.js";

/**
 * SPEC-108 §7.3 / SPEC-105 §9a: the run-outcome shapes that make a causal
 * mistake a mandatory save-decision candidate. A run's symptom (a failed
 * assertion, a rejected verdict) is not itself the candidate — the caller
 * SHALL supply the causal mistake, not the symptom.
 */
export type FailureAvoidanceTrigger =
  | "defect"
  | "incorrect_verdict"
  | "blocked_execution"
  | "failed_execution"
  | "human_corrected_decision";

/**
 * SPEC-105 §9a: a single occurrence stays in Memory's bounded fast path;
 * a mistake already known to be recurring, or one whose generalized form
 * would apply beyond the originating Workspace, is a Learning Engine
 * candidate and SHALL NOT be retained here as an avoidance fact.
 */
export type FailureAvoidanceCandidate = Readonly<{
  workspace_id: string;
  trigger: FailureAvoidanceTrigger;
  /** Stable identity for the causal mistake, e.g. "missing-header:x-tenant-id". */
  causal_mistake_key: string;
  /** Description of the mistake itself, not its symptom. */
  causal_mistake: string;
  source_ref: string;
  consequence_class: ConsequenceClass;
  applicability_scope?: ApplicabilityScope;
  /** SPEC-105 §9a: same causal class already observed in a prior run. */
  recurring: boolean;
  ttl_seconds: number;
}>;

export type FailureAvoidanceDecision =
  | Readonly<{ retained: true; entry: SessionMemoryEntry }>
  | Readonly<{ retained: false; reason: SessionMemoryDeclineReason | "requires_learning_engine" }>;

/**
 * SPEC-108 §7.3: evaluates a run's causal mistake as a save candidate so the
 * same avoidable error is not repeated in a later run in this Workspace.
 * A recurring mistake, or one that generalizes beyond this Workspace, SHALL
 * follow SPEC-105's full governed workflow instead — this function declines
 * it here rather than silently retaining a would-be Learning Engine input.
 */
export function evaluateFailureAvoidanceCandidate(
  memory: SessionMemory,
  candidate: FailureAvoidanceCandidate,
): FailureAvoidanceDecision {
  if (candidate.recurring) {
    return { retained: false, reason: "requires_learning_engine" };
  }
  if ((candidate.applicability_scope ?? "project_scoped") !== "project_scoped") {
    return { retained: false, reason: "requires_learning_engine" };
  }

  const decision = memory.evaluate({
    workspace_id: candidate.workspace_id,
    key: candidate.causal_mistake_key,
    value: candidate.causal_mistake,
    source_ref: candidate.source_ref,
    consequence_class: candidate.consequence_class,
    applicability_scope: "project_scoped",
    reuse_likely: true,
    ttl_seconds: candidate.ttl_seconds,
  } satisfies SessionMemoryCandidate);

  if (decision.retained) {
    return { retained: true, entry: decision.entry };
  }
  return { retained: false, reason: decision.reason };
}
