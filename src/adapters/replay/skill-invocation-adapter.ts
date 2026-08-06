import {
  AssessRequirementQuality,
  type RequirementReviewFailure,
} from "../../requirement-review/assess-requirement-quality.js";
import type {
  JsonObject,
  Requirement,
  RequirementAssessment,
  VersionReference,
} from "../../requirement-review/public.js";
import type {
  Skill,
  SkillDescriptor,
  SkillInvocation,
  SkillMatchResult,
  SkillResult,
  SkillTaskContext,
  SkillValidationFailureReason,
  SkillValidationResult,
} from "../../skills/public.js";

/**
 * SPEC-509's required Skill Contract adapter for an existing, real Skill —
 * `AssessRequirementQuality` (SPEC-203) — rather than a purely synthetic
 * scenario. Translates `Skill.invoke()` into `AssessRequirementQuality.review()`
 * and its `RequirementReviewResult` back into `SkillResult`, proving the
 * new provider-neutral interface actually fits a Skill this repository
 * already runs in production-shaped tests (SPEC-213 dogfooding pattern),
 * not only a toy invocation built to satisfy the interface's own shape.
 *
 * This adapter owns no assessment logic of its own — every decision still
 * comes from `AssessRequirementQuality`; it only translates envelopes,
 * exactly as every other adapter seam in this repository does (ADR-016 §4's
 * "translate, do not decide" rule restated for the Skill seam).
 */
export class RequirementQualitySkill implements Skill {
  static readonly SKILL_ID = "assess-requirement-quality";
  static readonly SKILL_VERSION = "1.0.0";

  readonly #reviewer: AssessRequirementQuality;
  readonly #descriptor: SkillDescriptor;

  constructor(reviewer: AssessRequirementQuality, descriptor?: Partial<SkillDescriptor>) {
    this.#reviewer = reviewer;
    this.#descriptor = {
      skill: { id: RequirementQualitySkill.SKILL_ID, version: RequirementQualitySkill.SKILL_VERSION },
      definition_ref: "agent:requirement-review-agent@1.0.0/skill:assess-requirement-quality@1.0.0",
      trigger_model: ["requirement.submitted_for_review", "requirement.revised"],
      contract_versions: {
        input_schema: "requirement.schema.json@1.0.0",
        output_schema: "requirement-assessment.schema.json@1.0.0",
      },
      required_permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      dependencies: [],
      budgets: { max_duration_seconds: 120, max_tool_calls: 0 },
      side_effect_class: "advisory_output",
      consequence_class: "advisory",
      evaluation_suite_refs: ["evaluation-suite:requirement-quality@1.0.0"],
      ...descriptor,
    };
  }

  async describe(skillId: string, version: string): Promise<SkillDescriptor | undefined> {
    if (skillId !== this.#descriptor.skill.id || version !== this.#descriptor.skill.version) {
      return undefined;
    }
    return this.#descriptor;
  }

  async match(taskContext: SkillTaskContext): Promise<SkillMatchResult> {
    const requirement = readRequirement(taskContext.facts);
    if (requirement === undefined) {
      return {
        matched: false,
        confidence: 0,
        positive_evidence: [],
        negative_evidence: ["task context carries no requirement fact"],
        alternatives: [],
        conflicts: [],
        requires_human_selection: false,
      };
    }
    return {
      matched: true,
      confidence: 1,
      positive_evidence: [`requirement:${requirement.id}@${requirement.version} present in task context`],
      negative_evidence: [],
      alternatives: [],
      conflicts: [],
      requires_human_selection: false,
    };
  }

  async validate(invocation: SkillInvocation): Promise<SkillValidationResult> {
    const reasons: SkillValidationFailureReason[] = [];

    if (
      invocation.skill.id !== this.#descriptor.skill.id ||
      invocation.skill.version !== this.#descriptor.skill.version
    ) {
      reasons.push("unknown_skill_version");
    }
    for (const permission of this.#descriptor.required_permissions) {
      if (!invocation.workspace.permissions.includes(permission)) {
        reasons.push("missing_required_permission");
        break;
      }
    }
    if (readRequirement(invocation.input) === undefined) {
      reasons.push("invalid_input");
    }
    if (
      invocation.limits.max_duration_seconds !== undefined &&
      invocation.limits.max_duration_seconds > this.#descriptor.budgets.max_duration_seconds
    ) {
      reasons.push("budget_exceeds_declared_limits");
    }

    if (reasons.length > 0) {
      return { valid: false, reasons };
    }
    return { valid: true };
  }

  async invoke(invocation: SkillInvocation): Promise<SkillResult> {
    const validation = await this.validate(invocation);
    if (!validation.valid) {
      return {
        ok: false,
        failure: {
          class: "precondition",
          code: "invocation_failed_validation",
          message: `Invocation failed precondition checks: ${validation.reasons.join(", ")}`,
          retryable: false,
          evidence: [],
        },
      };
    }

    const requirement = readRequirement(invocation.input);
    if (requirement === undefined) {
      return {
        ok: false,
        failure: {
          class: "input",
          code: "missing_requirement_fact",
          message: "Invocation input does not carry a requirement fact.",
          retryable: false,
          evidence: [],
        },
      };
    }

    const reviewed = await this.#reviewer.review({
      operation_id: invocation.operation_id,
      workspace_id: invocation.workspace.workspace_id,
      context: invocation.workspace,
      requirement,
    });

    return translateReviewResult(reviewed);
  }
}

