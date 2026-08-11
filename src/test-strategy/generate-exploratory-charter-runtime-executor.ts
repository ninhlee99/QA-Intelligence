/**
 * Builds an exploratory charter from a URL (discover first) or a prior UI map.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import type { SemanticUiElement } from "../discovery/public.js";
import { generateExploratoryCharter } from "./generate-exploratory-charter.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type ExploratoryCharterRuntimeExecutorDependencies = Readonly<{
  discoverUiSurface: DiscoverUiSurface;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class ExploratoryCharterRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: ExploratoryCharterRuntimeExecutorDependencies;

  constructor(dependencies: ExploratoryCharterRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const url = readOptionalString(input.start_request.input["url"]);
    const priorElements = readElements(input.start_request.input["ui_map_elements"]);
    const objective = readOptionalString(input.start_request.input["objective"]);
    const requirementRef = readOptionalString(input.start_request.input["requirement_ref"]);

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
          "generate_exploratory_charter requires url or a non-empty ui_map_elements array.",
        ),
      };
    }

    const charter = generateExploratoryCharter({
      elements,
      ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
      ...(objective !== undefined ? { objective } : {}),
      ...(requirementRef !== undefined ? { requirement_ref: requirementRef } : {}),
    });

    return {
      ok: true,
      value: {
        output: {
          schema_version: charter.schema_version,
          title: charter.title,
          objective: charter.objective,
          source_url: charter.source_url ?? null,
          time_box_minutes: charter.time_box_minutes,
          focus_areas: [...charter.focus_areas],
          oracles: [...charter.oracles],
          risks_to_probe: [...charter.risks_to_probe],
          out_of_scope: [...charter.out_of_scope],
          notes_for_tester: [...charter.notes_for_tester],
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
        tool_usage: priorElements !== undefined ? [] : ["playwright-dom-pipeline@0.1.0"],
        citations: unique(evidence),
        uncertainty: { level: "low", reasons: ["Charter is a starting prompt for human exploration, not an execution verdict."] },
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
  dependencies: ExploratoryCharterRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Exploratory Charter executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Generate Exploratory Charter is not present in retained Skill authority.");
  }
  return undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readElements(value: JsonValue | undefined): readonly SemanticUiElement[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const elements: SemanticUiElement[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    if (typeof obj["id"] !== "string" || typeof obj["kind"] !== "string" || typeof obj["source_node_id"] !== "string") {
      return undefined;
    }
    if (obj["kind"] !== "page" && obj["kind"] !== "field" && obj["kind"] !== "action") return undefined;
    if (typeof obj["confidence"] !== "number") return undefined;
    const hint = readInteractionHint(obj["interaction_hint"]);
    elements.push({
      id: obj["id"],
      kind: obj["kind"],
      source_node_id: obj["source_node_id"],
      confidence: obj["confidence"],
      ...(typeof obj["accessible_name"] === "string" ? { accessible_name: obj["accessible_name"] } : {}),
      ...(typeof obj["accessible_role"] === "string" ? { accessible_role: obj["accessible_role"] } : {}),
      ...(hint !== undefined ? { interaction_hint: hint } : {}),
    });
  }
  return elements;
}

function readInteractionHint(value: unknown): SemanticUiElement["interaction_hint"] | undefined {
  if (
    value === "clickable" ||
    value === "editable" ||
    value === "selectable" ||
    value === "navigable" ||
    value === "none"
  ) {
    return value;
  }
  return undefined;
}
