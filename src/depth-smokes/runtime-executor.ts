/**
 * Runtime adapter for RunDepthSmokes (Phase 10).
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { DepthSmokeFailure, DepthSmokeStage, RunDepthSmokes } from "./run-depth-smokes.js";

export type DepthSmokesRuntimeExecutorDependencies = Readonly<{
  skill: RunDepthSmokes;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

const STAGES = new Set<DepthSmokeStage>(["a11y_subset", "axe", "perf", "security"]);

export class DepthSmokesRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DepthSmokesRuntimeExecutorDependencies;

  constructor(dependencies: DepthSmokesRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const raw = input.start_request.input;
    const url = typeof raw["url"] === "string" ? raw["url"].trim() : "";
    if (!url) {
      return { ok: false, failure: failure("orchestration", "invalid_request", "run_depth_smokes requires url.") };
    }

    let browser: BrowserName | undefined;
    const browserRaw = typeof raw["browser"] === "string" ? raw["browser"].trim() : "";
    if (browserRaw) {
      const name = browserRaw.toLowerCase();
      if (!isBrowserName(name)) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", `browser must be chromium|firefox|webkit (got "${browserRaw}").`),
        };
      }
      browser = name;
    }

    let stages: DepthSmokeStage[] | undefined;
    const stagesRaw = raw["stages"];
    if (Array.isArray(stagesRaw) && stagesRaw.length > 0) {
      stages = [];
      for (const item of stagesRaw) {
        if (typeof item !== "string" || !STAGES.has(item as DepthSmokeStage)) {
          return {
            ok: false,
            failure: failure(
              "orchestration",
              "invalid_request",
              `stages[] entries must be a11y_subset|perf|security (got ${JSON.stringify(item)}).`,
            ),
          };
        }
        stages.push(item as DepthSmokeStage);
      }
    }

    const thresholdRaw = raw["perf_threshold_ms"];
    const perf_threshold_ms =
      typeof thresholdRaw === "number" && Number.isFinite(thresholdRaw) && thresholdRaw > 0
        ? thresholdRaw
        : undefined;

    const run = await this.#dependencies.skill.run({
      operation_id: input.execution.operation_id,
      workspace_id: input.reference.workspace_id,
      context: input.execution.workspace_context,
      url,
      ...(browser !== undefined ? { browser } : {}),
      ...(stages !== undefined ? { stages } : {}),
      ...(perf_threshold_ms !== undefined ? { perf_threshold_ms } : {}),
    });
    if (!run.ok) return { ok: false, failure: mapSkillFailure(run.failure) };

    const report = run.value;
    const evidence = unique([...report.evidence, `depth-smoke:${report.id}`]);
    return {
      ok: true,
      value: {
        output: reportToJson(report),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [`browser:${report.browser}`],
        citations: evidence,
        uncertainty: {
          level: report.has_critical ? "high" : "low",
          reasons: report.has_critical
            ? ["Critical depth-smoke findings present — do not hide behind green pass counts."]
            : [],
        },
        policy_events: [],
        usage: {
          steps: report.stages.length,
          duration_seconds: report.timing.duration_seconds,
          tool_calls: 1,
          retries: 0,
        },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function reportToJson(report: import("./run-depth-smokes.js").DepthSmokeReport): JsonObject {
  return {
    id: report.id,
    source_url: report.source_url,
    browser: report.browser,
    stages: [...report.stages],
    findings: report.findings.map((f) => ({
      id: f.id,
      stage: f.stage,
      category: f.category,
      severity: f.severity,
      message: f.message,
      evidence: [...f.evidence],
    })),
    summary: { ...report.summary },
    has_critical: report.has_critical,
    perf: report.perf
      ? {
          load_event_end_ms: report.perf.load_event_end_ms,
          threshold_ms: report.perf.threshold_ms,
          within_threshold: report.perf.within_threshold,
        }
      : null,
    limitations: [...report.limitations],
    evidence: [...report.evidence],
    timing: { ...report.timing },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DepthSmokesRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the depth-smokes executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Depth smokes Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function mapSkillFailure(skillFailure: DepthSmokeFailure): AgentRunFailure {
  if (skillFailure.class === "authorization") {
    return failure("policy", "authorization_denied", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  if (skillFailure.class === "infrastructure") {
    return failure("infrastructure", "infrastructure_failure", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
  }
  return failure("orchestration", "invalid_request", skillFailure.message, skillFailure.retryable, skillFailure.evidence);
}
