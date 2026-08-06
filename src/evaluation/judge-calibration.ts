/**
 * SPEC-310 §2/§6: "calibrate Judges and detect disagreement, drift,
 * leakage, or self-evaluation" and "Judge prompts SHALL isolate rubric
 * authority from candidate content... hidden holdout access is restricted
 * and audited." SPEC-107 §4 places a Judge at rung 3 of the oracle
 * hierarchy (below deterministic checks and evidence-anchored rubrics,
 * above only human review) and forbids it from being the sole authority
 * for critical safety/security/destructive-action/legal/acceptance/release
 * decisions, or from evaluating its own hidden rationale. No Judge concept
 * existed anywhere in this codebase before this module — `EvaluationManager`
 * (SPEC-411/213) aggregates trial outcomes but has no notion of a Judge,
 * calibration, or any of these four detection concerns.
 *
 * This module is provider-neutral: it operates on already-produced
 * `JudgeVerdict` records, never a reasoning-provider SDK call — the same
 * separation ADR-002/ADR-009 already establish for deterministic rules vs.
 * LLM reasoning, applied to the Judge oracle tier specifically.
 */
export type JudgeVerdict = Readonly<{
  judge_id: string;
  judge_version: string;
  case_id: string;
  trial_id: string;
  subject_id: string;
  verdict: "passed" | "failed" | "indeterminate";
  confidence: number;
  rationale: string;
  /** Evidence/context refs the Judge was actually given — used to detect leakage of hidden holdout material (SPEC-107 §6). */
  context_refs: readonly string[];
}>;

export type OracleLabel = Readonly<{
  case_id: string;
  trial_id: string;
  /** The known-correct verdict, from a deterministic oracle or authorized human review — never from another Judge. */
  correct_verdict: "passed" | "failed" | "indeterminate";
}>;

export type DisagreementReport = Readonly<{
  case_id: string;
  trial_id: string;
  verdict_counts: Readonly<Record<string, number>>;
  disagreement: boolean;
  /** True only when every dissenting Judge/trial pair is a genuine split; a single Judge run alone can never disagree with itself. */
  distinct_judge_count: number;
}>;

/**
 * SPEC-310 §2 disagreement detection: two or more Judges (or repeated
 * trials of the same Judge) reaching different verdicts on the same case
 * is flagged, never silently resolved by majority vote or averaging
 * (SPEC-107 §7 "aggregate scores SHALL NOT hide a failed critical
 * invariant" — the same non-masking principle applied to Judge output).
 */
export function detectDisagreement(verdicts: readonly JudgeVerdict[]): readonly DisagreementReport[] {
  const byCase = new Map<string, JudgeVerdict[]>();
  for (const verdict of verdicts) {
    const key = `${verdict.case_id}:${verdict.trial_id}`;
    const list = byCase.get(key) ?? [];
    list.push(verdict);
    byCase.set(key, list);
  }

  const reports: DisagreementReport[] = [];
  for (const [, group] of byCase) {
    if (group.length < 2) continue;
    const counts: Record<string, number> = {};
    for (const verdict of group) {
      counts[verdict.verdict] = (counts[verdict.verdict] ?? 0) + 1;
    }
    reports.push({
      case_id: group[0]?.case_id ?? "",
      trial_id: group[0]?.trial_id ?? "",
      verdict_counts: counts,
      disagreement: Object.keys(counts).length > 1,
      distinct_judge_count: new Set(group.map((verdict) => `${verdict.judge_id}@${verdict.judge_version}`)).size,
    });
  }
  return reports;
}

export type CalibrationResult = Readonly<{
  judge_id: string;
  judge_version: string;
  sample_size: number;
  correct: number;
  accuracy: number;
  /** Cases where the Judge diverged from the oracle label, for audit (never silently dropped). */
  mismatches: readonly Readonly<{ case_id: string; trial_id: string; judge_verdict: string; correct_verdict: string }>[];
}>;

/**
 * SPEC-310 §2 calibration: compares a Judge's verdicts against known-
 * correct oracle labels (never against another Judge — that would be
 * circular). A Judge with no overlapping cases against the oracle set
 * cannot be calibrated and SHALL NOT be reported as calibrated with a
 * fabricated accuracy.
 */
