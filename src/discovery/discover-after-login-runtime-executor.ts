import type { JsonObject, VersionReference } from "../requirement-review/public.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";
import { resolveBasicAuthPassword, resolvePasswordInput } from "../credentials/resolve-secret-input.js";
import type { DiscoverAfterLogin } from "./discover-after-login.js";
import type { SemanticUiDiscoveryFailure, SemanticUiMap } from "./public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure, unique } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type DiscoverAfterLoginRuntimeExecutorDependencies = Readonly<{
  skill: DiscoverAfterLogin;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  engine_ref: string;
  /** Phase 6: resolves password_secret_ref / basic_auth_password_secret_ref. */
  credentials?: WorkspaceCredentialRegistry;
}>;

/** Mirrors `UiSurfaceDiscoveryRuntimeExecutor` — see that file for the composition pattern this repeats. */
export class DiscoverAfterLoginRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: DiscoverAfterLoginRuntimeExecutorDependencies;

  constructor(dependencies: DiscoverAfterLoginRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const requiredKeys = ["login_url", "username_field_name", "username", "password_field_name", "submit_action_name", "target_url"] as const;
    const requiredStrings: Record<string, string> = {};
    for (const key of requiredKeys) {
      const value = input.start_request.input[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        return { ok: false, failure: failure("orchestration", "invalid_request", `Discovery-after-login requires an exact "${key}" input.`) };
      }
      requiredStrings[key] = value;
    }

    const passwordResolved = resolvePasswordInput({
      registry: this.#dependencies.credentials,
      workspaceId: input.reference.workspace_id,
      ...(readOptional(input.start_request.input["password"]) !== undefined
        ? { password: readOptional(input.start_request.input["password"])! }
        : {}),
      ...(readOptional(input.start_request.input["password_secret_ref"]) !== undefined
        ? { password_secret_ref: readOptional(input.start_request.input["password_secret_ref"])! }
        : {}),
    });
    if (!passwordResolved.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", passwordResolved.message) };
    }

    const basicAuthPassword = resolveBasicAuthPassword({
      registry: this.#dependencies.credentials,
      workspaceId: input.reference.workspace_id,
      ...(readOptional(input.start_request.input["basic_auth_username"]) !== undefined
        ? { username: readOptional(input.start_request.input["basic_auth_username"])! }
        : {}),
      ...(readOptional(input.start_request.input["basic_auth_password"]) !== undefined
        ? { password: readOptional(input.start_request.input["basic_auth_password"])! }
        : {}),
      ...(readOptional(input.start_request.input["basic_auth_password_secret_ref"]) !== undefined
        ? { password_secret_ref: readOptional(input.start_request.input["basic_auth_password_secret_ref"])! }
        : {}),
    });
    if (!basicAuthPassword.ok) {
      return { ok: false, failure: failure("orchestration", "invalid_request", basicAuthPassword.message) };
    }
    const basicAuthUsername = readOptional(input.start_request.input["basic_auth_username"]);

    const discovered = await this.#dependencies.skill.discover({
      operation_id: input.execution.operation_id,
      context: input.execution.workspace_context,
      login_url: requiredStrings["login_url"]!,
      username_field_name: requiredStrings["username_field_name"]!,
      username: requiredStrings["username"]!,
      password_field_name: requiredStrings["password_field_name"]!,
      password: passwordResolved.value,
      submit_action_name: requiredStrings["submit_action_name"]!,
      target_url: requiredStrings["target_url"]!,
      ...(basicAuthUsername !== undefined && basicAuthPassword.value !== undefined
        ? { basic_auth_username: basicAuthUsername, basic_auth_password: basicAuthPassword.value }
        : {}),
    });
    if (!discovered.ok) return { ok: false, failure: mapSkillFailure(discovered.failure) };

    const map = discovered.value;
    const evidence = unique([`capture:${map.capture_id}`, `semantic-ui-map:${map.capture_id}`]);
    if (passwordResolved.via === "secret_ref" && passwordResolved.secret_ref !== undefined) {
      evidence.push(`password-via:${passwordResolved.secret_ref}`);
    }

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
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [this.#dependencies.engine_ref],
        citations: unique([...evidence, `source-url:${map.source_url}`]),
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 2, duration_seconds: 0, tool_calls: 1, retries: 0 },
        evidence,
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function readOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: DiscoverAfterLoginRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  const expectedAgent = dependencies.expected_agent;
  if (
    input.start_request.agent.id !== expectedAgent.id ||
    input.start_request.agent.version !== expectedAgent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the Discover After Login executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Discover After Login is not present in retained Skill authority.");
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
  };
}
