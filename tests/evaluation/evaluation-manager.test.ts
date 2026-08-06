import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EvaluationManager,
  StaticEvaluationSuitePolicyRegistry,
  type CalibrationResult,
  type Clock,
  type EvaluationInput,
  type EvaluationEvidenceVerifier,
  type EvaluationSuitePolicy,
  type FailureClass,
  type JudgeVerdict,
  type OracleLabel,
} from "../../src/evaluation/evaluation-manager.js";
import {
  SchemaValidator,
  type SchemaObject,
} from "../../src/schema/schema-validator.js";

class SequenceClock implements Clock {
  readonly #times: readonly Date[];
  #index = 0;

  constructor(...times: readonly string[]) {
    this.#times = times.map((time) => new Date(time));
  }

  now(): Date {
    const time = this.#times[this.#index];
    assert.ok(time, "the test clock has a timestamp for every call");
    this.#index += 1;
    return time;
  }
}

const PASSING_POLICY: EvaluationSuitePolicy = {
  suite: { id: "requirement-quality-core", version: "1.2.0" },
  required_case_ids: ["case-clear-requirement"],
  critical_invariant_ids: ["workspace-isolation", "evidence-grounding"],
  minimum_trials_per_case: 1,
};

function evaluationManager(
  times: readonly string[],
  policies: readonly EvaluationSuitePolicy[] = [PASSING_POLICY],
  evidenceVerifier: EvaluationEvidenceVerifier = { verify: () => true },
): EvaluationManager {
  return new EvaluationManager(
    new SequenceClock(...times),
    new StaticEvaluationSuitePolicyRegistry(policies),
    evidenceVerifier,
  );
}

function passingInput(): EvaluationInput {
  return {
    run_id: "run-001",
    workspace_id: "workspace-alpha",
    subject: { type: "skill", id: "assess-requirement-quality", version: "1.0.0" },
    suite: { id: "requirement-quality-core", version: "1.2.0" },
    resolved_versions: {
      policy: "policy@4.0.0",
      dataset: "dataset@7.0.0",
      evaluator: "deterministic-oracle@2.0.0",
      environment: "replay-environment@3.0.0",
    },
    trial_results: [
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-001",
        outcome: "passed",
        failure_class: "none",
        evidence: ["evidence://trial-001/output", "evidence://trial-001/oracle"],
      },
    ],
    critical_invariants: [
      { id: "workspace-isolation", passed: true },
      { id: "evidence-grounding", passed: true },
    ],
  };
}

test("recommends release only when every required trial and critical invariant passes", () => {
  const manager = evaluationManager([
    "2026-08-03T01:00:00.000Z",
    "2026-08-03T01:00:01.000Z",
  ]);

  const result = manager.evaluate(passingInput());

  assert.equal(result.verdict, "passed");
  assert.equal(result.recommendation, "recommend_release");
  assert.deepEqual(result.subject, passingInput().subject);
  assert.deepEqual(result.suite, passingInput().suite);
  assert.equal(result.workspace_id, "workspace-alpha");
  assert.deepEqual(result.resolved_versions, passingInput().resolved_versions);
  assert.equal(result.started_at, "2026-08-03T01:00:00.000Z");
  assert.equal(result.completed_at, "2026-08-03T01:00:01.000Z");
});

