import type { FailureAvoidanceTrigger } from "../memory/failure-avoidance.js";

export interface Clock {
  now(): Date;
}

/** One observed instance of a causal mistake — the mistake, not its symptom (mirrors `FailureAvoidanceCandidate`'s framing). */
export type MistakeOccurrence = Readonly<{
  workspace_id: string;
  causal_mistake_key: string;
  trigger: FailureAvoidanceTrigger;
  source_ref: string;
  occurred_at: string;
}>;

export type RecurrenceAssessment =
  | Readonly<{ recurring: false }>
  | Readonly<{
      recurring: true;
      occurrence_count: number;
      affected_runs: readonly string[];
      first_observed_at: string;
    }>;

/**
 * SPEC-105 §9a (Mistake and Failure-Recurrence Prevention): "the engine
 * SHALL treat repeated defects, incorrect verdicts, and human-corrected
 * Agent decisions of the same causal class as a distinct
 * candidate-generating signal." `evaluateFailureAvoidanceCandidate`
 * (`src/memory/failure-avoidance.ts`) already declines with
 * `"requires_learning_engine"` whenever a caller marks a mistake
 * `recurring: true`, but nothing in the repository computed that flag —
 * this tracker is that missing computation, kept as a small, pure,
 * counting/classification primitive (mirroring `judge-calibration.ts`'s
 * `detectDrift`: flag, don't act) rather than the full §8 general pattern
 * detector or §9's 8-signal drift detection, both out of scope here.
 */
export class MistakeRecurrenceTracker {
  readonly #clock: Clock;
  readonly #occurrences = new Map<string, MistakeOccurrence[]>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /**
   * Records one occurrence and classifies it. `generalizesBeyondWorkspace`
   * is caller-supplied (§4.3/§9a: the caller already knows whether a
   * mistake's generalized form would apply beyond its originating
   * Workspace — this tracker can only mechanically know within-Workspace
   * repeat count) and forces `recurring: true` regardless of count.
   * "recurring" by count alone requires the same `causal_mistake_key`
   * observed at least twice for the same Workspace (§9a: "the same causal
   * class observed across multiple runs").
   */
  record(occurrence: MistakeOccurrence, generalizesBeyondWorkspace = false): RecurrenceAssessment {
    const key = occurrenceKey(occurrence.workspace_id, occurrence.causal_mistake_key);
    const history = this.#occurrences.get(key) ?? [];
    history.push(occurrence);
    this.#occurrences.set(key, history);

    if (!generalizesBeyondWorkspace && history.length < 2) {
      return { recurring: false };
    }
    return {
      recurring: true,
      occurrence_count: history.length,
      affected_runs: history.map((entry) => entry.source_ref),
      first_observed_at: history[0]?.occurred_at ?? occurrence.occurred_at,
    };
  }

  /** SPEC-105 §16 observability: current occurrence count for one Workspace's causal-mistake key. */
  occurrenceCount(workspaceId: string, causalMistakeKey: string): number {
    return (this.#occurrences.get(occurrenceKey(workspaceId, causalMistakeKey)) ?? []).length;
  }
}

function occurrenceKey(workspaceId: string, causalMistakeKey: string): string {
  return `${workspaceId} ${causalMistakeKey}`;
}
