export interface Clock {
  now(): Date;
}

export type SubjectType = "agent" | "skill";
export type TrialOutcome = "passed" | "failed" | "blocked" | "indeterminate";
export type FailureClass =
  | "none"
  | "subject"
  | "evaluator"
  | "infrastructure"
  | "invalid_test"
  | "policy_denial"
  | "indeterminate";
export type EvaluationVerdict = TrialOutcome;
export type ReleaseRecommendation =
  | "recommend_release"
  | "recommend_conditional_release"
  | "reject_release"
  | "indeterminate";

export interface SubjectReference {
  readonly type: SubjectType;
  readonly id: string;
  readonly version: string;
}

export interface SuiteReference {
  readonly id: string;
  readonly version: string;
}

export interface TrialResult {
  readonly case_id: string;
  readonly trial_id: string;
  readonly outcome: TrialOutcome;
  readonly failure_class: FailureClass;
  readonly evidence: readonly string[];
}

export interface CriticalInvariant {
  readonly id: string;
  readonly passed: boolean;
}

export interface EvaluationInput {
  readonly run_id: string;
  readonly workspace_id: string;
  readonly subject: SubjectReference;
  readonly suite: SuiteReference;
  readonly resolved_versions: Readonly<Record<string, string>>;
  readonly trial_results: readonly TrialResult[];
  readonly critical_invariants: readonly CriticalInvariant[];
  /** Runtime cancellation is normalized here; it is not an evaluation-result verdict. */
  readonly campaign_state?: "completed" | "blocked" | "cancelled";
}

export interface EvaluationSuitePolicy {
  readonly suite: SuiteReference;
  readonly required_case_ids: readonly string[];
  readonly critical_invariant_ids: readonly string[];
  readonly minimum_trials_per_case: number;
}

export interface EvaluationSuitePolicyRegistry {
  resolve(suite: SuiteReference): EvaluationSuitePolicy | undefined;
}

/** Trust boundary for retained Evaluation Adapter/store trial and invariant facts. */
export interface EvaluationEvidenceVerifier {
  verify(input: EvaluationInput): boolean;
}

/** Immutable development registry; production adapters must resolve accepted suites from authority. */
export class StaticEvaluationSuitePolicyRegistry implements EvaluationSuitePolicyRegistry {
  readonly #policies: ReadonlyMap<string, EvaluationSuitePolicy>;

  constructor(policies: readonly EvaluationSuitePolicy[]) {
    this.#policies = new Map(
      policies.map((policy) => [
        suiteKey(policy.suite),
        copySuitePolicy(policy),
      ]),
    );
  }

  resolve(suite: SuiteReference): EvaluationSuitePolicy | undefined {
    const policy = this.#policies.get(suiteKey(suite));
    return policy === undefined ? undefined : copySuitePolicy(policy);
  }
}

export interface EvaluationMetrics {
  readonly total_trials: number;
  readonly passed_trials: number;
  readonly failed_trials: number;
  readonly blocked_trials: number;
  readonly indeterminate_trials: number;
  readonly critical_invariants_total: number;
  readonly critical_invariants_passed: number;
  readonly evidence_reference_count: number;
  readonly invalid_test_reasons: readonly string[];
}

export interface EvaluationResult {
  readonly schema_version: "1.0.0";
  readonly run_id: string;
  readonly workspace_id: string;
  readonly subject: SubjectReference;
  readonly suite: SuiteReference;
  readonly resolved_versions: Readonly<Record<string, string>>;
  readonly trial_results: readonly TrialResult[];
  readonly critical_invariants: readonly CriticalInvariant[];
  readonly metrics: EvaluationMetrics;
  readonly verdict: EvaluationVerdict;
  readonly recommendation: ReleaseRecommendation;
  readonly evidence: readonly string[];
  readonly started_at: string;
  readonly completed_at: string;
}

/**
 * Applies provider-neutral evaluation verdict semantics to retained trial facts.
 * This module performs no execution, persistence, approval, or release action.
 */
export class EvaluationManager {
  readonly #clock: Clock;
  readonly #suitePolicies: EvaluationSuitePolicyRegistry;
  readonly #evidenceVerifier: EvaluationEvidenceVerifier;

