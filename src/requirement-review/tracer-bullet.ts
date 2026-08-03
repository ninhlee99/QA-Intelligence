import {
  type EvaluationInput,
  EvaluationManager,
  type EvaluationResult,
  type FailureClass,
  type SuiteReference,
} from "../evaluation/evaluation-manager.js";
import {
  type AssessRequirementQuality,
  type RequirementReviewRequest,
  type RequirementReviewResult,
} from "./assess-requirement-quality.js";
import type { Requirement, RequirementAssessment, WorkspaceContext } from "./public.js";

export type RequirementReviewDevelopmentHarnessInput = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  requirement: Requirement;
  evaluation_run_id: string;
  evaluation_suite: SuiteReference;
}>;

export type RequirementReviewDevelopmentHarnessResult = Readonly<{
  review: RequirementReviewResult;
  evaluation: EvaluationResult;
}>;

type Dependencies = Readonly<{
  reviewer: AssessRequirementQuality;
  evaluator: EvaluationManager;
  validateAssessment: (value: RequirementAssessment) => boolean;
}>;

/**
 * Development-only composition harness for the first vertical slice. It does
 * not replace the SPEC-508 Agent Runtime or SPEC-511 Evaluation Adapter and
 * must never be used as enablement/release evidence by itself. It evaluates
 * whether the Skill performed the review correctly; it never treats a poor
 * requirement as a failed Skill.
 */
export class RequirementReviewDevelopmentHarness {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async execute(
    input: RequirementReviewDevelopmentHarnessInput,
  ): Promise<RequirementReviewDevelopmentHarnessResult> {
    const request: RequirementReviewRequest = {
      operation_id: input.operation_id,
      workspace_id: input.workspace_id,
      context: input.context,
      requirement: input.requirement,
    };
    const review = await this.#dependencies.reviewer.review(request);

    if (!review.ok) {
      return {
        review,
        evaluation: this.#dependencies.evaluator.evaluate({
          run_id: input.evaluation_run_id,
          workspace_id: input.workspace_id,
          subject: {
            type: "skill",
            id: "assess-requirement-quality",
            version: "unresolved",
          },
          suite: { ...input.evaluation_suite },
          resolved_versions: {
            policy: input.context.policy_version,
            requirement: `${input.requirement.id}@${input.requirement.version}`,
          },
          trial_results: [
            {
              case_id: "requirement-review-execution",
              trial_id: `${input.operation_id}:trial-1`,
              outcome: review.failure.outcome,
              failure_class: evaluationFailureClass(
                review.failure.class,
                review.failure.code,
              ),
              evidence:
                review.failure.evidence.length === 0
                  ? [`failure:${review.failure.class}:${review.failure.code}`]
                  : [...review.failure.evidence],
            },
          ],
          critical_invariants: [
            { id: "assessment-schema", passed: false },
            {
              id: "workspace-isolation",
              passed:
                input.workspace_id === input.context.workspace_id &&
                input.requirement.scope.workspace_id === input.workspace_id,
            },
            {
              id: "evidence-completeness",
              passed: review.failure.evidence.length > 0,
            },
            { id: "exact-version-pins", passed: false },
          ],
          campaign_state:
            review.failure.outcome === "blocked" ? "blocked" : "completed",
        }),
      };
    }

    const assessment = review.value;
    const criticalInvariants = [
      {
        id: "assessment-schema",
        passed: this.#dependencies.validateAssessment(assessment),
      },
      {
        id: "workspace-isolation",
        passed:
          assessment.workspace_id === input.workspace_id &&
          input.workspace_id === input.context.workspace_id,
      },
      {
        id: "evidence-completeness",
        passed: hasCompleteEvidence(assessment),
      },
      {
        id: "exact-version-pins",
        passed: hasExactVersionPins(assessment),
      },
    ] as const;
    const invariantFailures = criticalInvariants
      .filter((invariant) => !invariant.passed)
      .map((invariant) => `critical-invariant:${invariant.id}:failed`);
    const taskPassed = invariantFailures.length === 0;
    const evaluationInput: EvaluationInput = {
      run_id: input.evaluation_run_id,
      workspace_id: input.workspace_id,
      subject: {
        type: "skill",
        ...parseVersionReference(assessment.resolved_versions.skill),
      },
      suite: { ...input.evaluation_suite },
      resolved_versions: {
        ...assessment.resolved_versions,
        requirement: assessment.requirement_ref,
      },
      trial_results: [
        {
          case_id: "requirement-review-execution",
          trial_id: `${input.operation_id}:trial-1`,
          outcome: taskPassed ? "passed" : "failed",
          failure_class: taskPassed ? "none" : "subject",
          evidence: unique([
            ...assessment.evidence,
            ...invariantFailures,
            `assessment:${assessment.id}`,
          ]),
        },
      ],
      critical_invariants: criticalInvariants,
      campaign_state: "completed",
    };

    return {
      review,
      evaluation: this.#dependencies.evaluator.evaluate(evaluationInput),
    };
  }
}

function evaluationFailureClass(
  failureClass: "configuration" | "authorization" | "knowledge" | "rule" | "provider",
  failureCode?: string,
): FailureClass {
  switch (failureClass) {
    case "configuration":
      return "invalid_test";
    case "authorization":
      return "policy_denial";
    case "knowledge":
      return failureCode === "forbidden" || failureCode === "unauthorized"
        ? "policy_denial"
        : "infrastructure";
    case "provider":
      return "infrastructure";
    case "rule":
      return failureCode === "authorization_denied"
        ? "policy_denial"
        : "indeterminate";
  }
}

function hasExactVersionPins(assessment: RequirementAssessment): boolean {
  const pins = assessment.resolved_versions;
  const versionReference = /^[a-z0-9][a-z0-9._/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z.-]+)?$/i;
  const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9a-z.-]+)?$/i;
  return (
    versionReference.test(pins.agent) &&
    versionReference.test(pins.skill) &&
    versionReference.test(pins.prompt) &&
    versionReference.test(pins.rule_set) &&
    semanticVersion.test(pins.knowledge_snapshot) &&
    versionReference.test(pins.policy) &&
    versionReference.test(pins.input_schema) &&
    versionReference.test(pins.output_schema)
  );
}

function hasCompleteEvidence(assessment: RequirementAssessment): boolean {
  if (assessment.evidence.length === 0) {
    return false;
  }
  if (
    assessment.findings.some(
      (finding) => finding.evidence.length === 0 || finding.next_action.length === 0,
    )
  ) {
    return false;
  }
  return assessment.outcome !== "indeterminate" || assessment.questions.length > 0;
}

function parseVersionReference(reference: string): { id: string; version: string } {
  const separator = reference.lastIndexOf("@");
  return separator > 0
    ? { id: reference.slice(0, separator), version: reference.slice(separator + 1) }
    : { id: reference, version: "unresolved" };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
