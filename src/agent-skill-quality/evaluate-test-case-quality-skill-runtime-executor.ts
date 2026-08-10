/**
 * SPEC-213 dogfood MCP adapter: run evaluateTestCaseQualitySkill with
 * caller-supplied evaluation cases against the live AssessTestCaseQuality Skill.
 */
import { evaluateTestCaseQualitySkill } from "./evaluate-test-case-quality-skill.js";
import type { AssessTestCaseQuality, TestCaseReviewRequest } from "../test-design/assess-test-case-quality.js";
import type { TestCase } from "../test-design/public.js";
import type { EvaluationEvidenceVerifier } from "../evaluation/evaluation-manager.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type EvaluateTestCaseQualitySkillRuntimeExecutorDependencies = Readonly<{
  clock: { now(): Date };
  evidenceVerifier: EvaluationEvidenceVerifier;
  skill: AssessTestCaseQuality;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class EvaluateTestCaseQualitySkillRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: EvaluateTestCaseQualitySkillRuntimeExecutorDependencies;

  constructor(dependencies: EvaluateTestCaseQualitySkillRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const casesRaw = input.start_request.input["cases"];
    if (!Array.isArray(casesRaw) || casesRaw.length === 0) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "evaluate_test_case_quality_skill requires a non-empty cases array ({ case_id, expect_pass, test_case }).",
        ),
      };
    }

    const cases: Array<{
      case_id: string;
      expect_pass: boolean;
      request: TestCaseReviewRequest;
    }> = [];

    for (const entry of casesRaw) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        return { ok: false, failure: failure("orchestration", "invalid_request", "Each case must be an object.") };
      }
      const obj = entry as JsonObject;
      const caseId = typeof obj["case_id"] === "string" ? obj["case_id"].trim() : "";
      const testCase = obj["test_case"];
      if (caseId.length === 0 || testCase === null || typeof testCase !== "object" || Array.isArray(testCase)) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", "Each case requires case_id and test_case object."),
        };
      }
      cases.push({
        case_id: caseId,
        expect_pass: obj["expect_pass"] === true,
        request: {
          operation_id: `${input.execution.operation_id}:${caseId}`,
          workspace_id: input.reference.workspace_id,
          context: input.execution.workspace_context,
          test_case: testCase as unknown as TestCase,
        },
      });
    }

    const runId =
      (typeof input.start_request.input["run_id"] === "string" && input.start_request.input["run_id"].trim()) ||
      `eval-run:${input.execution.operation_id}`;
    const suiteId =
      (typeof input.start_request.input["suite_id"] === "string" && input.start_request.input["suite_id"].trim()) ||
      "suite:test-case-quality-dogfood";
    const critical =
      readStringArray(input.start_request.input["critical_invariant_ids"]) ?? ["invariant:expect-pass-alignment"];

    const result = await evaluateTestCaseQualitySkill(
      this.#dependencies.clock,
      this.#dependencies.evidenceVerifier,
      this.#dependencies.skill,
      {
        run_id: runId,
        workspace_id: input.reference.workspace_id,
        subject: {
          type: "skill",
          id: this.#dependencies.expected_skill.id,
          version: this.#dependencies.expected_skill.version,
        },
        suite: { id: suiteId, version: "0.1.0" },
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          policy: input.start_request.policy_version,
        },
        cases,
        critical_invariant_ids: critical,
      },
    );

    return {
      ok: true,
      value: {
        output: JSON.parse(JSON.stringify(result)) as JsonObject,
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: ["evaluation-manager@dogfood"],
        citations: [`workspace:${input.reference.workspace_id}`, `run:${runId}`],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: cases.length, duration_seconds: 0, tool_calls: cases.length, retries: 0 },
        evidence: [`run:${runId}`, `suite:${suiteId}`, `case-count:${cases.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: EvaluateTestCaseQualitySkillRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the skill-quality evaluator.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Skill-quality evaluator is not present in retained Skill authority.");
  }
  return undefined;
}

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((s) => s.trim());
  return items.length > 0 ? items : undefined;
}