  constructor(
    clock: Clock,
    suitePolicies: EvaluationSuitePolicyRegistry,
    evidenceVerifier: EvaluationEvidenceVerifier,
  ) {
    this.#clock = clock;
    this.#suitePolicies = suitePolicies;
    this.#evidenceVerifier = evidenceVerifier;
  }

  evaluate(input: EvaluationInput): EvaluationResult {
    const startedAt = this.#clock.now().toISOString();
    const trialResults = input.trial_results.map(copyTrialResult);
    const criticalInvariants = input.critical_invariants.map((invariant) => ({ ...invariant }));
    const retainedInput: EvaluationInput = {
      ...input,
      subject: { ...input.subject },
      suite: { ...input.suite },
      resolved_versions: { ...input.resolved_versions },
      trial_results: trialResults,
      critical_invariants: criticalInvariants,
    };
    const suitePolicy = this.#suitePolicies.resolve(input.suite);
    const verifiedEvidence = verifyEvidence(this.#evidenceVerifier, retainedInput);
    const invalidTestReasons = [
      ...(verifiedEvidence ? [] : ["unverified-evaluation-evidence"]),
      ...validateSuiteInput(
      retainedInput,
      suitePolicy,
      trialResults,
      criticalInvariants,
      ),
    ];
    const evidence = [
      ...trialResults.flatMap((trial) => trial.evidence),
      ...invalidTestReasons.map((reason) => `invalid-test:${reason}`),
    ];
    const verdict =
      invalidTestReasons.length === 0
        ? decideVerdict(trialResults, criticalInvariants, input.campaign_state ?? "completed")
        : "indeterminate";

    return {
      schema_version: "1.0.0",
      run_id: input.run_id,
      workspace_id: input.workspace_id,
      subject: { ...input.subject },
      suite: { ...input.suite },
      resolved_versions: { ...input.resolved_versions },
      trial_results: trialResults,
      critical_invariants: criticalInvariants,
      metrics: summarize(
        trialResults,
        criticalInvariants,
        evidence.length,
        invalidTestReasons,
      ),
      verdict,
      recommendation:
        verdict === "passed"
          ? "recommend_release"
          : verdict === "failed"
            ? "reject_release"
            : "indeterminate",
      evidence,
      started_at: startedAt,
      completed_at: this.#clock.now().toISOString(),
    };
  }
}

function decideVerdict(
  trials: readonly TrialResult[],
  invariants: readonly CriticalInvariant[],
  campaignState: NonNullable<EvaluationInput["campaign_state"]>,
): EvaluationVerdict {
  if (invariants.some((invariant) => !invariant.passed)) {
    return "failed";
  }

  if (trials.length === 0 || invariants.length === 0 || trials.some((trial) => trial.evidence.length === 0)) {
    return "indeterminate";
  }

  if (campaignState === "cancelled") {
    return "indeterminate";
  }

  if (campaignState === "blocked") {
    return "blocked";
  }

  if (
    trials.some(
      (trial) =>
        trial.failure_class === "evaluator" ||
        trial.failure_class === "infrastructure" ||
        trial.failure_class === "invalid_test" ||
        trial.failure_class === "indeterminate",
    )
  ) {
    return "indeterminate";
  }

  if (trials.some((trial) => trial.outcome === "failed" && trial.failure_class === "subject")) {
    return "failed";
  }

  if (
    trials.some((trial) => trial.outcome === "blocked" || trial.failure_class === "policy_denial")
  ) {
    return "blocked";
  }

  if (trials.some((trial) => trial.outcome === "indeterminate")) {
    return "indeterminate";
  }

  return trials.every((trial) => trial.outcome === "passed" && trial.failure_class === "none")
    ? "passed"
    : "indeterminate";
}

function copyTrialResult(trial: TrialResult): TrialResult {
  return { ...trial, evidence: [...trial.evidence] };
}

function summarize(
  trials: readonly TrialResult[],
  invariants: readonly CriticalInvariant[],
  evidenceReferenceCount: number,
  invalidTestReasons: readonly string[],
): EvaluationMetrics {
  return {
    total_trials: trials.length,
    passed_trials: trials.filter((trial) => trial.outcome === "passed").length,
    failed_trials: trials.filter((trial) => trial.outcome === "failed").length,
    blocked_trials: trials.filter((trial) => trial.outcome === "blocked").length,
    indeterminate_trials: trials.filter((trial) => trial.outcome === "indeterminate").length,
    critical_invariants_total: invariants.length,
    critical_invariants_passed: invariants.filter((invariant) => invariant.passed).length,
    evidence_reference_count: evidenceReferenceCount,
    invalid_test_reasons: [...invalidTestReasons],
  };
}

function validateSuiteInput(
  input: EvaluationInput,
  suitePolicy: EvaluationSuitePolicy | undefined,
  trials: readonly TrialResult[],
  invariants: readonly CriticalInvariant[],
): string[] {
  const reasons: string[] = [];
  if (suitePolicy === undefined) return ["unknown-suite-policy"];
  if (!Number.isInteger(suitePolicy.minimum_trials_per_case) || suitePolicy.minimum_trials_per_case < 1) reasons.push("invalid-minimum-trials");
  if (!isSemanticVersion(input.subject.version) || !isSemanticVersion(input.suite.version)) {
    reasons.push("unresolved-version");
  }

  const requiredCases = new Set(suitePolicy.required_case_ids);
  const actualCases = new Set(trials.map((trial) => trial.case_id));
  if (
    requiredCases.size !== suitePolicy.required_case_ids.length ||
    actualCases.size !== requiredCases.size ||
    [...requiredCases].some((caseId) => !actualCases.has(caseId))
  ) {
    reasons.push("trial-matrix-mismatch");
  }
  for (const caseId of requiredCases) {
    if (
      trials.filter((trial) => trial.case_id === caseId).length <
      suitePolicy.minimum_trials_per_case
    ) {
      reasons.push(`minimum-trials-not-met:${caseId}`);
    }
  }

  const requiredInvariants = new Set(suitePolicy.critical_invariant_ids);
  const actualInvariants = new Set(invariants.map((invariant) => invariant.id));
  if (
    requiredInvariants.size !== suitePolicy.critical_invariant_ids.length ||
    actualInvariants.size !== invariants.length ||
    actualInvariants.size !== requiredInvariants.size ||
    [...requiredInvariants].some((invariantId) => !actualInvariants.has(invariantId))
  ) {
    reasons.push("critical-invariant-matrix-mismatch");
  }

  if (
    Object.keys(input.resolved_versions).length === 0 ||
    Object.values(input.resolved_versions).some(
      (version) => !isExactVersionPin(version),
    )
  ) {
    reasons.push("unresolved-version");
  }
  if (new Set(trials.map((trial) => trial.trial_id)).size !== trials.length) {
    reasons.push("duplicate-trial-id");
  }
  if (
    trials.some(
      (trial) =>
        (trial.outcome === "passed" && trial.failure_class !== "none") ||
        (trial.outcome !== "passed" && trial.failure_class === "none"),
    )
  ) {
    reasons.push("inconsistent-trial-outcome");
  }
  if (trials.some((trial) => trial.evidence.length === 0)) {
    reasons.push("missing-trial-evidence");
  }
  return [...new Set(reasons)];
}

function verifyEvidence(
  verifier: EvaluationEvidenceVerifier,
  input: EvaluationInput,
): boolean {
  try {
    return verifier.verify(input);
  } catch {
    return false;
  }
}

function suiteKey(suite: SuiteReference): string {
  return `${suite.id}\u0000${suite.version}`;
}

function copySuitePolicy(policy: EvaluationSuitePolicy): EvaluationSuitePolicy {
  return Object.freeze({
    suite: Object.freeze({ ...policy.suite }),
    required_case_ids: Object.freeze([...policy.required_case_ids]),
    critical_invariant_ids: Object.freeze([...policy.critical_invariant_ids]),
    minimum_trials_per_case: policy.minimum_trials_per_case,
  });
}

function isSemanticVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isExactVersionPin(value: string): boolean {
  return (
    isSemanticVersion(value) ||
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      value,
    )
  );
}