function readRequirement(payload: JsonObject): Requirement | undefined {
  const value = payload["requirement"];
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as unknown as Requirement;
}

function translateReviewResult(
  reviewed: Readonly<{ ok: true; value: RequirementAssessment }> | Readonly<{ ok: false; failure: RequirementReviewFailure }>,
): SkillResult {
  if (!reviewed.ok) {
    return {
      ok: false,
      failure: {
        class: mapFailureClass(reviewed.failure.class),
        code: reviewed.failure.code,
        message: reviewed.failure.message,
        retryable: reviewed.failure.retryable,
        evidence: reviewed.failure.evidence,
      },
    };
  }

  const assessment = reviewed.value;
  if (assessment.outcome !== "completed") {
    return {
      ok: false,
      failure: {
        class: assessment.outcome === "blocked" ? "precondition" : "provider",
        code: `assessment_${assessment.outcome}`,
        message: `Requirement assessment did not complete: ${assessment.outcome}.`,
        retryable: false,
        evidence: assessment.evidence,
      },
    };
  }

  return {
    ok: true,
    value: {
      output: { assessment_id: assessment.id, verdict: assessment.verdict, findings: assessment.findings },
      postconditions_satisfied: assessment.rule_results,
      evidence: assessment.evidence,
      tool_intents: [],
      usage: { duration_seconds: 0 },
      uncertainty: assessment.uncertainty,
      escalation_required: assessment.questions.length > 0,
    },
  };
}

function mapFailureClass(
  failureClass: RequirementReviewFailure["class"],
): "precondition" | "authorization" | "input" | "dependency" | "provider" {
  switch (failureClass) {
    case "authorization":
      return "authorization";
    case "configuration":
      return "precondition";
    case "knowledge":
      return "dependency";
    case "rule":
      return "input";
    case "provider":
      return "provider";
  }
}

export function requirementSkillInvocation(
  overrides: Partial<SkillInvocation> & Readonly<{ workspace: SkillInvocation["workspace"]; input: JsonObject }>,
): SkillInvocation {
  const skill: VersionReference = { id: RequirementQualitySkill.SKILL_ID, version: RequirementQualitySkill.SKILL_VERSION };
  return {
    skill,
    operation_id: "operation-skill-invoke-1",
    run_id: "run-skill-invoke-1",
    authorized_context_refs: [],
    tool_capabilities: [],
    policy_version: overrides.workspace.policy_version,
    limits: { max_duration_seconds: 120 },
    idempotency_key: "idempotency-skill-invoke-1",
    ...overrides,
  };
}
