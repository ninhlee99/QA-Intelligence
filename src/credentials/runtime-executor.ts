/**
 * MCP adapters for Workspace credential registry (Phase 6). Register
 * accepts the value once; list returns metadata only. Resolve is never
 * exposed as an MCP tool — only Skills/engines call it out-of-band.
 */
import type { WorkspaceCredentialRegistry, CredentialKind } from "./workspace-credential-registry.js";
import type { JsonValue, VersionReference, WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunExecutor,
  AgentRunExecutorInput,
  AgentRunExecutorResult,
} from "../runtime/executor.js";
import { failure } from "../runtime/executor-support.js";
import type { AgentRunFailure } from "../runtime/public.js";

export type CredentialRegistryRuntimeExecutorDependencies = Readonly<{
  registry: WorkspaceCredentialRegistry;
  expected_agent: VersionReference;
  expected_skill: VersionReference;
  mode: "register" | "list";
  authorizer?: WorkspaceAuthorizer;
}>;

export class CredentialRegistryRuntimeExecutor implements AgentRunExecutor {
  readonly #dependencies: CredentialRegistryRuntimeExecutorDependencies;

  constructor(dependencies: CredentialRegistryRuntimeExecutorDependencies) {
    this.#dependencies = dependencies;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const configurationFailure = validateConfiguration(input, this.#dependencies);
    if (configurationFailure) return { ok: false, failure: configurationFailure };

    const workspaceId = input.reference.workspace_id;
    if (this.#dependencies.authorizer !== undefined) {
      const permission = this.#dependencies.mode === "register" ? "credential:register" : "credential:read";
      const authorization = await this.#dependencies.authorizer.authorize({
        operation_id: input.execution.operation_id,
        context: input.execution.workspace_context,
        purpose: this.#dependencies.mode === "register" ? "register workspace secret" : "list workspace secrets",
        consequence_class: this.#dependencies.mode === "register" ? "reversible" : "advisory",
        required_permissions: [permission],
        resource_refs: [`workspace:${workspaceId}`],
      });
      if (!authorization.ok) {
        return {
          ok: false,
          failure: failure(
            "policy",
            "authorization_denied",
            authorization.failure.message,
            authorization.failure.retryable,
            [...authorization.failure.evidence],
          ),
        };
      }
    }

    if (this.#dependencies.mode === "list") {
      const records = this.#dependencies.registry.list(workspaceId);
      return {
        ok: true,
        value: {
          output: {
            workspace_id: workspaceId,
            secrets: records.map((record) => ({
              secret_ref: record.secret_ref,
              kind: record.kind,
              label: record.label,
              registered_at: record.registered_at,
            })),
          },
          output_validated: true,
          satisfied_evidence_requirements: [],
          resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
          rule_results: [],
          skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
          tool_usage: [],
          citations: [`workspace:${workspaceId}`],
          uncertainty: { level: "none", reasons: [] },
          policy_events: [],
          usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
          evidence: [`workspace:${workspaceId}`, `secret-count:${records.length}`],
          cleanup_status: "not_required",
          knowledge_candidates: [],
        },
      };
    }

    const secretRef = readString(input.start_request.input["secret_ref"]);
    const value = readString(input.start_request.input["value"]);
    if (secretRef === undefined || value === undefined) {
      return {
        ok: false,
        failure: failure(
          "orchestration",
          "invalid_request",
          "register_workspace_secret requires secret_ref (workspace-secret:…) and value.",
        ),
      };
    }
    const kind = readKind(input.start_request.input["kind"]);
    const label = readString(input.start_request.input["label"]);
    const registered = this.#dependencies.registry.register({
      workspace_id: workspaceId,
      secret_ref: secretRef,
      value,
      ...(kind !== undefined ? { kind } : {}),
      ...(label !== undefined ? { label } : {}),
    });
    if (!registered.ok) {
      return {
        ok: false,
        failure: failure("orchestration", "invalid_request", registered.message),
      };
    }

    return {
      ok: true,
      value: {
        output: {
          secret_ref: registered.record.secret_ref,
          kind: registered.record.kind,
          label: registered.record.label,
          registered_at: registered.record.registered_at,
          ...(registered.persisted_path !== undefined ? { persisted_path: registered.persisted_path } : {}),
          note: "Values never returned by list/read tools. File-backed registries persist under .qa-credentials/ (local disk — not Vault).",
        },
        output_validated: true,
        satisfied_evidence_requirements: [],
        resolved_versions: versions(this.#dependencies, input.start_request.policy_version),
        rule_results: [],
        skill_usage: [`${this.#dependencies.expected_skill.id}@${this.#dependencies.expected_skill.version}`],
        tool_usage: [],
        citations: [`workspace:${workspaceId}`, registered.record.secret_ref],
        uncertainty: { level: "none", reasons: [] },
        policy_events: [],
        usage: { steps: 1, duration_seconds: 0, tool_calls: 0, retries: 0 },
        evidence: [`workspace:${workspaceId}`, `secret-ref:${registered.record.secret_ref}`],
        cleanup_status: "not_required",
        knowledge_candidates: [],
      },
    };
  }
}

function validateConfiguration(
  input: AgentRunExecutorInput,
  dependencies: CredentialRegistryRuntimeExecutorDependencies,
): AgentRunFailure | undefined {
  if (
    input.start_request.agent.id !== dependencies.expected_agent.id ||
    input.start_request.agent.version !== dependencies.expected_agent.version
  ) {
    return failure("orchestration", "incompatible_version", "Retained Agent version is not supported by the credential registry executor.");
  }
  const allowed = input.start_request.allowed_skills ?? [];
  if (!allowed.some((skill) => skill.id === dependencies.expected_skill.id && skill.version === dependencies.expected_skill.version)) {
    return failure("policy", "authorization_denied", "Credential registry Skill is not present in retained Skill authority.");
  }
  return undefined;
}

function versions(
  dependencies: CredentialRegistryRuntimeExecutorDependencies,
  policyVersion: string,
): Readonly<Record<string, string>> {
  return {
    agent: `${dependencies.expected_agent.id}@${dependencies.expected_agent.version}`,
    policy: policyVersion,
    skill: `${dependencies.expected_skill.id}@${dependencies.expected_skill.version}`,
  };
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readKind(value: JsonValue | undefined): CredentialKind | undefined {
  if (typeof value !== "string") return undefined;
  const kind = value.trim();
  if (kind === "password" || kind === "api_token" || kind === "basic_auth_password" || kind === "other") {
    return kind;
  }
  return undefined;
}
