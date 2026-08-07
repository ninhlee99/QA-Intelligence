import type { VersionReference } from "../requirement-review/public.js";

/**
 * SPEC-306 (Workspace Manager Architecture) / SPEC-406 (Workspace Manager
 * Component): "establishes and enforces the isolation, identity,
 * configuration, policy, membership, and lifecycle boundary for every
 * Workspace" (SPEC-306 §1). `src/adapters/deterministic/workspace-authorizer.ts`
 * (`DeterministicWorkspaceAuthorizer`) and
 * `src/adapters/oidc/workspace-context-issuer.ts` already implement the
 * *read* half of SPEC-506's context contract — validate an already-issued
 * context, issue a context from an already-obtained identity token. This
 * module is the **write-path aggregate** neither of those cover: the
 * Workspace's own lifecycle, membership, and policy-binding state (SPEC-406
 * §3), none of which existed anywhere in this repository before.
 */
export type WorkspaceLifecycleStatus = "provisioning" | "active" | "suspended" | "retiring" | "archived";

/** SPEC-406 §4: "every Workspace has one stable non-reused ID." */
export type WorkspaceAggregate = Readonly<{
  id: string;
  status: WorkspaceLifecycleStatus;
  owner: string;
  environment: string;
  created_at: string;
  policy_ref: VersionReference | null;
}>;

export type WorkspaceMembership = Readonly<{
  actor_id: string;
  roles: readonly string[];
  granted_at: string;
  granted_by: string;
}>;

/** Mirrors `KnowledgeLifecycleEvent`/`RuleLifecycleEvent` — administrative operations are audited the same way every other lifecycle-bearing aggregate in this repo already is (SPEC-406 §4: "administrative paths are separate and audited"). */
export type WorkspaceAuditRecord = Readonly<{
  event_id: string;
  workspace_id: string;
  revision: number;
  from_status: string | null;
  to_status: string;
  actor_id: string;
  reason: string;
  policy_version: string | null;
  occurred_at: string;
}>;

export type WorkspaceManagerFailureCode =
  | "unknown_workspace"
  | "suspended_workspace"
  | "unauthorized_actor"
  | "stale_policy"
  | "expired_context"
  | "dependency_failure"
  | "conflict"
  | "not_found"
  | "unsupported_transition";

export type WorkspaceManagerFailure = Readonly<{
  code: WorkspaceManagerFailureCode;
  message: string;
  retryable: boolean;
}>;

export type WorkspaceManagerResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: WorkspaceManagerFailure }>;

export type ProvisionWorkspaceRequest = Readonly<{
  id: string;
  owner: string;
  environment: string;
  actor_id: string;
  reason: string;
  idempotency_key: string;
}>;

export type TransitionWorkspaceLifecycleRequest = Readonly<{
  id: string;
  expected_revision: number;
  to_status: WorkspaceLifecycleStatus;
  actor_id: string;
  reason: string;
}>;

export type AddWorkspaceMembershipRequest = Readonly<{
  workspace_id: string;
  expected_revision: number;
  actor_id: string;
  roles: readonly string[];
  granted_by: string;
  reason: string;
}>;

export type UpdateWorkspaceMembershipRequest = Readonly<{
  workspace_id: string;
  expected_revision: number;
  actor_id: string;
  roles: readonly string[];
  granted_by: string;
  reason: string;
}>;

export type RemoveWorkspaceMembershipRequest = Readonly<{
  workspace_id: string;
  expected_revision: number;
  actor_id: string;
  removed_by: string;
  reason: string;
}>;

export type BindWorkspacePolicyRequest = Readonly<{
  workspace_id: string;
  expected_revision: number;
  policy_ref: VersionReference;
  actor_id: string;
  reason: string;
}>;

/** SPEC-406 §3's operations. */
export interface WorkspaceManager {
  provision(request: ProvisionWorkspaceRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>>;
  transitionLifecycle(request: TransitionWorkspaceLifecycleRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>>;
  addMembership(request: AddWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<WorkspaceMembership>>;
  updateMembership(request: UpdateWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<WorkspaceMembership>>;
  removeMembership(request: RemoveWorkspaceMembershipRequest): Promise<WorkspaceManagerResult<true>>;
  bindPolicy(request: BindWorkspacePolicyRequest): Promise<WorkspaceManagerResult<WorkspaceAggregate>>;
  getWorkspace(id: string): Promise<WorkspaceManagerResult<WorkspaceAggregate>>;
  listMembership(workspaceId: string): Promise<WorkspaceManagerResult<readonly WorkspaceMembership[]>>;
  getAuditHistory(workspaceId: string): Promise<WorkspaceManagerResult<readonly WorkspaceAuditRecord[]>>;
}
