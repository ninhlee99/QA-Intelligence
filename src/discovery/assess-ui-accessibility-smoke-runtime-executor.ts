/**
 * Discovers a URL (or accepts a prior Semantic UI Map fragment) and runs
 * accessibility naming smoke. Observation-only — uses discovery:observe.
 */
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "./discover-ui-surface.js";
import { assessUiAccessibilitySmoke } from "./assess-ui-accessibility-smoke.js";
import type { SemanticUiElement } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type AccessibilitySmokeRuntimeExecutorDependencies = Readonly<{
  discoverUiSurface: DiscoverUiSurface;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class AccessibilitySmokeRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: AccessibilitySmokeRuntimeExecutorDependencies;

  constructor(dependencies: AccessibilitySmokeRuntimeExecutorDependencies) {
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
      sourceUrl = readOptionalString(input.start_request.input["source_url"]);
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
          "assess_ui_accessibility_smoke requires url or a non-empty ui_map_elements array from a prior discovery.",
        ),
      };
    }

    const report = assessUiAccessibilitySmoke({
      elements,
      ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
    });

    return {
      ok: true,
      value: {
        output: {
          schema_version: report.schema_version,
          source_url: report.source_url ?? null,
          element_count: report.element_count,
          summary: { ...report.summary },
          findings: report.findings.map((finding) => ({
            id: finding.id,
            category: finding.category,
            severity: finding.severity,
            message: finding.message,
            evidence: [...finding.evidence],
            element_ids: [...finding.element_ids],
          })),
          limitations: [...report.limitations],
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          discovery_engine: "playwright-dom-pipeline@0.1.0",
        },
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: priorElements !== undefined ? [] : ["playwright-dom-pipeline@0.1.0"],
        citations: unique([...evidence, ...report.findings.flatMap((f) => f.evidence)]),
        uncertainty: {
          level: report.findings.some((f) => f.severity === "critical") ? "medium" : "low",
          reasons: report.limitations.slice(0, 2),
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
  dependencies: AccessibilitySmokeRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Accessibility Smoke executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Assess UI Accessibility Smoke is not present in retained Skill authority.");
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
      ...(typeof obj["parent_id"] === "string" ? { parent_id: obj["parent_id"] } : {}),
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
