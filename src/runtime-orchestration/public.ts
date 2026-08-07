import type { JsonObject, StableResult, VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-601 (Runtime Orchestration): "defines how commands, workflows,
 * plugins, jobs, events, human approvals, and evidence collaborate during
 * live operation" (§1). §3's 8-step request flow is a generic dispatch
 * pipeline composing contracts already built elsewhere in this repository
 * (`WorkspaceAuthorizer`, `DeterministicRuleEngine`, `PlatformEvent`
 * construction) — this module owns sequencing only, per §2's "policy and
 * domain decisions remain outside orchestration code." It never redecides
 * what an authorizer, rule engine, or dispatched capability already
 * decided.
 */
export type OrchestratedOperationState =
  | "authenticated"
  | "validated"
  | "created"
  | "resolved"
  | "dispatched"
  | "events_consumed"
  | "transitioned"
  | "finalized";

export type OrchestratedOperationOutcome = "pending" | "completed" | "failed" | "cancelled";

/** SPEC-601 §2: "every operation has identity, Workspace context, owner, deadline, and outcome." */
export type DurableOperation = Readonly<{
  operation_id: string;
  workspace_id: string;
  correlation_id: string;
  owner: string;
  deadline: string;
  state: OrchestratedOperationState;
  capability_ref: VersionReference | null;
  dispatch_idempotency_key: string;
  outcome: OrchestratedOperationOutcome;
  evidence: readonly string[];
  created_at: string;
  updated_at: string;
}>;

/**
 * A registered dispatch target for §3 step 4 ("Resolve Workflow and
 * Capabilities") / step 5 ("Dispatch Idempotent Work"). Backed by a
 * `WorkflowEngine.signal` call, an `ExecutionManager.dispatchAttempt`
 * call, a `PluginManager.invoke` call, or anything else — this module does
 * not care which, per §1's "without becoming the owner of domain meaning."
 */
export type DispatchCapability = Readonly<{
  capability_ref: VersionReference;
  dispatch: (context: WorkspaceContext, input: JsonObject) => Promise<StableResult<JsonObject, JsonObject>>;
}>;

export type OrchestrateOperationRequest = Readonly<{
  context: WorkspaceContext;
  workspace_id: string;
  owner: string;
  deadline: string;
  capability_ref: VersionReference;
  input: JsonObject;
  transition_rule_set: VersionReference;
  idempotency_key: string;
}>;

export type RuntimeOrchestrationFailureCode =
  | "workspace_denied"
  | "invalid_input"
  | "unknown_capability"
  | "dispatch_failure"
  | "transition_denied"
  | "idempotency_conflict";

export type RuntimeOrchestrationFailure = Readonly<{
  code: RuntimeOrchestrationFailureCode;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
}>;

export type OrchestrateOperationOutput = StableResult<DurableOperation, RuntimeOrchestrationFailure>;