test("rejects release when any critical invariant fails even if every trial passes", () => {
  const manager = evaluationManager(
    ["2026-08-03T02:00:00.000Z", "2026-08-03T02:00:01.000Z"],
    [{ ...PASSING_POLICY, critical_invariant_ids: ["task-success", "workspace-isolation"] }],
  );
  const input: EvaluationInput = {
    ...passingInput(),
    critical_invariants: [
      { id: "task-success", passed: true },
      { id: "workspace-isolation", passed: false },
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "failed");
  assert.equal(result.recommendation, "reject_release");
  assert.equal(result.metrics.passed_trials, 1);
  assert.equal(result.metrics.critical_invariants_passed, 1);
});

test("reports evaluator, infrastructure, and invalid-test failures as indeterminate", () => {
  const nonSubjectFailures = ["evaluator", "infrastructure", "invalid_test"] satisfies readonly FailureClass[];

  for (const failureClass of nonSubjectFailures) {
    const manager = evaluationManager([
      "2026-08-03T03:00:00.000Z",
      "2026-08-03T03:00:01.000Z",
    ]);
    const input: EvaluationInput = {
      ...passingInput(),
      trial_results: [
        {
          case_id: "case-clear-requirement",
          trial_id: `trial-${failureClass}`,
          outcome: "failed",
          failure_class: failureClass,
          evidence: [`evidence://${failureClass}/diagnostic`],
        },
      ],
    };

    const result = manager.evaluate(input);

    assert.equal(result.verdict, "indeterminate", failureClass);
    assert.equal(result.recommendation, "indeterminate", failureClass);
    assert.equal(result.trial_results[0]?.failure_class, failureClass);
  }
});

test("attributes an evidenced subject failure to the subject and rejects release", () => {
  const manager = evaluationManager([
    "2026-08-03T04:00:00.000Z",
    "2026-08-03T04:00:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    trial_results: [
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-subject-failure",
        outcome: "failed",
        failure_class: "subject",
        evidence: ["evidence://trial-subject-failure/assertion"],
      },
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "failed");
  assert.equal(result.recommendation, "reject_release");
});

test("missing evidence makes even a claimed subject failure indeterminate", () => {
  const manager = evaluationManager([
    "2026-08-03T05:00:00.000Z",
    "2026-08-03T05:00:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    trial_results: [
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-missing-evidence",
        outcome: "failed",
        failure_class: "subject",
        evidence: [],
      },
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.recommendation, "indeterminate");
  assert.deepEqual(result.evidence, ["invalid-test:missing-trial-evidence"]);
});

test("retains every attempt and every evidence reference instead of selecting a favorable retry", () => {
  const manager = evaluationManager([
    "2026-08-03T06:00:00.000Z",
    "2026-08-03T06:00:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    trial_results: [
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-retried-attempt-1",
        outcome: "failed",
        failure_class: "evaluator",
        evidence: ["evidence://attempt-1/error", "evidence://shared/context"],
      },
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-retried-attempt-2",
        outcome: "passed",
        failure_class: "none",
        evidence: ["evidence://attempt-2/output", "evidence://shared/context"],
      },
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.deepEqual(result.trial_results, input.trial_results);
  assert.deepEqual(result.evidence, [
    "evidence://attempt-1/error",
    "evidence://shared/context",
    "evidence://attempt-2/output",
    "evidence://shared/context",
  ]);
  assert.equal(result.metrics.total_trials, 2);
  assert.equal(result.metrics.evidence_reference_count, 4);
});

test("never turns a blocked or cancelled evaluation into a favorable recommendation", () => {
  const blockedManager = evaluationManager([
    "2026-08-03T07:00:00.000Z",
    "2026-08-03T07:00:01.000Z",
  ]);
  const blockedInput: EvaluationInput = {
    ...passingInput(),
    trial_results: [
      {
        case_id: "case-clear-requirement",
        trial_id: "trial-blocked",
        outcome: "blocked",
        failure_class: "policy_denial",
        evidence: ["evidence://trial-blocked/policy"],
      },
    ],
  };
  const cancelledManager = evaluationManager([
    "2026-08-03T07:01:00.000Z",
    "2026-08-03T07:01:01.000Z",
  ]);
  const cancelledInput: EvaluationInput = {
    ...passingInput(),
    campaign_state: "cancelled",
  };

  const blocked = blockedManager.evaluate(blockedInput);
  const cancelled = cancelledManager.evaluate(cancelledInput);

  assert.equal(blocked.verdict, "blocked");
  assert.equal(blocked.recommendation, "indeterminate");
  assert.equal(cancelled.verdict, "indeterminate");
  assert.equal(cancelled.recommendation, "indeterminate");
});

test("never recommends release before the immutable suite minimum trial count is met", () => {
  const manager = evaluationManager(
    ["2026-08-03T08:00:00.000Z", "2026-08-03T08:00:01.000Z"],
    [{ ...PASSING_POLICY, minimum_trials_per_case: 3 }],
  );
  const input: EvaluationInput = passingInput();

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.recommendation, "indeterminate");
  assert.deepEqual(result.metrics.invalid_test_reasons, [
    "minimum-trials-not-met:case-clear-requirement",
  ]);
});

