/**
 * Shared MCP adapter: discover-or-accept UI map, then run a pure stub
 * generator (workflow / risk / strategy). Mirrors exploratory charter wiring.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { SemanticUiElement } from "../discovery/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type UiMapStubGenerator = (args: {
  elements: readonly SemanticUiElement[];
  source_url?: string;
  workspace_id: string;
  input: JsonObject;
}) => JsonObject;

export type UiMapStubRuntimeExecutorDependencies = Readonly<{
  discoverUiSurface: DiscoverUiSurface;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  tool_name: string;
  generate: UiMapStubGenerator;
  uncertainty_reasons?: readonly string[];
}>;

export class UiMapStubRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: UiMapStubRuntimeExecutorDependencies;

  constructor(dependencies: UiMapStubRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const url = readOptionalString(input.start_request.input["url"]);
    const priorElements = readElements(input.start_request.input["ui_map_elements"]);
    let elements: readonly SemanticUiElement[];
    let sourceUrl: string | undefined;
    const evidence: string[] = [];

    if (priorElements !== undefined) {
      elements = priorElements;
      sourceUrl = readOptionalString(input.start_request.input["source_url"]) ?? url;
      evidence.push("ui-map:caller-supplied");
    } else if (url !== undefined) {
      const discovered = await this.#dependencies.discoverUiSurface.discover({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        url,
      });
      if (!discovered.ok) {
        return {
          ok: false,
          failure: failure(
            discovered.failure.class === "authorization" ? "policy" : "skill",
            discovered.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
            discovered.failure.message,
            discovered.failure.retryable,
            discovered.failure.evidence,
          ),
        };
      }
      elements = discovered.value.elements;
      sourceUrl = discovered.value.source_url;
      evidence.push(`capture:${discovered.value.capture_id}`, `source-url:${discovered.value.source_url}`);
    } else {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          `${this.#dependencies.tool_name} requires url or a non-empty ui_map_elements array.`,
        ),
      };
    }

    const output = this.#dependencies.generate({
      elements,
      ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
      workspace_id: input.reference.workspace_id,
      input: input.start_request.input,
    });

    return {
      ok: true,
      value: {
        output,
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: priorElements !== undefined ? [] : ["playwright-dom-pipeline@0.1.0"],
        citations: unique(evidence),
        uncertainty: {
          level: "low",
          reasons: [
            ...(this.#dependencies.uncertainty_reasons ?? [
              "Stub is drafted from the Semantic UI Map only — not accepted BA/Risk/Strategy.",
            ]),
          ],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: priorElements !== undefined ? 0 : 1, retries: 0 },
        evidence: unique(evidence),
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: UiMapStubRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the UI-map stub executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "UI-map stub Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readOptionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readElements(value: JsonValue | undefined): readonly SemanticUiElement[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const elements: SemanticUiElement[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return undefined;
    const record = item as JsonObject;
    if (typeof record["id"] !== "string" || typeof record["kind"] !== "string" || typeof record["source_node_id"] !== "string") {
      return undefined;
    }
    if (record["kind"] !== "page" && record["kind"] !== "field" && record["kind"] !== "action") return undefined;
    if (typeof record["confidence"] !== "number") return undefined;
    const hint = record["interaction_hint"];
    elements.push({
      id: record["id"],
      kind: record["kind"],
      source_node_id: record["source_node_id"],
      confidence: record["confidence"],
      ...(typeof record["accessible_name"] === "string" ? { accessible_name: record["accessible_name"] } : {}),
      ...(typeof record["accessible_role"] === "string" ? { accessible_role: record["accessible_role"] } : {}),
      ...(hint === "editable" ||
      hint === "clickable" ||
      hint === "selectable" ||
      hint === "navigable" ||
      hint === "none"
        ? { interaction_hint: hint }
        : {}),
    });
  }
  return elements;
}
