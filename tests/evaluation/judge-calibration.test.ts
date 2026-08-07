import assert from "node:assert/strict";
import test from "node:test";

import {
  calibrateJudge,
  detectDisagreement,
  detectDrift,
  detectLeakage,
  detectSelfEvaluation,
  judgeAuthorityPermitted,
  type CalibrationResult,
  type JudgeVerdict,
  type OracleLabel,
} from "../../src/evaluation/judge-calibration.js";

function verdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    judge_id: "judge-alpha",
    judge_version: "1.0.0",
    case_id: "case-1",
    trial_id: "trial-1",
    subject_id: "agent-under-test@1.0.0",
    verdict: "passed",
    confidence: 0.9,
    rationale: "meets the rubric anchors",
    context_refs: ["evidence://trial-1"],
    ...overrides,
  };
}

test("detectDisagreement reports no disagreement when every Judge agrees", () => {
  const verdicts = [
    verdict({ judge_id: "judge-a" }),
    verdict({ judge_id: "judge-b" }),
  ];

  const reports = detectDisagreement(verdicts);

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.disagreement, false);
  assert.equal(reports[0]?.distinct_judge_count, 2);
});

test("detectDisagreement flags a real split verdict, never resolved by majority silently", () => {
  const verdicts = [
    verdict({ judge_id: "judge-a", verdict: "passed" }),
    verdict({ judge_id: "judge-b", verdict: "failed" }),
    verdict({ judge_id: "judge-c", verdict: "passed" }),
  ];

  const reports = detectDisagreement(verdicts);

  assert.equal(reports.length, 1);
  assert.equal(reports[0]?.disagreement, true);
  assert.deepEqual(reports[0]?.verdict_counts, { passed: 2, failed: 1 });
});

test("detectDisagreement does not flag a single Judge's single trial as disagreeing with itself", () => {
  const reports = detectDisagreement([verdict()]);

  assert.equal(reports.length, 0);
});

test("detectDisagreement groups independently per case_id/trial_id", () => {
  const verdicts = [
    verdict({ judge_id: "judge-a", case_id: "case-1", verdict: "passed" }),
    verdict({ judge_id: "judge-b", case_id: "case-1", verdict: "passed" }),
    verdict({ judge_id: "judge-a", case_id: "case-2", verdict: "passed" }),
    verdict({ judge_id: "judge-b", case_id: "case-2", verdict: "failed" }),
  ];

  const reports = detectDisagreement(verdicts);

  assert.equal(reports.length, 2);
  const case1 = reports.find((report) => report.case_id === "case-1");
  const case2 = reports.find((report) => report.case_id === "case-2");
  assert.equal(case1?.disagreement, false);
  assert.equal(case2?.disagreement, true);
});

test("calibrateJudge computes real accuracy against oracle labels, not a fabricated score", () => {
  const verdicts = [
    verdict({ case_id: "case-1", trial_id: "trial-1", verdict: "passed" }),
    verdict({ case_id: "case-2", trial_id: "trial-1", verdict: "failed" }),
    verdict({ case_id: "case-3", trial_id: "trial-1", verdict: "passed" }),
  ];
  const oracle: OracleLabel[] = [
    { case_id: "case-1", trial_id: "trial-1", correct_verdict: "passed" },
    { case_id: "case-2", trial_id: "trial-1", correct_verdict: "passed" },
    { case_id: "case-3", trial_id: "trial-1", correct_verdict: "passed" },
  ];

  const result = calibrateJudge("judge-alpha", "1.0.0", verdicts, oracle);

  assert.notEqual(result, undefined);
  assert.equal(result?.sample_size, 3);
  assert.equal(result?.correct, 2);
  assert.equal(result?.accuracy, 2 / 3);
  assert.equal(result?.mismatches.length, 1);
  assert.equal(result?.mismatches[0]?.case_id, "case-2");
});

