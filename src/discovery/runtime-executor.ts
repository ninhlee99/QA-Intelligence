import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type { DiscoverUiSurface } from "./discover-ui-surface.js";
import type { SemanticUiDiscoveryFailure, SemanticUiMap } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";
import { isBrowserName, type BrowserName } from "../adapters/playwright/browser-launcher.js";
import type { InMemoryWorkspaceEnvironmentRegistry } from "../environments/workspace-environment-registry.js";

export type UiSurfaceDiscoveryRuntimeExecutorDependencies = Readonly<{
  skill: DiscoverUiSurface;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  engine_ref: string;
  /** SPEC-512 §12 — optional allowlist / environment_ref resolution. */
  environments?: InMemoryWorkspaceEnvironmentRegistry;
}>;

/** Runtime-owned adapter invoking the UI Surface Discovery Skill through retained input. Mirrors `RequirementReviewRuntimeExecutor`/`BrowserTestRuntimeExecutor`. */
export class UiSurfaceDiscoveryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: UiSurfaceDiscoveryRuntimeExecutorDependencies;

  constructor(dependencies: UiSurfaceDiscoveryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const urlRaw = input.start_request.input["url"];
    const environmentRefRaw = input.start_request.input["environment_ref"];
    const urlArg = typeof urlRaw === "string" && urlRaw.trim().length > 0 ? urlRaw.trim() : undefined;
    const environmentRef =
      typeof environmentRefRaw === "string" && environmentRefRaw.trim().length > 0
        ? environmentRefRaw.trim()
        : undefined;

    let url: string;
    if (this.#dependencies.environments !== undefined) {
      const resolved = this.#dependencies.environments.resolveTargetUrl({
        workspace_id: input.reference.workspace_id,
        ...(environmentRef !== undefined ? { environment_ref: environmentRef } : {}),
        ...(urlArg !== undefined ? { url: urlArg } : {}),
      });
      if (!resolved.ok) {
        return {
          ok: false,
          failure: failure("orchestration", "invalid_request", resolved.message),
        };
      }
      url = resolved.url;
    } else if (urlArg !== undefined) {
      url = urlArg;
    } else {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "UI Surface Discovery requires url or environment_ref.",
        ),
      };
    }

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
      url,
      ...(browser !== undefined ? { browser } : {}),
      ...(input.start_request.input["include_screenshot"] === true ? { include_screenshot: true } : {}),
      ...(typeof input.start_request.input["max_elements"] === "number"
        ? { max_elements: input.start_request.input["max_elements"] }
        : {}),
    });
    if (!discovered.ok) return { ok: false, failure: mapSkillFailure(discovered.failure) };

    const map = discovered.value;
    const evidence = unique([
      `capture:${map.capture_id}`,
      `semantic-ui-map:${map.capture_id}`,
      ...(map.screenshot_path !== undefined ? [`screenshot:${map.screenshot_path}`] : []),
    ]);

    return {
      ok: true,
      value: {
        output: semanticUiMapJson(map),
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: {
          agent: `${this.#dependencies.expected_agent.id}@${this.#dependencies.expected_agent.version}`,
          policy: input.start_request.policy_version,
          skill: `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
          engine: this.#dependencies.engine_ref,
        },
        rule_results: [],
        skill_usage: [
          `${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`,
        ],
        tool_usage: [this.#dependencies.engine_ref],
        citations: unique([...evidence, `source-url:${map.source_url}`]),
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 1, retries: 0 },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: UiSurfaceDiscoveryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the UI Surface Discovery executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (
    !allowed.some(
      (skill) =>
        skill.id === dependencies.expected_skill.id &&
        skill.version === dependencies.expected_skill.version,
    )
  ) {
    return failure("policy", "authorization_denied", "Discover UI Surface is not present in retained Skill authority.");
  }
  return undefined;
}

function mapSkillFailure(value: SemanticUiDiscoveryFailure): AgentRunFailure {
  switch (value.class) {
    case "configuration":
      return failure("orchestration", "invalid_definition", value.message, value.retryable, value.evidence);
    case "authorization":
      return failure("policy", "authorization_denied", value.message, value.retryable, value.evidence);
    case "engine":
      return failure("skill", "skill_failure", value.message, value.retryable, value.evidence);
    case "infrastructure":
      return failure("infrastructure", "unavailable", value.message, value.retryable, value.evidence);
  }
}

function semanticUiMapJson(value: SemanticUiMap): JsonObject {
  return {
    schema_version: value.schema_version,
    workspace_id: value.workspace_id,
    source_url: value.source_url,
    capture_id: value.capture_id,
    captured_at: value.captured_at,
    elements: value.elements.map((element) => ({
      id: element.id,
      kind: element.kind,
      accessible_name: element.accessible_name ?? null,
      accessible_role: element.accessible_role ?? null,
      parent_id: element.parent_id ?? null,
      interaction_hint: element.interaction_hint ?? null,
      source_node_id: element.source_node_id,
      confidence: element.confidence,
    })),
    limitations: [...value.limitations],
    ...(value.screenshot_path !== undefined ? { screenshot_path: value.screenshot_path } : {}),
  };
}
