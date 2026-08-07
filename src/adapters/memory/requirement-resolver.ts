import type {
  Requirement,
  WorkspaceAuthorization,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../requirement-review/public.js";
import type {
  RequirementResolutionRequest,
  RequirementResolutionResult,
  RequirementResolver,
} from "../../requirement-review/runtime-executor.js";

export class InMemoryRequirementResolver implements RequirementResolver {
  readonly #workspaceId: string;
  readonly #requirements: ReadonlyMap<string, Requirement>;
  readonly #authorizer: WorkspaceAuthorizer;

  constructor(
    workspaceId: string,
    requirements: readonly Requirement[],
    authorizer: WorkspaceAuthorizer,
  ) {
    this.#workspaceId = workspaceId;
    this.#authorizer = authorizer;
    this.#requirements = new Map(
      requirements.map((requirement) => [
        `${requirement.id}@${requirement.version}`,
        immutableCopy(requirement),
      ]),
    );
  }

  async resolve(
    request: RequirementResolutionRequest,
  ): Promise<RequirementResolutionResult> {
    if (
      invalidContext(request.context, request.workspace_id) ||
      request.workspace_id !== this.#workspaceId
    ) {
      return {
        ok: false,
        failure: {
          class: "policy",
          code: "authorization_denied",
          message: "Requirement resolution is denied outside the retained Workspace.",
          retryable: false,
          evidence: ["requirement-resolution:workspace-denied"],
        },
      };
    }
    const authorizationRequest: WorkspaceAuthorizationRequest = {
      operation_id: request.operation_id,
      context: request.context,
      purpose: "resolve retained Requirement input",
      consequence_class: "advisory",
      required_permissions: ["requirement:read"],
      resource_refs: [
        `workspace:${request.workspace_id}`,
        request.requirement_ref,
      ],
    };
    const authorization = await this.#authorizer.authorize(authorizationRequest);
    if (
      !authorization.ok ||
      !authorizationCovers(authorization.value, authorizationRequest)
    ) {
      return {
        ok: false,
        failure: {
          class: "policy",
          code: "authorization_denied",
          message: "Requirement resolution authorization was denied.",
          retryable: false,
          evidence: [
            `authorization:${authorization.ok ? "incomplete_authorization" : authorization.failure.code}`,
          ],
        },
      };
    }
    const requirement = this.#requirements.get(request.requirement_ref);
    if (!requirement) {
      return {
        ok: false,
        failure: {
          class: "infrastructure",
          code: "not_found",
          message: "The retained requirement reference was not found.",
          retryable: false,
          evidence: [request.requirement_ref],
        },
      };
    }
    if (requirement.scope.workspace_id !== request.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "policy",
          code: "context_contamination",
          message: "Resolved requirement belongs to another Workspace.",
          retryable: false,
          evidence: [request.requirement_ref],
        },
      };
    }
    return { ok: true, value: immutableCopy(requirement) };
  }
}

function invalidContext(
  context: WorkspaceContext,
  workspaceId: string,
): boolean {
  return (
    context.schema_version !== "1.0.0" ||
    context.workspace_id !== workspaceId ||
    context.actor_id.trim().length === 0 ||
    context.policy_version.trim().length === 0
  );
}

function authorizationCovers(
  authorization: WorkspaceAuthorization,
  request: WorkspaceAuthorizationRequest,
): boolean {
  if (authorization.policy_version !== request.context.policy_version) {
    return false;
  }
  const permissions = new Set(authorization.effective_permissions);
  const resources = new Set(authorization.authorized_resource_refs);
  return (
    request.required_permissions.every((permission) =>
      permissions.has(permission),
    ) && request.resource_refs.every((resource) => resources.has(resource))
  );
}

function immutableCopy<Value>(value: Value): Value {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
