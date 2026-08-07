import {
  EvaluationManager,
  StaticEvaluationSuitePolicyRegistry,
  type Clock,
  type CriticalInvariant,
  type EvaluationEvidenceVerifier,
  type EvaluationResult,
  type EvaluationSuitePolicy,
  type FailureClass,
  type SubjectReference,
  type SuiteReference,
  type TrialOutcome,
  type TrialResult,
} from "../evaluation/evaluation-manager.js";
import type {
  AssessTestCaseQuality,
  TestCaseReviewRequest,
} from "../test-design/assess-test-case-quality.js";

/**
 * SPEC-213 dogfooding: proves the Evaluation Campaign infrastructure
 * (EvaluationManager, SPEC-107/606/607) can genuinely assess one of this
 * repository's own Skills (Assess Test Case Quality, SPEC-207) — the exact
 * "agent/skill quality assessment" this capability names. This module does
 * NOT build a new evaluation runtime: it translates real
 * `AssessTestCaseQuality.review()` calls into `TrialResult`s the existing
 * `EvaluationManager` already knows how to verdict and recommend from. A
 * full 7-operation `EvaluationAdapter` (SPEC-511) wrapping this Skill for
 * production Evaluation Campaign orchestration remains future work — this
 * proves the narrower, load-bearing claim first: a deterministic Skill can
 * be evaluated without a model provider (SPEC-213 §7), and the resulting
 * verdict/recommendation is not fabricated.
 */

export type TestCaseQualityEvaluationCase = Readonly<{
  case_id: string;
  request: TestCaseReviewRequest;
  /** Whether this case's request is EXPECTED to pass a quality Test Case (a positive case) or fail one (a negative/boundary case). */
  expect_pass: boolean;
}>;

export type TestCaseQualityEvaluationInput = Readonly<{
  run_id: string;
  workspace_id: string;
  subject: SubjectReference;
  suite: SuiteReference;
  resolved_versions: Readonly<Record<string, string>>;
  cases: readonly TestCaseQualityEvaluationCase[];
  critical_invariant_ids: readonly string[];
}>;

/**
 * Runs the real Skill once per case, translates its real outcome into a
 * TrialResult, and hands the full set to EvaluationManager for a genuine
 * verdict and recommendation. No trial result here is synthesized —
 * every `outcome`/`failure_class` is derived from what
 * `AssessTestCaseQuality.review()` actually returned.
 */
export async function evaluateTestCaseQualitySkill(
  clock: Clock,
  evidenceVerifier: EvaluationEvidenceVerifier,
  skill: AssessTestCaseQuality,
  input: TestCaseQualityEvaluationInput,
): Promise<EvaluationResult> {
  const trialResults: TrialResult[] = [];
  for (const evaluationCase of input.cases) {
    const result = await skill.review(evaluationCase.request);
    trialResults.push(toTrialResult(evaluationCase, result));
  }

  const criticalInvariants: CriticalInvariant[] = input.critical_invariant_ids.map((id) => ({
    id,
    passed: trialResultSatisfiesInvariant(id, trialResults, input.cases),
  }));

  const suitePolicy: EvaluationSuitePolicy = {
    suite: input.suite,
    required_case_ids: input.cases.map((evaluationCase) => evaluationCase.case_id),
    critical_invariant_ids: input.critical_invariant_ids,
    minimum_trials_per_case: 1,
  };
  const suitePolicies = new StaticEvaluationSuitePolicyRegistry([suitePolicy]);
  const manager = new EvaluationManager(clock, suitePolicies, evidenceVerifier);

  return manager.evaluate({
    run_id: input.run_id,
    workspace_id: input.workspace_id,
    subject: input.subject,
    suite: input.suite,
    resolved_versions: input.resolved_versions,
    trial_results: trialResults,
    critical_invariants: criticalInvariants,
  });
}

function toTrialResult(
  evaluationCase: TestCaseQualityEvaluationCase,
  result: Awaited<ReturnType<AssessTestCaseQuality["review"]>>,
): TrialResult {
  const trialId = `trial:${evaluationCase.case_id}`;
  if (!result.ok) {
    // The Skill itself refused to run (authorization/config/knowledge/rule
    // failure) — this is a real failure the subject produced, not a
    // fabricated one, but it is not necessarily a *quality* verdict about
    // the Test Case under review, so it is classified by failure domain.
    const failureClass: FailureClass =
      result.failure.class === "authorization"
        ? "policy_denial"
        : result.failure.class === "configuration"
          ? "invalid_test"
          : "indeterminate";
    const outcome: TrialOutcome = failureClass === "policy_denial" ? "blocked" : "indeterminate";
    return {
      case_id: evaluationCase.case_id,
      trial_id: trialId,
      outcome,
      failure_class: failureClass,
      evidence: [...result.failure.evidence, `skill-failure:${result.failure.code}`],
    };
  }

  const assessment = result.value;
  const skillPassed = assessment.verdict === "pass" || assessment.verdict === "pass_with_recommendations";
  // The Evaluation Campaign is testing whether the Skill produces the
  // EXPECTED verdict for this case (a positive case expects "pass", a
  // negative/boundary case expects the Skill to correctly reject/block a
  // bad Test Case) — the Skill under test is the subject; getting the
  // expected verdict is what "passed" means for THIS trial.
  const matchesExpectation = skillPassed === evaluationCase.expect_pass;
  return {
    case_id: evaluationCase.case_id,
    trial_id: trialId,
    outcome: matchesExpectation ? "passed" : "failed",
    failure_class: matchesExpectation ? "none" : "subject",
    evidence: [...assessment.evidence, `subject-verdict:${assessment.verdict}`],
  };
}

function trialResultSatisfiesInvariant(
  invariantId: string,
  trials: readonly TrialResult[],
  cases: readonly TestCaseQualityEvaluationCase[],
): boolean {
  if (invariantId === "no-negative-case-wrongly-accepted") {
    // A trial's "passed" outcome already means "the Skill's verdict matched
    // this case's expectation" (see toTrialResult). This invariant re-states
    // the specific consequence that matters most for a quality-review
    // Skill: for every NEGATIVE case (one deliberately missing a critical
    // field, expect_pass === false), the Skill SHALL NOT have produced a
    // passing verdict — i.e. that case's trial SHALL have "passed" (matched
    // the expectation of rejection), not "failed" by wrongly accepting a
    // bad Test Case.
    return trials
      .filter((trial) => {
        const evaluationCase = cases.find((candidate) => candidate.case_id === trial.case_id);
        return evaluationCase !== undefined && !evaluationCase.expect_pass;
      })
      .every((trial) => trial.outcome === "passed");
  }
  return true;
}
