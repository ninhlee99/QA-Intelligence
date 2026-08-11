/**
 * MCP/runtime adapter for AssessDefectQuality. Caller supplies a full Defect
 * object (typically a draft from run_auto_qa's draft_defects) — this executor
 * never invents defect content, only runs the governed quality rules.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { Defect } from "./public.js";
import type { AssessDefectQuality } from "./assess-defect-quality.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type DefectQualityRuntimeExecutorDependencies = Readonly<{
  reviewer: AssessDefectQuality;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class DefectQualityRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DefectQualityRuntimeExecutorDependencies;

  constructor(dependencies: DefectQualityRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const defect = readDefect(input.start_request.input["defect"]);
    if (defect === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "assess_defect_quality requires a defect object matching the Defect Contract (SPEC-211).",
        ),
      };
    }

    const review = await this.#dependencies.reviewer.review({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      defect,
    });
    if (!review.ok) {
      return {
        ok: false,
        failure: failure(
          review.failure.class === "authorization" ? "policy" : "skill",
          review.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          review.failure.message,
          review.failure.retryable,
          review.failure.evidence,
        ),
      };
    }

    const assessment = review.value;
    return {
      ok: true,
      value: {
        output: {
          id: assessment.id,
          defect_ref: assessment.defect_ref,
          workspace_id: assessment.workspace_id,
          outcome: assessment.outcome,
          verdict: assessment.verdict,
          findings: assessment.findings.map((finding) => ({
            id: finding.id,
            category: finding.category,
            severity: finding.severity,
            message: finding.message,
            evidence: [...finding.evidence],
            next_action: finding.next_action,
          })),
          questions: [...assessment.questions],
          evidence: [...assessment.evidence],
          uncertainty: { ...assessment.uncertainty, reasons: [...assessment.uncertainty.reasons] },
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [...assessment.rule_results],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: unique([...assessment.evidence, `defect:${assessment.defect_ref}`]),
        uncertainty: assessment.uncertainty,
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [...assessment.evidence],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DefectQualityRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Defect Quality executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Assess Defect Quality is not present in retained Skill authority.");
  }
  return undefined;
}

/** Fail closed: only a plain object with the required Defect Contract fields becomes a Defect. */
function readDefect(value: JsonValue | undefined): Defect | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const obj = value as JsonObject;
  const requiredStrings = [
    "id",
    "version",
    "status",
    "summary",
    "observed_behavior",
    "expected_behavior",
    "expected_behavior_authority",
    "workspace_scope",
    "environment_ref",
    "severity",
    "severity_rationale",
    "priority",
    "classification",
    "owner",
  ] as const;
  for (const key of requiredStrings) {
    if (typeof obj[key] !== "string" || (obj[key] as string).trim().length === 0) return undefined;
  }
  if (!Array.isArray(obj["reproduction_conditions"]) || obj["reproduction_conditions"].length === 0) return undefined;
  if (!Array.isArray(obj["evidence"]) || obj["evidence"].length === 0) return undefined;
  if (!obj["reproduction_conditions"].every((entry) => typeof entry === "string" && entry.trim().length > 0)) return undefined;
  if (!obj["evidence"].every((entry) => typeof entry === "string" && entry.trim().length > 0)) return undefined;

  return {
    id: obj["id"] as string,
    version: obj["version"] as string,
    status: obj["status"] as Defect["status"],
    summary: obj["summary"] as string,
    observed_behavior: obj["observed_behavior"] as string,
    expected_behavior: obj["expected_behavior"] as string,
    expected_behavior_authority: obj["expected_behavior_authority"] as string,
    workspace_scope: obj["workspace_scope"] as string,
    environment_ref: obj["environment_ref"] as string,
    reproduction_conditions: obj["reproduction_conditions"] as readonly string[],
    evidence: obj["evidence"] as readonly string[],
    severity: obj["severity"] as Defect["severity"],
    severity_rationale: obj["severity_rationale"] as string,
    priority: obj["priority"] as Defect["priority"],
    classification: obj["classification"] as Defect["classification"],
    owner: obj["owner"] as string,
    ...(typeof obj["suspected_cause"] === "string" ? { suspected_cause: obj["suspected_cause"] } : {}),
    ...(typeof obj["confirmed_cause"] === "string" ? { confirmed_cause: obj["confirmed_cause"] } : {}),
    ...(Array.isArray(obj["affected_requirement_refs"])
      ? { affected_requirement_refs: obj["affected_requirement_refs"].filter((e): e is string => typeof e === "string") }
      : {}),
    ...(Array.isArray(obj["related_test_refs"])
      ? { related_test_refs: obj["related_test_refs"].filter((e): e is string => typeof e === "string") }
      : {}),
    ...(Array.isArray(obj["related_execution_refs"])
      ? { related_execution_refs: obj["related_execution_refs"].filter((e): e is string => typeof e === "string") }
      : {}),
  };
}
