import { createHash } from "node:crypto";

import type {
  AgentRunAccessRequest,
  AgentRunApproval,
  AgentRunCancellation,
  AgentRunEventCursor,
  AgentRunEventPage,
  AgentRunExecution,
  AgentRunReference,
  AgentRunResult,
  AgentRunResume,
  AgentRunSnapshot,
  AgentRunStartRequest,
  AgentRunTransition,
  AgentRuntime,
  AgentRuntimeResult,
} from "./public.js";
import {
  InMemoryAgentRuntime,
  type Clock,
  type IdFactory,
  type RunRecord,
} from "./in-memory-agent-runtime.js";
import type { AgentRunExecutor } from "./executor.js";
import type { WorkspaceAuthorizer } from "../requirement-review/public.js";
import type {
  AgentRunRecord,
  AgentRunRecordStore,
} from "./agent-run-record-store.js";

/**
 * Backs the same `AgentRuntime` contract as `InMemoryAgentRuntime`, but
 * mirrors every completed command's final state through the ADR-017/SPEC-410
 * §5 `AgentRunRecordStore` seam instead of only an in-process Map, so an
 * Agent Run survives a process restart. State-machine and idempotency
 * decisions are computed by the composed `InMemoryAgentRuntime` unchanged —
 * this class never re-implements that logic — it only mirrors the result of
 * each completed command into the durable store and restores from it.
 *
 * A persistence failure surfaces as a thrown error from the completed public
 * method (see `InMemoryAgentRuntime`'s `RunPersistedHook` contract): this
 * class does not swallow it, because a run whose final state failed to
 * durably persist SHALL NOT be reported to the caller as if it had.
 */
export class PersistedAgentRuntime implements AgentRuntime {
  readonly #inner: InMemoryAgentRuntime;
  readonly #store: AgentRunRecordStore;

  constructor(
    clock: Clock,
    ids: IdFactory,
    authorizer: WorkspaceAuthorizer,
    store: AgentRunRecordStore,
    executor?: AgentRunExecutor,
  ) {
    this.#store = store;
    let pendingPersist: Promise<void> = Promise.resolve();
    this.#inner = new InMemoryAgentRuntime(clock, ids, authorizer, executor, (runId, record, command) => {
      // Commands complete synchronously from the caller's perspective in
      // InMemoryAgentRuntime, but retainMutation is async; chain onto the
      // last pending write so two completed commands for the same run
      // never race each other into the store out of order.
      pendingPersist = pendingPersist.then(() =>
        this.#retain(runId, record, command).then((outcome) => {
          if (!outcome.ok) {
            throw new Error(
              `Agent Run ${runId} completed command "${command.kind}" but durable persistence failed: ${outcome.failure.code} — ${outcome.failure.message}`,
            );
          }
        }),
      );
    });
    // Surface persistence failures to whichever call triggered them, not to
    // an unrelated later call — each public method below awaits the same
    // chain immediately after invoking the inner runtime.
    this.#pendingPersist = () => pendingPersist;
  }

  readonly #pendingPersist: () => Promise<void>;

  async #retain(
    runId: string,
    record: RunRecord,
    command: Readonly<{ kind: "start" | "execute" | "approve" | "resume" | "cancel"; idempotency_key: string; expected_revision: number | null }>,
  ) {
    return this.#store.retainMutation({
      record: toAgentRunRecord(runId, record),
      expected_revision: command.expected_revision,
      command: {
        kind: command.kind,
        idempotency_key: command.idempotency_key,
        request_digest: requestDigest(runId, command),
      },
    });
  }

  /**
   * Restores in-process state for one Workspace-scoped run from the durable
   * store, so a fresh `PersistedAgentRuntime` (e.g. after a process restart)
   * can serve `inspect`/`result`/`streamEvents` for a run it did not itself
   * create in this process. Idempotent: restoring an already-known run is a
   * caller error to avoid, but this method does not need to guard it — the
   * composed `InMemoryAgentRuntime` has no public "seed" API, so restoration
   * happens once, before any command is issued against this reference in
   * this process.
   */
  async restore(reference: AgentRunReference): Promise<AgentRuntimeResult<AgentRunSnapshot>> {
    const loaded = await this.#store.load(reference);
    if (!loaded.ok) {
      return {
        ok: false,
        failure: {
          class: "orchestration",
          code: loaded.failure.code === "not_found" ? "not_found" : "unavailable",
          message: loaded.failure.message,
          retryable: loaded.failure.code === "persistence_unavailable",
          evidence: [],
        },
      };
    }
    this.#inner.seed(reference.run_id, fromAgentRunRecord(loaded.value));
    return { ok: true, value: loaded.value.snapshot };
  }

  async start(request: AgentRunStartRequest): Promise<AgentRuntimeResult<AgentRunReference>> {
    const result = await this.#inner.start(request);
    await this.#pendingPersist();
    return result;
  }

  async execute(
    reference: AgentRunReference,
    execution: AgentRunExecution,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    const result = await this.#inner.execute(reference, execution);
    await this.#pendingPersist();
    return result;
  }

  async inspect(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunSnapshot>> {
    return this.#inner.inspect(reference, access);
  }

  async result(
    reference: AgentRunReference,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    return this.#inner.result(reference, access);
  }

  async approve(
    reference: AgentRunReference,
    approval: AgentRunApproval,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#inner.approve(reference, approval);
    await this.#pendingPersist();
    return result;
  }

  async resume(
    reference: AgentRunReference,
    checkpoint: AgentRunResume,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#inner.resume(reference, checkpoint);
    await this.#pendingPersist();
    return result;
  }

  async cancel(
    reference: AgentRunReference,
    cancellation: AgentRunCancellation,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#inner.cancel(reference, cancellation);
    await this.#pendingPersist();
    return result;
  }

  async streamEvents(
    reference: AgentRunReference,
    cursor: AgentRunEventCursor,
    access: AgentRunAccessRequest,
  ): Promise<AgentRuntimeResult<AgentRunEventPage>> {
    return this.#inner.streamEvents(reference, cursor, access);
  }
}

function toAgentRunRecord(runId: string, record: RunRecord): AgentRunRecord {
  return {
    snapshot: record.snapshot,
    events: record.events,
    start_request: record.startRequest,
    started_at: record.startedAt,
    start_fingerprint: record.startFingerprint,
    result: record.result ?? null,
  };
}

function fromAgentRunRecord(record: AgentRunRecord): RunRecord {
  return {
    snapshot: record.snapshot,
    events: record.events,
    startRequest: record.start_request,
    startedAt: record.started_at,
    startFingerprint: record.start_fingerprint,
    ...(record.result === null ? {} : { result: record.result }),
  };
}

function requestDigest(
  runId: string,
  command: Readonly<{ kind: string; idempotency_key: string; expected_revision: number | null }>,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ runId, kind: command.kind, idempotency_key: command.idempotency_key }))
    .digest("hex");
}
