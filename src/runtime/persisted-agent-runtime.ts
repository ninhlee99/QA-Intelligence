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
  // One pending-write chain per run, not one for the whole instance: two
  // concurrent commands racing on DIFFERENT runs must never let a failure on
  // one poison persistence for the other. The chain stored here always
  // resolves (never rejects) once a write settles, whether that write
  // succeeded or threw — so one run's persistence failure never poisons
  // that SAME run's later commands either. #lastSettled below tracks the
  // possibly-rejected promise each caller actually needs to observe.
  readonly #pendingByRun = new Map<string, Promise<void>>();

  constructor(
    clock: Clock,
    ids: IdFactory,
    authorizer: WorkspaceAuthorizer,
    store: AgentRunRecordStore,
    executor?: AgentRunExecutor,
  ) {
    this.#store = store;
    this.#inner = new InMemoryAgentRuntime(clock, ids, authorizer, executor, (runId, record, command) => {
      // Commands complete synchronously from the caller's perspective in
      // InMemoryAgentRuntime, but retainMutation is async; chain onto this
      // run's last pending write so two completed commands for the SAME run
      // never race each other into the store out of order.
      const previous = this.#pendingByRun.get(runId) ?? Promise.resolve();
      const settled = previous.then(
        () => this.#retain(runId, record, command),
        () => this.#retain(runId, record, command),
      );
      // However this settles, the NEXT command for this run starts its own
      // chain fresh rather than inheriting this one's outcome — a transient
      // failure (or a benign stale_revision from a command that lost a
      // race) must not permanently block persistence for this run either.
      this.#pendingByRun.set(
        runId,
        settled.then(
          () => undefined,
          () => undefined,
        ),
      );
      this.#lastSettled.set(runId, settled);
    });
  }

  readonly #lastSettled = new Map<string, Promise<void>>();

  /** Awaits whatever this run's most recently completed command's persistence settled to, surfacing a real failure to its own caller only. */
  async #awaitPersist(runId: string): Promise<void> {
    await (this.#lastSettled.get(runId) ?? Promise.resolve());
  }

  async #retain(
    runId: string,
    record: RunRecord,
    command: Readonly<{ kind: "start" | "execute" | "approve" | "resume" | "cancel"; idempotency_key: string; expected_revision: number | null }>,
  ): Promise<void> {
    // Two commands racing on the SAME run (e.g. a concurrent execute and
    // cancel) can both fire this hook observing the same current record —
    // one of them didn't actually cause it: either its own attempt was
    // rejected before mutating anything (e.g. cancel on an already-terminal
    // run, so the record never advanced past what it observed before
    // running), or a concurrent command already advanced the run PAST what
    // this command expected (e.g. this execute's own transition never
    // landed because a racing cancel committed first). retainMutation
    // requires the record's revision to be exactly expected_revision + 1;
    // anything else here is not a persistence failure for THIS command to
    // report — either nothing changed, or something newer already did.
    if (
      command.expected_revision !== null &&
      record.snapshot.revision !== command.expected_revision + 1
    ) {
      return;
    }
    const outcome = await this.#store.retainMutation({
      record: toAgentRunRecord(runId, record),
      expected_revision: command.expected_revision,
      command: {
        kind: command.kind,
        idempotency_key: command.idempotency_key,
        request_digest: requestDigest(runId, command),
      },
    });
    if (outcome.ok) return;
    if (outcome.failure.code === "stale_revision" || outcome.failure.code === "idempotency_conflict") {
      // Another command for this same run already persisted a state at
      // least as new as this one (a legitimate race between two concurrent
      // callers, e.g. execute() and cancel() on the same run) — the store
      // already holds the newer, authoritative state, so there is nothing
      // for THIS command to durably record. This is not a persistence
      // failure the caller needs to see.
      return;
    }
    throw new Error(
      `Agent Run ${runId} completed command "${command.kind}" but durable persistence failed: ${outcome.failure.code} — ${outcome.failure.message}`,
    );
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
    if (result.ok) await this.#awaitPersist(result.value.run_id);
    return result;
  }

  async execute(
    reference: AgentRunReference,
    execution: AgentRunExecution,
  ): Promise<AgentRuntimeResult<AgentRunResult>> {
    const result = await this.#inner.execute(reference, execution);
    await this.#awaitPersist(reference.run_id);
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
    await this.#awaitPersist(reference.run_id);
    return result;
  }

  async resume(
    reference: AgentRunReference,
    checkpoint: AgentRunResume,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#inner.resume(reference, checkpoint);
    await this.#awaitPersist(reference.run_id);
    return result;
  }

  async cancel(
    reference: AgentRunReference,
    cancellation: AgentRunCancellation,
  ): Promise<AgentRuntimeResult<AgentRunTransition>> {
    const result = await this.#inner.cancel(reference, cancellation);
    await this.#awaitPersist(reference.run_id);
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
