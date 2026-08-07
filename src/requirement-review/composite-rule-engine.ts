import type {
  DeterministicRuleEngine,
  JsonValue,
  RuleEvaluationRequest,
  RuleEvaluationResult,
  RuleEvaluationValue,
} from "./public.js";

/**
 * Runs multiple `DeterministicRuleEngine`s against the same request and
 * merges their results into one. Exists because a single Requirement is
 * governed by more than one accepted rule set — SPEC-203 (quality:
 * acceptance criteria, source, ambiguous terms) and SPEC-202 (contract
 * completeness: rationale, traceability-count-by-status) are independent
 * rule sets that both apply to the same Requirement, and
 * `AssessRequirementQuality` accepts exactly one `DeterministicRuleEngine`.
 *
 * Findings from every engine are concatenated (never dropped or
 * summarized away); the merged outcome is the single worst outcome any
 * engine reported, ranked `error` > `not_applicable` > `not_satisfied` >
 * `indeterminate` > `satisfied` — a "critical" outcome from one rule set
 * SHALL NOT be diluted by a "satisfied" from another.
 */
export class CompositeRuleEngine implements DeterministicRuleEngine {
  readonly #engines: readonly DeterministicRuleEngine[];

  constructor(engines: readonly DeterministicRuleEngine[]) {
    if (engines.length === 0) {
      throw new Error("CompositeRuleEngine requires at least one rule engine.");
    }
    this.#engines = engines;
  }

  async evaluate(request: RuleEvaluationRequest): Promise<RuleEvaluationResult> {
    const results = await Promise.all(this.#engines.map((engine) => engine.evaluate(request)));
    const failed = results.find((result): result is Extract<RuleEvaluationResult, { ok: false }> => !result.ok);
    if (failed) return failed;

    const values = results.map(
      (result) => (result as Extract<RuleEvaluationResult, { ok: true }>).value,
    );
    return { ok: true, value: mergeValues(request, values) };
  }
}

const OUTCOME_SEVERITY: Readonly<Record<RuleEvaluationValue["outcome"], number>> = {
  error: 4,
  not_applicable: 3,
  not_satisfied: 2,
  indeterminate: 1,
  satisfied: 0,
};

function mergeValues(
  request: RuleEvaluationRequest,
  values: readonly RuleEvaluationValue[],
): RuleEvaluationValue {
  const worst = values.reduce((worstSoFar, candidate) =>
    OUTCOME_SEVERITY[candidate.outcome] > OUTCOME_SEVERITY[worstSoFar.outcome] ? candidate : worstSoFar,
  );
  const findings = values.flatMap((value) => readFindings(value.outputs["findings"]));

  return {
    outcome: worst.outcome,
    rule_set: { ...request.rule_set },
    rule_versions: uniqueByIdVersion(values.flatMap((value) => value.rule_versions)),
    matched_conditions: unique(values.flatMap((value) => value.matched_conditions)),
    relevant_facts: unique(values.flatMap((value) => value.relevant_facts)),
    outputs: { findings },
    conflicts: unique(values.flatMap((value) => value.conflicts)),
    missing_facts: unique(values.flatMap((value) => value.missing_facts)),
    explanation_trace: values.flatMap((value) => value.explanation_trace),
    policy_version: request.context.policy_version,
    duration_ms: values.reduce((total, value) => total + value.duration_ms, 0),
  };
}

function readFindings(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueByIdVersion(
  references: readonly Readonly<{ id: string; version: string }>[],
): Readonly<{ id: string; version: string }>[] {
  const seen = new Map<string, Readonly<{ id: string; version: string }>>();
  for (const reference of references) {
    seen.set(`${reference.id}@${reference.version}`, reference);
  }
  return [...seen.values()];
}
