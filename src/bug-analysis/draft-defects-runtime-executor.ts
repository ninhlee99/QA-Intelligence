/**
 * Standalone MCP adapter for draftDefectsFromQaRun (SPEC-211 draft path).
 * Same pure function `run_auto_qa` embeds — exposed for re-triage without
 * re-running the browser pipeline.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { draftDefectsFromQaRun } from "./draft-defects-from-qa-run.js";
import type { QaRunTestCaseResult } from "../reporting/qa-run-report.js";

export type DraftDefectsRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class DraftDefectsRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DraftDefectsRuntimeExecutorDependencies;

  constructor(dependencies: DraftDefectsRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input;
    const requirement_ref = typeof raw["requirement_ref"] === "string" ? raw["requirement_ref"].trim() : "";
    const target_url = typeof raw["target_url"] === "string" ? raw["target_url"].trim() : "";
    const environment_ref =
      typeof raw["environment_ref"] === "string" && raw["environment_ref"].trim()
        ? raw["environment_ref"].trim()
        : "unspecified";
    const casesRaw = raw["test_cases"];
    if (!requirement_ref || !target_url) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "draft_defects_from_qa_run requires requirement_ref and target_url.",
        ),
      };
    }
    if (!Array.isArray(casesRaw)) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "draft_defects_from_qa_run requires test_cases array."),
      };
    }

    const test_cases: QaRunTestCaseResult[] = [];
    for (const [index, item] of casesRaw.entries()) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", `test_cases[${index}] must be an object.`),
        };
      }
      const obj = item as JsonObject;
      const outcome = typeof obj["outcome"] === "string" ? obj["outcome"] : "";
      const allowedOutcomes = new Set([
        "passed",
        "failed",
        "flaky",
        "not_executed",
        "cancelled",
      ]);
      if (!allowedOutcomes.has(outcome)) {
        return {
          ok: false,
          failure: failure(
            "orchestration",
            "invalid_request",
            `test_cases[${index}].outcome must be passed|failed|flaky|not_executed|cancelled.`,
          ),
        };
      }
      const evidence = Array.isArray(obj["evidence"])
        ? obj["evidence"].filter((e): e is string => typeof e === "string")
        : [];
      const purpose =
        typeof obj["purpose"] === "string" && obj["purpose"].trim()
          ? obj["purpose"].trim()
          : typeof obj["title"] === "string" && obj["title"].trim()
            ? obj["title"].trim()
            : `case ${index + 1}`;
      test_cases.push({
        test_case_id: typeof obj["test_case_id"] === "string" ? obj["test_case_id"] : `case-${index + 1}`,
        purpose,
        variant: typeof obj["variant"] === "string" ? obj["variant"] : "positive",
        outcome: outcome as QaRunTestCaseResult["outcome"],
        evidence,
        ...(typeof obj["skip_reason"] === "string" ? { skip_reason: obj["skip_reason"] } : {}),
      });
    }

    const drafts = draftDefectsFromQaRun({
      workspace_id: input.reference.workspace_id,
      requirement_ref,
      target_url,
      environment_ref,
      test_cases,
    });

    return {
      ok: true,
      value: {
        output: {
          count: drafts.length,
          draft_defects: drafts as unknown as JsonValue,
          limitations: [
            "suspected_cause only — never confirmed_cause.",
            "Passed/not_executed/cancelled outcomes do not produce drafts.",
          ],
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: drafts.map((d) => `${d.id}@${d.version}`),
        uncertainty: { level: "low", reasons: ["Drafts are hypotheses for human triage."] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`requirement:${requirement_ref}`, `target-url:${target_url}`, `draft-count:${drafts.length}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DraftDefectsRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by draft-defects executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((s) => s.id === dependencies.expected_skill.id && s.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Draft defects Skill is not present in retained Skill authority.");
  }
  return undefined;
}
