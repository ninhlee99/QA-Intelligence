import { buildPlatformEvent } from "../events/public.js";
import type { InMemoryOperationStore } from "../adapters/memory/in-memory-operation-store.js";
import type {
  DeterministicRuleEngine,
  JsonObject,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";
import type {
  DispatchCapability,
  OrchestrateOperationOutput,
  OrchestrateOperationRequest,
  RuntimeOrchestrationFailure,
} from "./public.js";

export interface Clock {
  now(): Date;
}

export type OrchestrationDependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  operationStore: InMemoryOperationStore;
  capabilities: ReadonlyMap<string, DispatchCapability>;
  rules: DeterministicRuleEngine;
  clock: Clock;
  producer: Readonly<{ id: string; version: string }>;
}>;

/**
 * SPEC-601 §3's 8-step request flow, implemented as a free-function
 * pipeline (mirrors `reason()`'s SPEC-308 composition style): authenticate/
 * authorize → validate Workspace/input → create durable operation →
 * resolve capability → dispatch idempotent work → consume correlated
 * events → evaluate transition rules → finalize outcome/evidence. Each
 * step short-circuits on failure; every composed contract's own decision
 * (authorization, rule outcome, dispatch result) is surfaced, never
 * overridden (§2: "policy and domain decisions remain outside
 * orchestration code").
 */
export async function orchestrateOperation(
  dependencies: OrchestrationDependencies,
  request: OrchestrateOperationRequest,
): Promise<OrchestrateOperationOutput> {
  const operationId = `${request.idempotency_key}:${request.capability_ref.id}`;

  // Step 1: Authenticate and Authorize.
  const authorization = await dependencies.authorizer.authorize({
    operation_id: operationId,
    context: request.context,
    purpose: `runtime-orchestration:${request.capability_ref.id}`,
    consequence_class: "reversible",
    required_permissions: ["orchestration:dispatch"],
    resource_refs: [`workspace:${request.workspace_id}`],
  });
  if (!authorization.ok) {
    return orchestrationFailure("workspace_denied", authorization.failure.message, authorization.failure.retryable, [
      ...authorization.failure.evidence,
    ]);
  }

  // Step 2: Validate Workspace and Input.
  if (request.workspace_id !== request.context.workspace_id) {
    return orchestrationFailure(
      "workspace_denied",
      "The requested Workspace does not match the trusted Workspace context.",
      false,
      [`context-workspace:${request.context.workspace_id}`, `requested-workspace:${request.workspace_id}`],
    );
  }
  if (Object.keys(request.input).length === 0) {
    return orchestrationFailure("invalid_input", "Operation input must not be empty.", false, []);
  }

  // Step 3: Create Durable Operation (idempotent — a repeat call with the
  // same idempotency_key returns the existing record, never a duplicate).
  const created = dependencies.operationStore.create({
    operation_id: operationId,
    workspace_id: request.workspace_id,
    correlation_id: request.context.correlation_id,
    owner: request.owner,
    deadline: request.deadline,
    dispatch_idempotency_key: request.idempotency_key,
    idempotency_key: request.idempotency_key,
  });
  if (created.state !== "created") {
    // A cached, already-finalized operation from a prior call — return it
    // as-is rather than re-running the pipeline (duplicate delivery, §4).
    return { ok: true, value: created };
  }

  // Step 4: Resolve Workflow and Capabilities.
  const capability = dependencies.capabilities.get(`${request.capability_ref.id}@${request.capability_ref.version}`);
  if (capability === undefined) {
    return orchestrationFailure(
      "unknown_capability",
      `No registered capability "${request.capability_ref.id}@${request.capability_ref.version}".`,
      false,
      [],
    );
  }
  const resolved = dependencies.operationStore.advance(operationId, "resolved", { capability_ref: request.capability_ref });
  if (resolved === undefined) {
    return orchestrationFailure("dispatch_failure", "Operation was not in the expected state to resolve a capability.", false, []);
  }

  // Step 5: Dispatch Idempotent Work.
  const dispatched = await capability.dispatch(request.context, request.input);
  if (!dispatched.ok) {
    dependencies.operationStore.advance(operationId, "dispatched", { outcome: "failed" });
    return orchestrationFailure("dispatch_failure", "The dispatched capability reported a failure.", true, [
      `capability-failure:${JSON.stringify(dispatched.failure)}`,
    ]);
  }
  dependencies.operationStore.advance(operationId, "dispatched");

  // Step 6: Consume Correlated Events — construct a PlatformEvent from the
  // dispatch outcome via SPEC-505's own construction/validation function,
  // never a second event-shape definition.
  const eventBuilt = buildPlatformEvent({
    event_id: `event:${operationId}`,
    event_type: `orchestration.${request.capability_ref.id}.dispatched`,
    schema_version: "1.0.0",
    occurred_at: dependencies.clock.now().toISOString(),
    recorded_at: dependencies.clock.now().toISOString(),
    producer_id: dependencies.producer.id,
    producer_version: dependencies.producer.version,
    workspace_id: request.workspace_id,
    actor_id: request.context.actor_id,
    correlation_id: request.context.correlation_id,
    aggregate_id: operationId,
    aggregate_sequence: 1,
    payload: dispatched.value,
    classification: "internal",
  });
  if (!eventBuilt.ok) {
    dependencies.operationStore.advance(operationId, "events_consumed", { outcome: "failed" });
    return orchestrationFailure(
      "dispatch_failure",
      `Dispatch outcome could not be recorded as a correlated event: ${eventBuilt.failures.map((failure) => failure.message).join("; ")}`,
      false,
      [],
    );
  }
  dependencies.operationStore.advance(operationId, "events_consumed", { evidence: [`event:${eventBuilt.value.event_id}`] });

  // Step 7: Evaluate Transition Rules — this orchestrator asks the rule
  // engine, it never decides the transition itself (§2).
  const ruleEvaluation = await dependencies.rules.evaluate({
    evaluation_id: `${operationId}:transition`,
    context: request.context,
    rule_set: request.transition_rule_set,
    effective_at: dependencies.clock.now().toISOString(),
    facts: { dispatch_outcome: dispatched.value } as JsonObject,
    fact_provenance: [`operation:${operationId}`],
    requested_decisions: ["transition"],
    trace_level: "summary",
  });
  if (!ruleEvaluation.ok) {
    dependencies.operationStore.advance(operationId, "transitioned", { outcome: "failed" });
    return orchestrationFailure("transition_denied", ruleEvaluation.failure.message, ruleEvaluation.failure.retryable, [
      ...ruleEvaluation.failure.evidence,
    ]);
  }
  if (ruleEvaluation.value.outcome !== "satisfied") {
    dependencies.operationStore.advance(operationId, "transitioned", { outcome: "failed" });
    return orchestrationFailure(
      "transition_denied",
      `Transition rules did not permit this operation to proceed (outcome: ${ruleEvaluation.value.outcome}).`,
      false,
      [...ruleEvaluation.value.explanation_trace],
    );
  }
  dependencies.operationStore.advance(operationId, "transitioned");

  // Step 8: Finalize Outcome and Evidence.
  const finalized = dependencies.operationStore.advance(operationId, "finalized", { outcome: "completed" });
  if (finalized === undefined) {
    return orchestrationFailure("dispatch_failure", "Operation was not in the expected state to finalize.", false, []);
  }
  return { ok: true, value: finalized };
}

function orchestrationFailure(
  code: RuntimeOrchestrationFailure["code"],
  message: string,
  retryable: boolean,
  evidence: readonly string[],
): OrchestrateOperationOutput {
  return { ok: false, failure: { code, message, retryable, evidence } };
}
