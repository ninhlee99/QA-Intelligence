import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutionAttemptIdentity,
  ExecutionEngine,
  ExecutionEngineEvent,
  StartRequest,
} from "../../src/execution-engine/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

/**
 * SPEC-504 §6/§7: "Production engines and a deterministic simulator/replay
 * engine SHALL pass identical lifecycle, result-mapping, and evidence
 * contract tests." This is that shared suite — the pattern already used
 * for `run*Contract` across the record-store/outbox/authorizer/context-
 * issuer/rule-engine seams, applied to Execution Engine adapters for the
 * first time. A fixture supplies only what genuinely differs per adapter:
 * how to build an engine, a Workspace context, and a start request for a
 * scripted attempt with a given outcome behavior.
 */
export type ExecutionEngineContractFixture = Readonly<{
  makeEngine(): ExecutionEngine | Promise<ExecutionEngine>;
  workspaceContext(): WorkspaceContext;
  /** Builds a `start` request for an attempt scripted to complete with `outcome`. */
  startRequestFor(
    attempt: ExecutionAttemptIdentity,
    outcome: "passed" | "failed" | "cancelled",
  ): StartRequest;
}>;

function attempt(id: string): ExecutionAttemptIdentity {
  return { execution_id: `execution-${id}`, attempt_id: `attempt-${id}` };
}

export function runExecutionEngineContract(
  engineName: string,
  fixture: ExecutionEngineContractFixture,
): void {
  test(`[${engineName}] descriptor reports supported operations before any attempt runs`, async () => {
    const engine = await fixture.makeEngine();
    const context = fixture.workspaceContext();
    const result = await engine.descriptor({
      operation: "descriptor",
      operationId: "op-descriptor-1",
      attempt: attempt("descriptor-1"),
      workspace: context,
      idempotency: { key: "k-1", scope: "descriptor", request_digest: "" },
      deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
      version: { contract: "1.0.0", operation_schema: "1.0.0" },
      payload: { required_capabilities: ["start"] },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.ok(result.value.supported_operations.includes("start"));
  });

  test(`[${engineName}] start is idempotent within execution-attempt scope (SPEC-504 §7)`, async () => {
    const engine = await fixture.makeEngine();
    const attemptId = attempt("idempotent-1");
    const request = fixture.startRequestFor(attemptId, "passed");

    const eventsFirst: ExecutionEngineEvent[] = [];
    const first = await engine.start(request, (event) => eventsFirst.push(event));

    const eventsSecond: ExecutionEngineEvent[] = [];
    const second = await engine.start(request, (event) => eventsSecond.push(event));

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) return;
    assert.equal(first.value.outcome, second.value.outcome);
    assert.deepEqual(eventsFirst, eventsSecond, "a duplicate start SHALL replay the same events, not re-run the attempt");
  });

  test(`[${engineName}] events are ordered per attempt with a strictly increasing sequence (SPEC-504 §4)`, async () => {
    const engine = await fixture.makeEngine();
    const request = fixture.startRequestFor(attempt("ordering-1"), "passed");

    const events: ExecutionEngineEvent[] = [];
    await engine.start(request, (event) => events.push(event));

    assert.ok(events.length > 0, "a completed attempt must emit at least one lifecycle event");
    for (let index = 1; index < events.length; index += 1) {
      assert.ok(
        (events[index] as ExecutionEngineEvent).sequence > (events[index - 1] as ExecutionEngineEvent).sequence,
        "sequence must strictly increase within one attempt",
      );
    }
    for (const event of events) {
      assert.deepEqual(event.attempt, request.attempt, "every event must correlate to its own attempt");
    }
  });

  test(`[${engineName}] result mapping distinguishes passed, failed, and cancelled outcomes (SPEC-504 §5)`, async () => {
    const engine = await fixture.makeEngine();

    const passed = await engine.start(fixture.startRequestFor(attempt("map-passed"), "passed"), () => {});
    const failed = await engine.start(fixture.startRequestFor(attempt("map-failed"), "failed"), () => {});

    assert.equal(passed.ok, true);
    assert.equal(failed.ok, true);
    if (!passed.ok || !failed.ok) return;
    assert.equal(passed.value.outcome, "passed");
    assert.equal(failed.value.outcome, "failed");
    assert.notEqual(passed.value.outcome, failed.value.outcome);
  });

  test(`[${engineName}] cancellation is cooperative: an accepted cancel prevents a later terminal outcome from overriding it (SPEC-602 §5)`, async () => {
    const engine = await fixture.makeEngine();
    const attemptId = attempt("cancel-1");
    const startRequest = fixture.startRequestFor(attemptId, "cancelled");

    const cancelResult = await engine.cancel({
      operation: "cancel",
      operationId: "op-cancel-1",
      attempt: attemptId,
      workspace: startRequest.workspace,
      idempotency: { key: "k-cancel-1", scope: "cancel", request_digest: "" },
      deadline: startRequest.deadline,
      version: startRequest.version,
      payload: { reason: "caller requested cancellation" },
    });
    assert.equal(cancelResult.ok, true, JSON.stringify(cancelResult));
    if (!cancelResult.ok) return;
    assert.equal(cancelResult.value.accepted, true);

    const events: ExecutionEngineEvent[] = [];
    const started = await engine.start(startRequest, (event) => events.push(event));
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) return;
    assert.equal(started.value.outcome, "cancelled");
  });

  test(`[${engineName}] cancelling an already-terminal attempt does not rewrite its verdict (SPEC-602 §5)`, async () => {
    const engine = await fixture.makeEngine();
    const attemptId = attempt("terminal-cancel-1");
    const startRequest = fixture.startRequestFor(attemptId, "passed");

    const started = await engine.start(startRequest, () => {});
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) return;
    assert.equal(started.value.outcome, "passed");

    const cancelResult = await engine.cancel({
      operation: "cancel",
      operationId: "op-cancel-2",
      attempt: attemptId,
      workspace: startRequest.workspace,
      idempotency: { key: "k-cancel-2", scope: "cancel", request_digest: "" },
      deadline: startRequest.deadline,
      version: startRequest.version,
      payload: { reason: "late cancellation attempt" },
    });
    assert.equal(cancelResult.ok, true, JSON.stringify(cancelResult));
    if (!cancelResult.ok) return;
    assert.equal(cancelResult.value.already_terminal, true);
    assert.equal(cancelResult.value.accepted, false);

    const rerun = await engine.start(startRequest, () => {});
    assert.equal(rerun.ok, true);
    if (!rerun.ok) return;
    assert.equal(rerun.value.outcome, "passed", "the original terminal outcome must survive a late cancel");
  });

  test(`[${engineName}] finalize reports cleanup status (SPEC-602 §6)`, async () => {
    const engine = await fixture.makeEngine();
    const attemptId = attempt("finalize-1");
    const startRequest = fixture.startRequestFor(attemptId, "passed");
    await engine.start(startRequest, () => {});

    const finalized = await engine.finalize({
      operation: "finalize",
      operationId: "op-finalize-1",
      attempt: attemptId,
      workspace: startRequest.workspace,
      idempotency: { key: "k-finalize-1", scope: "finalize", request_digest: "" },
      deadline: startRequest.deadline,
      version: startRequest.version,
      payload: { environment_lease: "lease:x", cleanup_policy_ref: "policy:default" },
    });

    assert.equal(finalized.ok, true, JSON.stringify(finalized));
    if (!finalized.ok) return;
    assert.ok(["completed", "partial", "failed"].includes(finalized.value.cleanup_status));
  });
}