test("rejects a suite reference that is absent from the accepted policy registry", () => {
  const manager = evaluationManager(
    ["2026-08-03T08:30:00.000Z", "2026-08-03T08:30:01.000Z"],
    [],
  );

  const result = manager.evaluate(passingInput());

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.recommendation, "indeterminate");
  assert.deepEqual(result.metrics.invalid_test_reasons, ["unknown-suite-policy"]);
  assert.deepEqual(result.evidence.at(-1), "invalid-test:unknown-suite-policy");
});

test("rejects caller-supplied trial and invariant facts without trusted evidence verification", () => {
  const manager = evaluationManager(
    ["2026-08-03T08:45:00.000Z", "2026-08-03T08:45:01.000Z"],
    [PASSING_POLICY],
    { verify: () => false },
  );

  const result = manager.evaluate(passingInput());

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.recommendation, "indeterminate");
  assert.equal(
    result.metrics.invalid_test_reasons.includes(
      "unverified-evaluation-evidence",
    ),
    true,
  );
});

test("rejects fabricated version pins, duplicate trials, and contradictory outcomes", () => {
  const manager = evaluationManager([
    "2026-08-03T09:00:00.000Z",
    "2026-08-03T09:00:01.000Z",
  ]);
  const base = passingInput();
  const input: EvaluationInput = {
    ...base,
    resolved_versions: { policy: "latest" },
    trial_results: [
      {
        ...base.trial_results[0]!,
        outcome: "passed",
        failure_class: "subject",
      },
      {
        ...base.trial_results[0]!,
      },
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.recommendation, "indeterminate");
  assert.deepEqual(result.metrics.invalid_test_reasons, [
    "unresolved-version",
    "duplicate-trial-id",
    "inconsistent-trial-outcome",
  ]);
});

test("emits an Evaluation Result that conforms to its governed schema", async () => {
  const schema = JSON.parse(
    await readFile("schemas/evaluation-result.schema.json", "utf8"),
  ) as SchemaObject;
  const result = evaluationManager([
    "2026-08-03T10:00:00.000Z",
    "2026-08-03T10:00:01.000Z",
  ]).evaluate(passingInput());

  const validation = new SchemaValidator([schema]).validate(
    "https://qa-intelligence.local/schemas/evaluation-result.schema.json",
    result,
  );

  assert.equal(validation.ok, true, JSON.stringify(validation));
});

function judgeVerdict(overrides: Partial<JudgeVerdict> = {}): JudgeVerdict {
  return {
    judge_id: "judge-alpha",
    judge_version: "1.0.0",
    case_id: "case-clear-requirement",
    trial_id: "trial-001",
    subject_id: "assess-requirement-quality@1.0.0",
    verdict: "passed",
    confidence: 0.9,
    rationale: "meets the rubric anchors",
    context_refs: ["evidence://trial-001/rubric"],
    ...overrides,
  };
}

test("a clean set of Judge verdicts with no integrity findings does not affect an otherwise passing verdict (SPEC-310 §2)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:00:00.000Z",
    "2026-08-06T09:00:01.000Z",
  ]);
  const input: EvaluationInput = { ...passingInput(), judge_verdicts: [judgeVerdict()] };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "passed");
  assert.deepEqual(result.metrics.invalid_test_reasons, []);
});

test("real Judge disagreement makes the verdict indeterminate instead of silently passing (SPEC-310 §2)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:05:00.000Z",
    "2026-08-06T09:05:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    judge_verdicts: [
      judgeVerdict({ judge_id: "judge-alpha", verdict: "passed" }),
      judgeVerdict({ judge_id: "judge-beta", verdict: "failed" }),
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.ok(result.metrics.invalid_test_reasons.some((reason) => reason.startsWith("judge-disagreement:")));
});

test("a Judge evaluating its own subject is flagged and makes the verdict indeterminate (SPEC-107 §4)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:10:00.000Z",
    "2026-08-06T09:10:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    judge_verdicts: [
      judgeVerdict({ judge_id: "assess-requirement-quality@1.0.0", subject_id: "assess-requirement-quality@1.0.0" }),
    ],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.ok(result.metrics.invalid_test_reasons.some((reason) => reason.startsWith("judge-self-evaluation:")));
});

