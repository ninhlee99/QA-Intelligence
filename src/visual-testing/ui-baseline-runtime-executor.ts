/**
 * MCP adapters for capture_ui_baseline / compare_ui_baseline.
 */
import { join } from "node:path";

import { captureUiBaseline, compareUiBaseline } from "./ui-baseline.js";
import { isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type UiBaselineRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "capture" | "compare";
  rootDir?: string;
  clock?: { now(): Date };
}>;

export class UiBaselineRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: UiBaselineRuntimeExecutorDependencies;

  constructor(dependencies: UiBaselineRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const url = readString(input.start_request.input["url"]);
    const baselineId = readString(input.start_request.input["baseline_id"]);
    if (url === undefined || baselineId === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          `${this.#dependencies.mode === "capture" ? "capture_ui_baseline" : "compare_ui_baseline"} requires url and baseline_id.`,
        ),
      };
    }
    const browserRaw = readString(input.start_request.input["browser"]);
    const browser: BrowserName | undefined =
      browserRaw !== undefined && isBrowserName(browserRaw) ? browserRaw : undefined;
    const rootDir = this.#dependencies.rootDir ?? join(process.cwd(), ".qa-baselines");
    const workspaceId = input.reference.workspace_id;
    const now = this.#dependencies.clock?.now ?? (() => new Date());

    if (this.#dependencies.mode === "capture") {
      const captured = await captureUiBaseline({
        rootDir,
        workspace_id: workspaceId,
        baseline_id: baselineId,
        url,
        ...(browser !== undefined ? { browser } : {}),
        now,
      });
      if (!captured.ok) {
        return { ok: false, failure: failure("infrastructure", "infrastructure_failure", captured.message, true) };
      }
      return okResult(this.#dependencies, input, {
        ...captured.meta,
        note: "Baseline stored. Compare later via compare_ui_baseline — mismatch is observation only.",
      }, [`baseline:${baselineId}`, `png:${captured.meta.png_path}`]);
    }

    const compared = await compareUiBaseline({
      rootDir,
      workspace_id: workspaceId,
      baseline_id: baselineId,
      url,
      ...(browser !== undefined ? { browser } : {}),
      now,
    });
    if (!compared.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", compared.message) };
    }
    return okResult(
      this.#dependencies,
      input,
      {
        match: compared.match,
        note: compared.note,
        baseline: { ...compared.baseline },
        live: { ...compared.live },
      },
      [
        `baseline:${baselineId}`,
        `match:${compared.match}`,
        `live:${compared.live.png_path}`,
      ],
    );
  }
}

function okResult(
  dependencies: UiBaselineRuntimeExecutorDependencies,
  input: AgentRunExecutorInput,
  output: JsonObject,
  evidence: readonly string[],
): AgentRunExecutorResult {
  return {
    ok: true,
    value: {
      output,
      output_validated: true,
      satisfied_evidence_requirements: [],
      resolved_versions: {
        agent: `${dependencies.expected_agent.id}@${dependencies.expected_agent.version}`,
        policy: input.start_request.policy_version,
        skill: `${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`,
      },
      rule_results: [],
      skill_usage: [`${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`],
      tool_usage: ["playwright-screenshot"],
      citations: [...evidence],
      uncertainty: {
        level: "low",
        reasons: ["Exact PNG hash/dimensions only — not soft perceptual visual QA."],
      },
      policy_events: [],
      usage: { steps: 1, duration_seconds: 0, tool_calls: 1, retries: 0 },
      evidence: [...evidence],
      cleanup_status: "not_required",
      knowledge_candidates: [],
    },
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: UiBaselineRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "UI baseline Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
