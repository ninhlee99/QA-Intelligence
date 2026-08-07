import type { DurableOperation, OrchestratedOperationState } from "../../runtime-orchestration/public.js";

export interface Clock {
  now(): Date;
}

/** SPEC-601 §3's 8 stages, in dispatch order — `unknown state fails safe` (§2) enforced by requiring the immediately-prior stage before advancing. */
const NEXT_STATE: Readonly<Record<OrchestratedOperationState, OrchestratedOperationState | null>> = {
  authenticated: "validated",
  validated: "created",
  created: "resolved",
  resolved: "dispatched",
  dispatched: "events_consumed",
  events_consumed: "transitioned",
  transitioned: "finalized",
  finalized: null,
};

/**
 * SPEC-601's minimal durable-operation store: an in-process, deterministic
 * reference proving idempotent creation (§4: "duplicate delivery is
 * expected; consumers SHALL be idempotent") and safe, ordered state
 * advancement — the same "deterministic reference adapter" pattern every
 * other in-memory store this session built. Durable SQLite/PostgreSQL
 * backing is separate, larger scope, not attempted here.
 */
export class InMemoryOperationStore {
  readonly #clock: Clock;
  readonly #operations = new Map<string, DurableOperation>();
  readonly #idempotency = new Map<string, string>();

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  create(
    input: Readonly<{
      operation_id: string;
      workspace_id: string;
      correlation_id: string;
      owner: string;
      deadline: string;
      dispatch_idempotency_key: string;
      idempotency_key: string;
    }>,
  ): DurableOperation {
    // Store the operation_id, not a snapshot — `advance()` replaces the
    // stored record on every transition, so a stale cached reference here
    // would forever report the pre-advance ("created") state on repeat
    // calls, defeating the idempotent-return check callers rely on.
    const existingOperationId = this.#idempotency.get(input.idempotency_key);
    if (existingOperationId !== undefined) {
      const existing = this.#operations.get(existingOperationId);
      if (existing !== undefined) return existing;
    }

    const now = this.#clock.now().toISOString();
    const operation: DurableOperation = {
      operation_id: input.operation_id,
      workspace_id: input.workspace_id,
      correlation_id: input.correlation_id,
      owner: input.owner,
      deadline: input.deadline,
      state: "created",
      capability_ref: null,
      dispatch_idempotency_key: input.dispatch_idempotency_key,
      outcome: "pending",
      evidence: [],
      created_at: now,
      updated_at: now,
    };
    this.#operations.set(input.operation_id, operation);
    this.#idempotency.set(input.idempotency_key, input.operation_id);
    return operation;
  }

  /** `undefined` if the requested transition isn't the immediate next stage — "unknown state fails safe" (SPEC-601 §2). */
  advance(
    operationId: string,
    toState: OrchestratedOperationState,
    updates: Partial<Pick<DurableOperation, "capability_ref" | "outcome" | "evidence">> = {},
  ): DurableOperation | undefined {
    const current = this.#operations.get(operationId);
    if (current === undefined) return undefined;
    if (NEXT_STATE[current.state] !== toState) return undefined;

    const updated: DurableOperation = {
      ...current,
      ...updates,
      evidence: updates.evidence !== undefined ? [...current.evidence, ...updates.evidence] : current.evidence,
      state: toState,
      updated_at: this.#clock.now().toISOString(),
    };
    this.#operations.set(operationId, updated);
    return updated;
  }

  get(workspaceId: string, operationId: string): DurableOperation | undefined {
    const operation = this.#operations.get(operationId);
    if (operation === undefined || operation.workspace_id !== workspaceId) return undefined;
    return operation;
  }
}
