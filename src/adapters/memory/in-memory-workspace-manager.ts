import type {
  AddWorkspaceMembershipRequest,
  BindWorkspacePolicyRequest,
  ProvisionWorkspaceRequest,
  RemoveWorkspaceMembershipRequest,
  TransitionWorkspaceLifecycleRequest,
  UpdateWorkspaceMembershipRequest,
  WorkspaceAggregate,
  WorkspaceAuditRecord,
  WorkspaceLifecycleStatus,
  WorkspaceManager,
  WorkspaceManagerFailureCode,
  WorkspaceManagerResult,
  WorkspaceMembership,
} from "../../workspace-manager/public.js";

export interface Clock {
  now(): Date;
}

type StoredWorkspace = Readonly<{ workspace: WorkspaceAggregate; revision: number }>;

/** SPEC-306 §4: `provisioning → active → suspended → retiring → archived`; `active ⇄ suspended` both ways ("reversible where policy permits"). */
const ALLOWED_TRANSITIONS: Readonly<Record<WorkspaceLifecycleStatus, readonly WorkspaceLifecycleStatus[]>> = {
  provisioning: ["active", "archived"],
  active: ["suspended", "retiring"],
  suspended: ["active", "retiring"],
  retiring: ["archived"],
  archived: [],
};

/**
 * SPEC-406's required reference adapter: an in-process, deterministic
 * `WorkspaceManager` proving the SPEC-306 §4 lifecycle, revision-checked
 * membership/policy writes, and audited administrative operations — the
 * same "deterministic reference adapter" pattern `InMemoryKnowledgeRepository`
 * / `InMemoryRuleRepository` / `InMemoryCandidateRepository` established.
 * This adapter has no authorizer of its own (role escalation / confused-
 * deputy defense is the caller's job, same as every other write-path
 * aggregate in this repo takes an already-authorized `actor_id` rather than
 * re-deriving authority) and does not wire into
 * `DeterministicWorkspaceAuthorizer`/`WorkspaceContextIssuer` — composing
 * this aggregate's state into those read-side adapters is a separate,
 * later integration.
 */