test("calibrateJudge only compares a Judge against a genuine oracle label, never another Judge's verdict", () => {
  // No oracle labels supplied at all — nothing to calibrate against.
  const verdicts = [verdict()];
  const result = calibrateJudge("judge-alpha", "1.0.0", verdicts, []);

  assert.equal(result, undefined, "a Judge with zero overlapping oracle cases cannot be calibrated");
});

test("calibrateJudge only counts verdicts from the exact judge_id/judge_version requested", () => {
  const verdicts = [
    verdict({ judge_id: "judge-alpha", judge_version: "1.0.0", verdict: "passed" }),
    verdict({ judge_id: "judge-beta", judge_version: "1.0.0", verdict: "failed" }),
  ];
  const oracle: OracleLabel[] = [{ case_id: "case-1", trial_id: "trial-1", correct_verdict: "passed" }];

  const result = calibrateJudge("judge-alpha", "1.0.0", verdicts, oracle);

  assert.equal(result?.sample_size, 1);
  assert.equal(result?.accuracy, 1);
});

function calibration(accuracy: number): CalibrationResult {
  return { judge_id: "judge-alpha", judge_version: "1.0.0", sample_size: 10, correct: Math.round(accuracy * 10), accuracy, mismatches: [] };
}

test("detectDrift flags a real accuracy decline beyond the caller's threshold", () => {
  const history = [calibration(0.95), calibration(0.9), calibration(0.7)];

  const report = detectDrift("judge-alpha", history, 0.1);

  assert.equal(report.drifted, true);
  assert.equal(report.earliest_accuracy, 0.95);
  assert.equal(report.latest_accuracy, 0.7);
  assert.ok(Math.abs(report.decline - 0.25) < 1e-9);
});

test("detectDrift does not flag noise below the threshold as drift", () => {
  const history = [calibration(0.9), calibration(0.88)];

  const report = detectDrift("judge-alpha", history, 0.1);

  assert.equal(report.drifted, false);
});

test("detectDrift requires at least two calibration points — a single measurement is not a trend", () => {
  const report = detectDrift("judge-alpha", [calibration(0.5)], 0.01);

  assert.equal(report.drifted, false);
});

test("detectSelfEvaluation flags a Judge whose identity matches the subject it judged", () => {
  const verdicts = [
    verdict({ judge_id: "agent-under-test@1.0.0", subject_id: "agent-under-test@1.0.0" }),
    verdict({ judge_id: "judge-independent", subject_id: "agent-under-test@1.0.0" }),
  ];

  const reports = detectSelfEvaluation(verdicts);

  assert.equal(reports[0]?.self_evaluated, true);
  assert.equal(reports[1]?.self_evaluated, false);
});

test("detectLeakage flags a Judge that received a hidden holdout reference it should never see", () => {
  const hiddenRefs = new Set(["holdout://secret-case-1"]);
  const verdicts = [
    verdict({ context_refs: ["evidence://trial-1", "holdout://secret-case-1"] }),
    verdict({ context_refs: ["evidence://trial-2"] }),
  ];

  const reports = detectLeakage(verdicts, hiddenRefs);

  assert.equal(reports[0]?.leaked, true);
  assert.deepEqual([...reports[0]!.leaked_refs], ["holdout://secret-case-1"]);
  assert.equal(reports[1]?.leaked, false);
});

test("judgeAuthorityPermitted allows a Judge alone for non-high-consequence decisions", () => {
  assert.equal(judgeAuthorityPermitted("advisory", false, false), true);
  assert.equal(judgeAuthorityPermitted("reversible", false, false), true);
  assert.equal(judgeAuthorityPermitted("controlled_side_effect", false, false), true);
});

test("judgeAuthorityPermitted denies a high_consequence decision backed by a Judge alone (SPEC-107 §4)", () => {
  assert.equal(judgeAuthorityPermitted("high_consequence", false, false), false);
});

test("judgeAuthorityPermitted allows a high_consequence decision corroborated by a deterministic oracle or human review", () => {
  assert.equal(judgeAuthorityPermitted("high_consequence", true, false), true);
  assert.equal(judgeAuthorityPermitted("high_consequence", false, true), true);
});