export function calibrateJudge(
  judgeId: string,
  judgeVersion: string,
  verdicts: readonly JudgeVerdict[],
  oracleLabels: readonly OracleLabel[],
): CalibrationResult | undefined {
  const relevant = verdicts.filter((verdict) => verdict.judge_id === judgeId && verdict.judge_version === judgeVersion);
  const oracleByKey = new Map(oracleLabels.map((label) => [`${label.case_id}:${label.trial_id}`, label]));

  const mismatches: CalibrationResult["mismatches"][number][] = [];
  let correct = 0;
  let sampleSize = 0;
  for (const verdict of relevant) {
    const oracle = oracleByKey.get(`${verdict.case_id}:${verdict.trial_id}`);
    if (oracle === undefined) continue;
    sampleSize += 1;
    if (verdict.verdict === oracle.correct_verdict) {
      correct += 1;
    } else {
      mismatches.push({
        case_id: verdict.case_id,
        trial_id: verdict.trial_id,
        judge_verdict: verdict.verdict,
        correct_verdict: oracle.correct_verdict,
      });
    }
  }

  if (sampleSize === 0) return undefined;
  return { judge_id: judgeId, judge_version: judgeVersion, sample_size: sampleSize, correct, accuracy: correct / sampleSize, mismatches };
}

export type DriftReport = Readonly<{
  judge_id: string;
  drifted: boolean;
  /** Accuracy trend in chronological calibration order — a caller can inspect the actual decline, not just a boolean. */
  accuracy_trend: readonly number[];
  earliest_accuracy: number;
  latest_accuracy: number;
  decline: number;
}>;

/**
 * SPEC-310 §2 drift detection: a Judge whose calibration accuracy declines
 * across successive calibration runs (e.g. across Judge versions, or
 * across time for the same version against fresh oracle samples) is
 * flagged. `threshold` is the minimum accuracy drop (0-1 scale) that
 * counts as drift, not noise — callers supply it because "how much decline
 * is meaningful" is a suite-level policy choice (SPEC-107 §14), not a
 * value this module invents.
 */
export function detectDrift(
  judgeId: string,
  calibrationHistory: readonly CalibrationResult[],
  threshold: number,
): DriftReport {
  const ordered = calibrationHistory.filter((entry) => entry.judge_id === judgeId);
  const trend = ordered.map((entry) => entry.accuracy);
  const earliest = trend[0] ?? 0;
  const latest = trend[trend.length - 1] ?? 0;
  const decline = earliest - latest;
  return {
    judge_id: judgeId,
    drifted: ordered.length >= 2 && decline >= threshold,
    accuracy_trend: trend,
    earliest_accuracy: earliest,
    latest_accuracy: latest,
    decline,
  };
}

export type SelfEvaluationReport = Readonly<{
  case_id: string;
  trial_id: string;
  self_evaluated: boolean;
}>;

/**
 * SPEC-107 §4: "A Judge SHALL not evaluate its own hidden rationale."
 * Flags a verdict where the Judge's identity matches the subject it
 * judged — the narrowest, unambiguous form of self-evaluation this module
 * can detect structurally (a Judge and Agent/Skill sharing the exact same
 * identity string), not a semantic proof of every conflict-of-interest.
 */
export function detectSelfEvaluation(verdicts: readonly JudgeVerdict[]): readonly SelfEvaluationReport[] {
  return verdicts.map((verdict) => ({
    case_id: verdict.case_id,
    trial_id: verdict.trial_id,
    self_evaluated: verdict.judge_id === verdict.subject_id,
  }));
}

export type LeakageReport = Readonly<{
  case_id: string;
  trial_id: string;
  leaked_refs: readonly string[];
  leaked: boolean;
}>;

/**
 * SPEC-107 §6: "Exposure of a hidden case to the subject or author is
 * contamination and invalidates the affected comparison" — applied here to
 * a Judge receiving a hidden-holdout evidence reference it was never
 * authorized to see. `hiddenHoldoutRefs` is the authoritative set of refs
 * this suite classifies as hidden; this module does not decide that
 * classification, only checks a Judge's actual context against it.
 */
export function detectLeakage(
  verdicts: readonly JudgeVerdict[],
  hiddenHoldoutRefs: ReadonlySet<string>,
): readonly LeakageReport[] {
  return verdicts.map((verdict) => {
    const leakedRefs = verdict.context_refs.filter((ref) => hiddenHoldoutRefs.has(ref));
    return { case_id: verdict.case_id, trial_id: verdict.trial_id, leaked_refs: leakedRefs, leaked: leakedRefs.length > 0 };
  });
}

export type ConsequenceClassForJudgeAuthority = "advisory" | "reversible" | "controlled_side_effect" | "high_consequence";

/**
 * SPEC-107 §4: "An LLM Judge SHALL NOT be the sole authority for critical
 * safety, security, destructive-action, legal, acceptance, or release
 * decisions." This gate gives that requirement a checkable boolean: a
 * `high_consequence` verdict backed by a Judge alone (no deterministic
 * oracle and no human review in the same decision) fails closed rather
 * than silently proceeding on Judge output alone.
 */
export function judgeAuthorityPermitted(
  consequenceClass: ConsequenceClassForJudgeAuthority,
  hasCorroboratingDeterministicOracle: boolean,
  hasHumanReview: boolean,
): boolean {
  if (consequenceClass !== "high_consequence") return true;
  return hasCorroboratingDeterministicOracle || hasHumanReview;
}
