/**
 * MCP adapter for multi-page UI workflow discovery.
 */
import type { DiscoverUiWorkflow } from "./discover-ui-workflow.js";
import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { SessionMemory } from "../memory/session-memory.js";

const NETWORK_HINTS_KEY_PREFIX = "network-hints:";

export type UiWorkflowDiscoveryRuntimeExecutorDependencies = Readonly<{
  skill: DiscoverUiWorkflow;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  /** Optional — when present, network hints are persisted and prior hints surfaced cross-run. */
  sessionMemory?: SessionMemory;
}>;

export class UiWorkflowDiscoveryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: UiWorkflowDiscoveryRuntimeExecutorDependencies;

  constructor(dependencies: UiWorkflowDiscoveryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const url = input.start_request.input["url"];
    if (typeof url !== "string" || url.trim().length === 0) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", "discover_ui_workflow requires url."),
      };
    }

    let maxPages: number | undefined;
    const maxRaw = input.start_request.input["max_pages"];
    if (typeof maxRaw === "number" && Number.isFinite(maxRaw)) maxPages = maxRaw;

    let browser: BrowserName | undefined;
    const browserRaw = input.start_request.input["browser"];
    if (typeof browserRaw === "string" && browserRaw.trim().length > 0) {
      const name = browserRaw.trim().toLowerCase();
      if (!isBrowserName(name)) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", `browser must be chromium|firefox|webkit (got "${browserRaw}").`),
        };
      }
      browser = name;
    }

    const discovered = await this.#dependencies.skill.discover({
      operation_id: input.execution.operation_id,
      context: input.execution.workspace_context,
      url: url.trim(),
      ...(maxPages !== undefined ? { max_pages: maxPages } : {}),
      ...(browser !== undefined ? { browser } : {}),
    });
    if (!discovered.ok) {
      return {
        ok: false,
        failure: failure(
          discovered.failure.class === "authorization" ? "policy" : "skill",
          discovered.failure.class === "authorization" ? "authorization_denied" : "skill_failure",
          discovered.failure.message,
          discovered.failure.retryable,
          [...discovered.failure.evidence],
        ),
      };
    }

    const value = discovered.value;

    // Persist network hints cross-run; surface prior hints for AC authoring
    const workspaceId = input.execution.workspace_context.workspace_id;
    const memKey = `${NETWORK_HINTS_KEY_PREFIX}${workspaceId}:${url.trim()}`;
    let priorNetworkHints: JsonObject[] = [];
    if (this.#dependencies.sessionMemory) {
      const prior = this.#dependencies.sessionMemory.get(workspaceId, memKey);
      if (prior !== undefined) {
        try {
          const parsed = JSON.parse(prior.value) as unknown;
          if (Array.isArray(parsed)) priorNetworkHints = parsed as JsonObject[];
        } catch {
          // ignore corrupt entry
        }
      }
      const allHints = value.pages.flatMap((page) => page.network_hints ?? []);
      if (allHints.length > 0) {
        this.#dependencies.sessionMemory.evaluate({
          workspace_id: workspaceId,
          key: memKey,
          value: JSON.stringify(allHints),
          source_ref: `discover-ui-workflow:${url.trim()}`,
          consequence_class: "advisory",
          reuse_likely: true,
          ttl_seconds: 7 * 24 * 60 * 60, // 7 days
        });
      }
    }

    const output: JsonObject = {
      schema_version: value.schema_version,
      workspace_id: value.workspace_id,
      start_url: value.start_url,
      pages: value.pages.map((page) => ({ ...page })),
      edges: value.edges.map((edge) => ({ ...edge })),
      limitations: [...value.limitations],
      start_page_map: {
        schema_version: value.start_page_map.schema_version,
        workspace_id: value.start_page_map.workspace_id,
        source_url: value.start_page_map.source_url,
        capture_id: value.start_page_map.capture_id,
        captured_at: value.start_page_map.captured_at,
        elements: value.start_page_map.elements.map((el) => ({ ...el })),
        limitations: [...value.start_page_map.limitations],
      },
      ...(priorNetworkHints.length > 0
        ? {
            prior_network_hints: priorNetworkHints,
            prior_network_hints_note:
              "Observed from a previous discover_ui_workflow run on the same URL. Candidates only — confirm before binding to expected_network. Never invent routes.",
          }
        : {}),
    };

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
        tool_usage: ["playwright-dom-pipeline@0.1.0"],
        citations: unique([
          `source-url:${value.start_url}`,
          ...value.pages.map((page) => `capture:${page.capture_id}`),
        ]),
        uncertainty: {
          level: "low",
          reasons: ["Same-origin link crawl only — not full Region/State/Permission discovery."],
        },
        policy_events: [],
        usage: { steps: value.pages.length, duration_seconds: 0, tool_calls: value.pages.length, retries: 0 },
        evidence: unique([
          `page-count:${value.pages.length}`,
          `edge-count:${value.edges.length}`,
          ...value.pages.map((page) => `capture:${page.capture_id}`),
        ]),
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: UiWorkflowDiscoveryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the workflow discovery executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Workflow discovery Skill is not present in retained Skill authority.");
  }
  return undefined;
}
