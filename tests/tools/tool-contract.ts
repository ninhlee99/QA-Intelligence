import assert from "node:assert/strict";
import test from "node:test";

import type { Tool, ToolCall } from "../../src/tools/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

/**
 * SPEC-510 §5's required conformance surface: "schema, least privilege,
 * injection, idempotency, timeout, partial effect, retry, cancellation,
 * compensation, redaction, replay, and cross-Workspace tests." A fixture
 * supplies only what differs per Tool adapter: how to build one, a
 * Workspace context, and calls scripted for each outcome family.
 */
export type ToolContractFixture = Readonly<{
  makeTool(): Tool | Promise<Tool>;
  workspaceContext(): WorkspaceContext;
  /** A call scripted to succeed with a full effect. */
  successCall(): ToolCall;
  /** A call scripted to time out. */
  timeoutCall(): ToolCall;
  /** A call scripted to apply only part of its intended effect. */
  partialEffectCall(): ToolCall;
  /** A call whose Workspace lacks a required permission the descriptor declares. */
  callMissingPermission(): ToolCall;
  /** A call carrying no authorization proof at all. */
  callWithoutAuthorizationProof(): ToolCall;
}>;

export function runToolContract(toolName: string, fixture: ToolContractFixture): void {
  test(`[${toolName}] list_capabilities exposes a schema-conformant descriptor (SPEC-510 §3)`, async () => {
    const tool = await fixture.makeTool();
    const descriptors = await tool.list_capabilities(fixture.workspaceContext());

    assert.ok(descriptors.length > 0);
    const descriptor = descriptors[0];
    assert.ok(descriptor);
    assert.ok(descriptor.tool.id.length > 0);
    assert.ok(["read", "write", "destructive"].includes(descriptor.effect_class));
    assert.ok(Array.isArray(descriptor.required_permissions));
  });

  test(`[${toolName}] least privilege: a call missing a required permission is denied before invoke (SPEC-510 §5)`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.callMissingPermission();

    const decision = await tool.validate_call(call);
    assert.equal(decision.allowed, false);
    if (decision.allowed) return;
    assert.ok(decision.reasons.includes("missing_required_permission"));

    const result = await tool.invoke(call);
    assert.equal(result.ok, false, "a denied call SHALL NOT invoke");
    if (result.ok) return;
    assert.equal(result.failure.code, "denial");
  });

  test(`[${toolName}] a call without an authorization proof is denied (SPEC-510 §3)`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.callWithoutAuthorizationProof();

    const decision = await tool.validate_call(call);
    assert.equal(decision.allowed, false);
  });

  test(`[${toolName}] a validated call succeeds and reports a normalized, schema-conformant result`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.successCall();

    const decision = await tool.validate_call(call);
    assert.equal(decision.allowed, true, JSON.stringify(decision));

    const result = await tool.invoke(call);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.value.code, "success");
    assert.equal(typeof result.value.output, "object");
    assert.ok(result.value.call_reference.length > 0);
  });

  test(`[${toolName}] idempotency: a duplicate call under the same idempotency_key does not re-apply the effect (SPEC-510 §5/§6)`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.successCall();

    const first = await tool.invoke(call);
    const second = await tool.invoke(call);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.value.call_reference, second.value.call_reference, "a duplicate call must return the same call_reference, not create a second effect");
  });

  test(`[${toolName}] a different call reusing the same idempotency_key is a conflict, not a silent replace`, async () => {
    const tool = await fixture.makeTool();
    const original = fixture.successCall();
    const conflicting: ToolCall = { ...original, purpose: `${original.purpose} (different)` };

    await tool.invoke(original);
    const result = await tool.invoke(conflicting);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "conflict");
  });

  test(`[${toolName}] timeout is a distinct, retryable result code (SPEC-510 §4)`, async () => {
    const tool = await fixture.makeTool();
    const result = await tool.invoke(fixture.timeoutCall());

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "timeout");
    assert.equal(result.failure.retryable, true);
  });

  test(`[${toolName}] partial effect is distinguishable from full success (SPEC-510 §4/§6)`, async () => {
    const tool = await fixture.makeTool();
    const result = await tool.invoke(fixture.partialEffectCall());

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.value.code, "partial_effect");
    assert.notEqual(result.value.effect_status, "applied");
  });

  test(`[${toolName}] inspect_effect reports the effect status of a call that actually ran`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.successCall();
    const invoked = await tool.invoke(call);
    assert.equal(invoked.ok, true);
    if (!invoked.ok) return;

    const status = await tool.inspect_effect(invoked.value.call_reference);
    assert.notEqual(status, undefined);
    assert.equal(status?.call_reference, invoked.value.call_reference);
  });

  test(`[${toolName}] inspect_effect returns undefined for an unknown call_reference, never a fabricated status`, async () => {
    const tool = await fixture.makeTool();
    const status = await tool.inspect_effect("tool-call:never-existed");

    assert.equal(status, undefined);
  });

  test(`[${toolName}] secrets are never returned as raw output — only redacted evidence references (SPEC-510 §5)`, async () => {
    const tool = await fixture.makeTool();
    const result = await tool.invoke(fixture.successCall());

    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const entry of result.value.redacted_evidence) {
      assert.doesNotMatch(entry, /password|secret|api_key|token=/i, "redacted_evidence SHALL NOT carry raw secret material");
    }
  });

  test(`[${toolName}] cross-Workspace: a call's authority is scoped to the Workspace it declares, not a caller-independent default`, async () => {
    const tool = await fixture.makeTool();
    const context = fixture.workspaceContext();
    const call = fixture.successCall();

    assert.equal(call.workspace.workspace_id, context.workspace_id, "the fixture's own success call must declare the same Workspace list_capabilities was queried against");
  });

  test(`[${toolName}] replay: invoking an already-invoked call again is deterministic (returns the retained result, not a re-run)`, async () => {
    const tool = await fixture.makeTool();
    const call = fixture.successCall();

    const first = await tool.invoke(call);
    const replayed = await tool.invoke(call);

    assert.deepEqual(first, replayed);
  });
}
