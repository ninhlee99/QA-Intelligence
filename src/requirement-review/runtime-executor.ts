import type {
  JsonObject,
  Requirement,
  RequirementAssessment,
  StableResult,
  VersionReference,
  WorkspaceContext,
} from "./public.js";
import type {
  AssessRequirementQuality,
  RequirementReviewFailure,
} from "./assess-requirement-quality.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type RequirementResolutionRequest = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  requirement_ref: string;
}>;

export type RequirementResolutionResult = StableResult<
  Requirement,
  AgentRunFailure
>;

export interface RequirementResolver {
  resolve(
    request: RequirementResolutionRequest,
  ): Promise<RequirementResolutionResult>;
}

export type RequirementReviewRuntimeExecutorDependencies = Readonly<{
  reviewer: AssessRequirementQuality;
  requirements: RequirementResolver;
  validateAssessment: (assessment: RequirementAssessment) => boolean;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

/** Runtime-owned adapter that invokes the Requirement Review Skill through retained input. */
export class RequirementReviewRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: RequirementReviewRuntimeExecutorDependencies;

  constructor(dependencies: RequirementReviewRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };
    const requirementRef = input.start_request.input.requirement_ref;
    if (typeof requirementRef !== "string" || requirementRef.trim().length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "Requirement Review execution requires an exact requirement_ref input.",
        ),
      };
    }

    const resolved = await this.#dependencies.requirements.resolve({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      requirement_ref: requirementRef,
    });
    if (!resolved.ok) return resolved;
    if (
      `${resolved.value.id}@${resolved.value.version}` !== requirementRef ||
      resolved.value.scope.workspace_id !== input.reference.workspace_id
    ) {
      return {
        ok: false,
        failure: failure(
          "policy",
          "context_contamination",
          "Resolved requirement does not match the retained reference and Workspace.",
          false,
          [requirementRef],
        ),
      };
    }

    const review = await this.#dependencies.reviewer.review({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      requirement: resolved.value,
    });
    if (!review.ok) {
      return { ok: false, failure: mapReviewFailure(review.failure) };
    }
    if (!safeValidate(this.#dependencies.validateAssessment, review.value)) {
      return {
        ok: false,
        failure: failure(
          "skill",
          "invalid_output",
          "Requirement assessment failed its governed output schema.",
          false,
          review.value.evidence,
        ),
      };
    }

    const satisfiedEvidenceRequirements = satisfiedRequirements(
      input.start_request.evidence_requirements ?? [],
      resolved.value,
    );
    const evidence = unique([
      ...review.value.evidence,
      ...review.value.findings.flatMap((finding) => finding.evidence),
      `assessment:${review.value.id}`,
      ...satisfiedEvidenceRequirements.map(
        (requirement) => `evidence-requirement:${requirement}`,
      ),
    ]);
    return {
      ok: true,
      value: {
        output: assessmentJson(review.value),
        output_validated: true,
        satisfied_evidence_requirements: satisfiedEvidenceRequirements,
        resolved_versions: {
          ...review.value.resolved_versions,
          requirement: requirementRef,
        },
        rule_results: [...review.value.rule_results],
        skill_usage: [
          `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        ],
        tool_usage: [],
        citations: unique([
          ...review.value.evidence,
          ...resolved.value.source,
          ...resolved.value.traceability.map((trace) => trace.target_id),
        ]),
        uncertainty: {
          level: review.value.uncertainty.level,
          reasons: [...review.value.uncertainty.reasons],
        },
        policy_events: evidence.filter(
          (entry) => entry.startsWith("authorization:") || entry.startsWith("policy:"),
        ),
        usage: {
          steps: 1,
          duration_seconds: 0,
          tool_calls: 0,
          retries: 0,
        },
        evidence,
        cleanup_status: "not_required",
        // ADR-015: this Skill is advisory and read-only; it never proposes
        // Knowledge Candidates for promotion.
        knowledge_candidates: [],
      },
    };
  }
}

function satisfiedRequirements(
  requirements: readonly string[],
  requirement: Requirement,
): string[] {
  return requirements.filter((expected) => {
    if (expected === "assessment-schema") return true;
    if (expected === "requirement-traceability") {
      return requirement.source.length > 0 && requirement.traceability.length > 0;
    }
    return false;
  });
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: RequirementReviewRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure(
      "orchestration",
      "incompatible_version",
      "Retained Agent version is not supported by the Requirement Review executor.",
    );
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id &&
        skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure(
      "policy",
      "authorization_denied",
      "Assess Requirement Quality is not present in retained Skill authority.",
    );
  }
  return undefined;
}

function mapReviewFailure(value: RequirementReviewFailure): AgentRunFailure {
  switch (value.class) {
    case "configuration":
      return failure("orchestration", "invalid_definition", value.message, value.retryable, value.evidence);
    case "authorization":
      return failure("policy", "authorization_denied", value.message, value.retryable, value.evidence);
    case "knowledge":
      return failure("infrastructure", "unavailable", value.message, value.retryable, value.evidence);
    case "rule":
      return failure("skill", "skill_failure", value.message, value.retryable, value.evidence);
    case "provider":
      return failure("provider", "provider_failure", value.message, value.retryable, value.evidence);
  }
}

function assessmentJson(value: RequirementAssessment): JsonObject {
  return {
    id: value.id,
    requirement_ref: value.requirement_ref,
    workspace_id: value.workspace_id,
    outcome: value.outcome,
    verdict: value.verdict,
    findings: value.findings.map((finding) => ({
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      message: finding.message,
      evidence: [...finding.evidence],
      next_action: finding.next_action,
    })),
    questions: [...value.questions],
    rule_results: [...value.rule_results],
    evidence: [...value.evidence],
    uncertainty: {
      level: value.uncertainty.level,
      reasons: [...value.uncertainty.reasons],
    },
    resolved_versions: { ...value.resolved_versions },
  };
}

function safeValidate(
  validate: (assessment: RequirementAssessment) => boolean,
  assessment: RequirementAssessment,
): boolean {
  try {
    return validate(assessment);
  } catch {
    return false;
  }
}