test("a Judge that received a hidden holdout reference is flagged as contamination (SPEC-107 §6)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:15:00.000Z",
    "2026-08-06T09:15:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    judge_verdicts: [judgeVerdict({ context_refs: ["evidence://trial-001/rubric", "holdout://secret-case"] })],
    hidden_holdout_refs: ["holdout://secret-case"],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.ok(result.metrics.invalid_test_reasons.some((reason) => reason.startsWith("judge-hidden-holdout-leakage:")));
});

function oracleLabel(overrides: Partial<OracleLabel> = {}): OracleLabel {
  return { case_id: "case-clear-requirement", trial_id: "trial-001", correct_verdict: "passed", ...overrides };
}

test("a Judge that matches its oracle label is not flagged — real calibration, not a fabricated pass (SPEC-310 §2)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:20:00.000Z",
    "2026-08-06T09:20:01.000Z",
  ]);
  const input: EvaluationInput = {
    ...passingInput(),
    judge_verdicts: [judgeVerdict({ verdict: "passed" })],
    oracle_labels: [oracleLabel({ correct_verdict: "passed" })],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "passed");
  assert.deepEqual(result.metrics.invalid_test_reasons, []);
});

test("real calibration drift against prior history makes the verdict indeterminate instead of trusting a degraded Judge (SPEC-310 §2)", () => {
  const manager = evaluationManager([
    "2026-08-06T09:25:00.000Z",
    "2026-08-06T09:25:01.000Z",
  ]);
  const priorCalibration: CalibrationResult = {
    judge_id: "judge-alpha",
    judge_version: "1.0.0",
    sample_size: 10,
    correct: 9,
    accuracy: 0.9,
    mismatches: [],
  };
  const input: EvaluationInput = {
    ...passingInput(),
    // This run's single verdict disagrees with its oracle label, so the
    // freshly computed calibration for this run is 0/1 = 0 accuracy — a
    // real, computed decline from the prior 0.9, not an asserted one.
    judge_verdicts: [judgeVerdict({ verdict: "failed" })],
    oracle_labels: [oracleLabel({ correct_verdict: "passed" })],
    judge_calibration_history: [priorCalibration],
    judge_drift_threshold: 0.2,
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.ok(result.metrics.invalid_test_reasons.includes("judge-calibration-drift:judge-alpha"));
});

test("a high_consequence suite backed by a Judge alone, with no oracle corroboration, is denied (SPEC-107 §4)", () => {
  const highConsequencePolicy: EvaluationSuitePolicy = { ...PASSING_POLICY, consequence_class: "high_consequence" };
  const manager = evaluationManager(
    ["2026-08-06T09:30:00.000Z", "2026-08-06T09:30:01.000Z"],
    [highConsequencePolicy],
  );
  const input: EvaluationInput = { ...passingInput(), judge_verdicts: [judgeVerdict()] };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "indeterminate");
  assert.ok(result.metrics.invalid_test_reasons.includes("judge-sole-authority-for-high-consequence-decision"));
});

test("a high_consequence suite is permitted when a Judge verdict is corroborated by real oracle labels (SPEC-107 §4)", () => {
  const highConsequencePolicy: EvaluationSuitePolicy = { ...PASSING_POLICY, consequence_class: "high_consequence" };
  const manager = evaluationManager(
    ["2026-08-06T09:35:00.000Z", "2026-08-06T09:35:01.000Z"],
    [highConsequencePolicy],
  );
  const input: EvaluationInput = {
    ...passingInput(),
    judge_verdicts: [judgeVerdict({ verdict: "passed" })],
    oracle_labels: [oracleLabel({ correct_verdict: "passed" })],
  };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "passed");
  assert.equal(result.metrics.invalid_test_reasons.includes("judge-sole-authority-for-high-consequence-decision"), false);
});

test("a non-high_consequence suite with a Judge alone and no oracle is not gated by the authority limit", () => {
  const manager = evaluationManager([
    "2026-08-06T09:40:00.000Z",
    "2026-08-06T09:40:01.000Z",
  ]);
  const input: EvaluationInput = { ...passingInput(), judge_verdicts: [judgeVerdict()] };

  const result = manager.evaluate(input);

  assert.equal(result.verdict, "passed");
  assert.equal(result.metrics.invalid_test_reasons.includes("judge-sole-authority-for-high-consequence-decision"), false);
});
