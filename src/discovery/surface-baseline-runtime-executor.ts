/**
 * MCP adapters for register_ui_surface_baseline / compare_ui_surface_to_baseline.
 */
import { join } from "node:path";

import {
  compareUiSurfaceToBaseline,
  registerUiSurfaceBaseline,
} from "./ui-surface-baseline.js";
import type { SemanticUiElement } from "./public.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type SurfaceBaselineRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "compare";
  rootDir?: string;
  clock?: { now(): Date };
}>;

export class SurfaceBaselineRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: SurfaceBaselineRuntimeExecutorDependencies;

  constructor(dependencies: SurfaceBaselineRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const baselineId = readString(input.start_request.input["baseline_id"]);
    const elements = readElements(input.start_request.input["elements"]);
    if (baselineId === undefined || elements === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "baseline_id and non-empty elements[] are required.",
        ),
      };
    }
    const rootDir = this.#dependencies.rootDir ?? join(process.cwd(), ".qa-surface-baselines");
    const label = readString(input.start_request.input["label"]);
    const sourceUrl = readString(input.start_request.input["source_url"]);
    const workspaceId = input.reference.workspace_id;

    if (this.#dependencies.mode === "register") {
      const registered = registerUiSurfaceBaseline({
        rootDir,
        workspace_id: workspaceId,
        baseline_id: baselineId,
        elements,
        ...(label !== undefined ? { label } : {}),
        ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
        ...(this.#dependencies.clock !== undefined
          ? { now: () => this.#dependencies.clock!.now() }
          : {}),
      });
      if (!registered.ok) {
        return { ok: false, failure: failure("orchestration", "invalid_request", registered.message) };
      }
      return {
        ok: true,
        value: {
          output: {
            baseline_id: registered.record.baseline_id,
            label: registered.record.label,
            element_count: registered.record.elements.length,
            persisted_path: registered.persisted_path,
            captured_at: registered.record.captured_at,
          },
          output_validated: true,
          satisfied_evidence_requirements: [],
          resolved_versions: versions(this.#dependencies, input),
          rule_results: [],
          skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
          tool_usage: [],
          citations: [`baseline:${baselineId}`, `persisted:${registered.persisted_path}`],
          uncertainty: { level: "low", reasons: ["Named-control snapshot only — not pixel visual."] },
          policy_events: [],
          usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
          evidence: [`baseline:${baselineId}`, `elements:${registered.record.elements.length}`],
          cleanup_status: "not_required",
          knowledge_candidates: [],
        },
      };
    }

    const compared = compareUiSurfaceToBaseline({
      rootDir,
      workspace_id: workspaceId,
      baseline_id: baselineId,
      elements,
      ...(label !== undefined ? { label } : {}),
    });
    if (!compared.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", compared.message) };
    }
    return {
      ok: true,
      value: {
        output: {
          baseline_label: compared.baseline_label,
          live_label: compared.live_label,
          only_in_baseline: [...compared.diff.only_in_a],
          only_in_live: [...compared.diff.only_in_b],
          shared: [...compared.diff.shared],
          summary: compared.diff.summary,
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [compared.diff.summary],
        uncertainty: {
          level: "low",
          reasons: ["Named controls only — Host interprets release drift meaning."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [
          `only-baseline:${compared.diff.only_in_a.length}`,
          `only-live:${compared.diff.only_in_b.length}`,
          `shared:${compared.diff.shared.length}`,
        ],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function versions(
  dependencies: SurfaceBaselineRuntimeExecutorDependencies,
  input: AgentRunExecutorInput,
): Record<string, string> {
  return {
    agent: `${dependencies.expected_agent.id}@${dependencies.expected_agent.version}`,
    policy: input.start_request.policy_version,
    skill: `${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`,
  };
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: SurfaceBaselineRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Surface baseline Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readElements(value: JsonValue | undefined): readonly SemanticUiElement[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const elements: SemanticUiElement[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    if (typeof obj["id"] !== "string" || typeof obj["kind"] !== "string") return undefined;
    if (obj["kind"] !== "page" && obj["kind"] !== "field" && obj["kind"] !== "action") return undefined;
    elements.push({
      id: obj["id"],
      kind: obj["kind"],
      source_node_id: typeof obj["source_node_id"] === "string" ? obj["source_node_id"] : `node:${obj["id"]}`,
      confidence: typeof obj["confidence"] === "number" ? obj["confidence"] : 1,
      ...(typeof obj["accessible_name"] === "string" ? { accessible_name: obj["accessible_name"] } : {}),
      ...(typeof obj["accessible_role"] === "string" ? { accessible_role: obj["accessible_role"] } : {}),
    });
  }
  return elements;
}
