/**
 * MCP adapter: generate_journey_test_cases from workflow discovery output.
 */
import { generateJourneyTestCases } from "./generate-journey-test-cases.js";
import type { WorkflowEdge, WorkflowPageCapture } from "../discovery/discover-ui-workflow.js";
import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type GenerateJourneyRuntimeExecutorDependencies = Readonly<{
  expected_agent: VersionReference;
  expected_skill: VersionReference;
}>;

export class GenerateJourneyRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: GenerateJourneyRuntimeExecutorDependencies;

  constructor(dependencies: GenerateJourneyRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const startUrl = readString(input.start_request.input["start_url"]);
    const pages = readPages(input.start_request.input["pages"]);
    const edges = readEdges(input.start_request.input["edges"]);
    if (startUrl === undefined || pages === undefined || edges === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "generate_journey_test_cases requires start_url, pages[], and edges[] from discover_ui_workflow.",
        ),
      };
    }

    const maxRaw = input.start_request.input["max_hops"];
    const maxHops = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? maxRaw : undefined;
    const requirementRef = readString(input.start_request.input["requirement_ref"]);

    const result = generateJourneyTestCases({
      workspace_id: input.reference.workspace_id,
      start_url: startUrl,
      pages,
      edges,
      ...(maxHops !== undefined ? { max_hops: maxHops } : {}),
      ...(requirementRef !== undefined ? { requirement_ref: requirementRef } : {}),
    });

    return {
      ok: true,
      value: {
        output: {
          schema_version: result.schema_version,
          workspace_id: result.workspace_id,
          ...(result.requirement_ref !== undefined ? { requirement_ref: result.requirement_ref } : {}),
          test_cases: result.test_cases.map((tc) => ({ ...tc })),
          generated_assertions: result.generated_assertions.map((a) => ({ ...a })),
          findings: [...result.findings],
          note: "Execute via execute_generated_test_case or register_regression_suite.",
        } as JsonObject,
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
        citations: [
          `start-url:${startUrl}`,
          `journey-count:${result.test_cases.length}`,
          `edge-count:${edges.length}`,
        ],
        uncertainty: {
          level: "low",
          reasons: ["URL oracles only; link accessible names must match live link text."],
        },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`journey-count:${result.test_cases.length}`, ...result.findings.slice(0, 5)],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: GenerateJourneyRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Journey generator Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPages(value: JsonValue | undefined): readonly WorkflowPageCapture[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const pages: WorkflowPageCapture[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    const url = readString(obj["url"]);
    if (url === undefined) return undefined;
    pages.push({
      url,
      title: readString(obj["title"]) ?? "",
      capture_id: readString(obj["capture_id"]) ?? `capture:${url}`,
      element_count: typeof obj["element_count"] === "number" ? obj["element_count"] : 0,
      named_fields: readStringArray(obj["named_fields"]) ?? [],
      named_actions: readStringArray(obj["named_actions"]) ?? [],
      limitations: readStringArray(obj["limitations"]) ?? [],
    });
  }
  return pages;
}

function readEdges(value: JsonValue | undefined): readonly WorkflowEdge[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const edges: WorkflowEdge[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const obj = entry as JsonObject;
    const from_url = readString(obj["from_url"]);
    const to_url = readString(obj["to_url"]);
    const link_text = readString(obj["link_text"]) ?? "";
    if (from_url === undefined || to_url === undefined) return undefined;
    edges.push({ from_url, to_url, link_text });
  }
  return edges;
}

function readStringArray(value: JsonValue | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string").map((s) => s.trim()).filter(Boolean);
}
