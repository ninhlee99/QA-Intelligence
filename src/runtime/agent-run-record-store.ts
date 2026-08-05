import type {
  AgentRunEvent,
  AgentRunReference,
  AgentRunResult,
  AgentRunSnapshot,
  AgentRunStartRequest,
} from "./public.js";

export type AgentRunMutationKind =
  | "start"
  | "authorize"
  | "execute"
  | "approve"
  | "resume"
  | "cancel";

export type AgentRunMutationCommand = Readonly<{
  kind: AgentRunMutationKind;
  idempotency_key: string;
  request_digest: string;
}>;

/**
 * The full durable state SPEC-410 §5 requires: run aggregate, checkpoint,
 * append-only attempt/event record, and the terminal result once retained.
 * Mirrors the InMemoryAgentRuntime RunRecord shape so a SQLite/Postgres-backed
 * AgentRuntime can persist through this seam without changing SPEC-508
 * envelope semantics.
 */
export type AgentRunRecord = Readonly<{
  snapshot: AgentRunSnapshot;
  events: readonly AgentRunEvent[];
  start_request: AgentRunStartRequest;
  started_at: string;
  start_fingerprint: string;
  result: AgentRunResult | null;
}>;

export type RetainAgentRunMutationRequest = Readonly<{
  record: AgentRunRecord;
  expected_revision: number | null;
  command: AgentRunMutationCommand;
}>;

export type PeekAgentRunCommandRequest = Readonly<{
  workspace_id: string;
  run_id: string;
  kind: AgentRunMutationKind;
  idempotency_key: string;
}>;

export type AgentRunCommandPeek = Readonly<{
  request_digest: string;
  record: AgentRunRecord;
}>;

export type AgentRunRecordStoreFailureCode =
  | "invalid_request"
  | "not_found"
  | "workspace_denied"
  | "idempotency_conflict"
  | "stale_revision"
  | "persistence_corrupt"
  | "persistence_unavailable";

export type AgentRunRecordStoreResult =
  | Readonly<{ ok: true; value: AgentRunRecord }>
  | Readonly<{
      ok: false;
      failure: Readonly<{
        code: AgentRunRecordStoreFailureCode;
        message: string;
      }>;
    }>;

/**
 * Provider-neutral retained Agent Run storage seam (SPEC-410 §5). The parent
 * runtime is the sole writer; sub-agents and workers never receive a
 * reference to this interface's implementation directly (ADR-017 §3).
 */
export interface AgentRunRecordStore {
  retainMutation(
    request: RetainAgentRunMutationRequest,
  ): Promise<AgentRunRecordStoreResult>;
  load(reference: AgentRunReference): Promise<AgentRunRecordStoreResult>;
  /**
   * Returns the durably retained result of a prior command, if any, without
   * attempting a mutation, so a caller can decide idempotent-replay vs.
   * stale-revision before computing a new record.
   */
  peekCommand(
    request: PeekAgentRunCommandRequest,
  ): Promise<AgentRunCommandPeek | undefined>;
}