export class InMemoryWorkspaceManager implements WorkspaceManager {
  readonly #clock: Clock;
  readonly #workspaces = new Map<string, StoredWorkspace>();
  readonly #memberships = new Map<string, Map<string, WorkspaceMembership>>();
  readonly #audit: WorkspaceAuditRecord[] = [];
  readonly #idempotency = new Map<string, WorkspaceAggregate>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async provision(request: ProvisionWorkspaceRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>> {
    const existingByKey = this.#idempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    if (this.#workspaces.has(request.id)) {
      return failure("conflict", `Workspace "${request.id}" already exists.`, false);
    }

    const workspace: WorkspaceAggregate = {
      id: request.id,
      status: "provisioning",
      owner: request.owner,
      environment: request.environment,
      created_at: this.#clock.now().toISOString(),
      policy_ref: null,
    };
    this.#workspaces.set(request.id, { workspace, revision: 1 });
    this.#memberships.set(request.id, new Map());
    this.#idempotency.set(request.idempotency_key, workspace);
    this.#recordAudit(request.id, 1, null, "provisioning", request.actor_id, request.reason, null);
    return { ok: true, value: workspace };
  }

  async transitionLifecycle(request: TransitionWorkspaceLifecycleRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>> {
    const found = this.#requireWorkspace(request.id);
    if (!found.ok) return found;
    const { workspace, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    if (!ALLOWED_TRANSITIONS[workspace.status].includes(request.to_status)) {
      return failure(
        "unsupported_transition",
        `Cannot transition Workspace "${request.id}" from "${workspace.status}" to "${request.to_status}".`,
        false,
      );
    }

    const transitioned: WorkspaceAggregate = { ...workspace, status: request.to_status };
    this.#workspaces.set(request.id, { workspace: transitioned, revision: revision + 1 });
    this.#recordAudit(request.id, revision + 1, workspace.status, request.to_status, request.actor_id, request.reason, workspace.policy_ref === null ? null : `${workspace.policy_ref.id}@${workspace.policy_ref.version}`);
    return { ok: true, value: transitioned };
  }

  async addMembership(request: AddWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<WorkspaceMembership>> {
    const found = this.#requireWorkspace(request.workspace_id);
    if (!found.ok) return found;
    const { workspace, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;
    if (workspace.status === "suspended" || workspace.status === "archived") {
      return failure("suspended_workspace", `Workspace "${request.workspace_id}" cannot accept new membership in status "${workspace.status}".`, false);
    }

    const members = this.#memberships.get(request.workspace_id) ?? new Map();
    if (members.has(request.actor_id)) {
      return failure("conflict", `Actor "${request.actor_id}" is already a member of Workspace "${request.workspace_id}".`, false);
    }

    const membership: WorkspaceMembership = {
      actor_id: request.actor_id,
      roles: request.roles,
      granted_at: this.#clock.now().toISOString(),
      granted_by: request.granted_by,
    };
    members.set(request.actor_id, membership);
    this.#memberships.set(request.workspace_id, members);
    this.#workspaces.set(request.workspace_id, { workspace, revision: revision + 1 });
    this.#recordAudit(request.workspace_id, revision + 1, workspace.status, workspace.status, request.granted_by, request.reason, null);
    return { ok: true, value: membership };
  }

  async updateMembership(request: UpdateWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<WorkspaceMembership>> {
    const found = this.#requireWorkspace(request.workspace_id);
    if (!found.ok) return found;
    const { workspace, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;

    const members = this.#memberships.get(request.workspace_id) ?? new Map();
    const existing = members.get(request.actor_id);
    if (existing === undefined) {
      return failure("not_found", `Actor "${request.actor_id}" is not a member of Workspace "${request.workspace_id}".`, false);
    }

    const membership: WorkspaceMembership = { ...existing, roles: request.roles, granted_by: request.granted_by };
    members.set(request.actor_id, membership);
    this.#memberships.set(request.workspace_id, members);
    this.#workspaces.set(request.workspace_id, { workspace, revision: revision + 1 });
    this.#recordAudit(request.workspace_id, revision + 1, workspace.status, workspace.status, request.granted_by, request.reason, null);
    return { ok: true, value: membership };
  }

  async removeMembership(request: RemoveWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<true>> {
    const found = this.#requireWorkspace(request.workspace_id);
    if (!found.ok) return found;
    const { workspace, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;

    const members = this.#memberships.get(request.workspace_id) ?? new Map();
    if (!members.delete(request.actor_id)) {
      return failure("not_found", `Actor "${request.actor_id}" is not a member of Workspace "${request.workspace_id}".`, false);
    }
    this.#memberships.set(request.workspace_id, members);
    this.#workspaces.set(request.workspace_id, { workspace, revision: revision + 1 });
    this.#recordAudit(request.workspace_id, revision + 1, workspace.status, workspace.status, request.removed_by, request.reason, null);
    return { ok: true, value: true };
  }

  async bindPolicy(request: BindWorkspacePolicyRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>> {
    const found = this.#requireWorkspace(request.workspace_id);
    if (!found.ok) return found;
    const { workspace, revision } = found.value;

    const concurrency = this.#checkRevision(revision, request.expected_revision);
    if (!concurrency.ok) return concurrency;

    const bound: WorkspaceAggregate = { ...workspace, policy_ref: request.policy_ref };
    this.#workspaces.set(request.workspace_id, { workspace: bound, revision: revision + 1 });
    this.#recordAudit(request.workspace_id, revision + 1, workspace.status, workspace.status, request.actor_id, request.reason, `${request.policy_ref.id}@${request.policy_ref.version}`);
    return { ok: true, value: bound };
  }

  async getWorkspace(id: string): Promise<WorkspaceManagerResult<WorkspaceAggregate>> {
    const found = this.#requireWorkspace(id);
    if (!found.ok) return found;
    return { ok: true, value: found.value.workspace };
  }

  async listMembership(workspaceId: string): Promise<WorkspaceManagerResult<readonly WorkspaceMembership[]>> {
    const found = this.#requireWorkspace(workspaceId);
    if (!found.ok) return found;
    const members = this.#memberships.get(workspaceId) ?? new Map();
    return { ok: true, value: [...members.values()] };
  }

  async getAuditHistory(workspaceId: string): Promise<WorkspaceManagerResult<readonly WorkspaceAuditRecord[]>> {
    return { ok: true, value: this.#audit.filter((record) => record.workspace_id === workspaceId) };
  }

  #requireWorkspace(id: string): WorkspaceManagerResult<StoredWorkspace> {
    const found = this.#workspaces.get(id);
    if (found === undefined) return failure("unknown_workspace", `Workspace "${id}" not found.`, false);
    return { ok: true, value: found };
  }

  #checkRevision(actual: number, expected: number): WorkspaceManagerResult<true> {
    if (actual !== expected) {
      return failure("conflict", `Expected revision ${expected} but found ${actual}.`, false);
    }
    return { ok: true, value: true };
  }

  #recordAudit(
    workspaceId: string,
    revision: number,
    fromStatus: string | null,
    toStatus: string,
    actorId: string,
    reason: string,
    policyVersion: string | null,
  ): void {
    this.#audit.push({
      event_id: `event-${this.#audit.length + 1}`,
      workspace_id: workspaceId,
      revision,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: actorId,
      reason,
      policy_version: policyVersion,
      occurred_at: this.#clock.now().toISOString(),
    });
  }
}

function failure<Value>(code: WorkspaceManagerFailureCode, message: string, retryable: boolean): WorkspaceManagerResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
