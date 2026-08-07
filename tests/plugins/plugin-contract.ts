import assert from "node:assert/strict";
import test from "node:test";

import type { InitializeRequest, InvokeRequest, Plugin } from "../../src/plugins/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

/**
 * SPEC-503 §8: "Every production plugin SHALL have a deterministic fake or
 * replay adapter exercising the same contract." This is that shared suite —
 * the pattern already used for `run*Contract` across the
 * record-store/outbox/authorizer/context-issuer/rule-engine/execution-engine
 * seams, applied to Plugin adapters. A fixture supplies only what genuinely
 * differs per adapter: how to build a plugin, a Workspace context, an
 * initialize request, and an invoke request scripted for a given outcome.
 */
export type PluginContractFixture = Readonly<{
  makePlugin(): Plugin | Promise<Plugin>;
  workspaceContext(): WorkspaceContext;
  initializeRequestFor(operationId: string): InitializeRequest;
  /** Builds an `invoke` request for a scenario scripted to complete with `outcome`. */
  invokeRequestFor(
    instanceRef: string,
    operationId: string,
    outcome: "success" | "failure",
  ): InvokeRequest;
}>;

export function runPluginContract(pluginName: string, fixture: PluginContractFixture): void {
  test(`[${pluginName}] descriptor reports plugin identity before any instance is initialized (SPEC-503 §2)`, async () => {
    const plugin = await fixture.makePlugin();
    const context = fixture.workspaceContext();
    const result = await plugin.descriptor({
      operation: "descriptor",
      operationId: "op-descriptor-1",
      workspace: context,
      idempotency: { key: "k-descriptor-1", scope: "descriptor", request_digest: "" },
      deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
      version: { contract: "1.0.0", operation_schema: "1.0.0" },
      payload: { required_capabilities: [] },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.ok(result.value.descriptor.id.length > 0);
    assert.ok(result.value.supported_contract_versions.includes("1.0.0"));
  });

  test(`[${pluginName}] initialize scopes an instance the caller can later invoke, health-check, and dispose (SPEC-503 §3)`, async () => {
    const plugin = await fixture.makePlugin();
    const initialized = await plugin.initialize(fixture.initializeRequestFor("op-init-1"));

    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    if (!initialized.ok) return;
    assert.ok(initialized.value.instance_ref.length > 0);

    const health = await plugin.health({
      operation: "health",
      operationId: "op-health-1",
      workspace: fixture.workspaceContext(),
      idempotency: { key: "k-health-1", scope: "health", request_digest: "" },
      deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
      version: { contract: "1.0.0", operation_schema: "1.0.0" },
      payload: { instance_ref: initialized.value.instance_ref },
    });
    assert.equal(health.ok, true, JSON.stringify(health));
  });

  test(`[${pluginName}] invoke is idempotent within one idempotency key (SPEC-503 §8)`, async () => {
    const plugin = await fixture.makePlugin();
    const initialized = await plugin.initialize(fixture.initializeRequestFor("op-init-idempotent"));
    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    if (!initialized.ok) return;

    const request = fixture.invokeRequestFor(initialized.value.instance_ref, "op-invoke-idempotent", "success");
    const first = await plugin.invoke(request);
    const second = await plugin.invoke(request);

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!first.ok || !second.ok) return;
    assert.deepEqual(first.value, second.value, "a duplicate invoke SHALL replay the same result, not re-run the capability");
  });

  test(`[${pluginName}] result mapping distinguishes success and failure outcomes (SPEC-503 §5)`, async () => {
    const plugin = await fixture.makePlugin();
    const initialized = await plugin.initialize(fixture.initializeRequestFor("op-init-mapping"));
    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    if (!initialized.ok) return;

    const succeeded = await plugin.invoke(
      fixture.invokeRequestFor(initialized.value.instance_ref, "op-invoke-success", "success"),
    );
    const failed = await plugin.invoke(
      fixture.invokeRequestFor(initialized.value.instance_ref, "op-invoke-failure", "failure"),
    );

    assert.equal(succeeded.ok, true, JSON.stringify(succeeded));
    assert.equal(failed.ok, true, JSON.stringify(failed));
    if (!succeeded.ok || !failed.ok) return;
    assert.equal(succeeded.value.outcome, "success");
    assert.equal(failed.value.outcome, "failure");
  });

  test(`[${pluginName}] invoking against a disposed or unknown instance fails closed instead of throwing (SPEC-503 §3)`, async () => {
    const plugin = await fixture.makePlugin();
    const request = fixture.invokeRequestFor("instance:unknown", "op-invoke-unknown", "success");

    const result = await plugin.invoke(request);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "instance_unavailable");
  });

  test(`[${pluginName}] dispose releases the instance so later invocation against it fails closed (SPEC-503 §3)`, async () => {
    const plugin = await fixture.makePlugin();
    const initialized = await plugin.initialize(fixture.initializeRequestFor("op-init-dispose"));
    assert.equal(initialized.ok, true, JSON.stringify(initialized));
    if (!initialized.ok) return;

    const disposed = await plugin.dispose({
      operation: "dispose",
      operationId: "op-dispose-1",
      workspace: fixture.workspaceContext(),
      idempotency: { key: "k-dispose-1", scope: "dispose", request_digest: "" },
      deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
      version: { contract: "1.0.0", operation_schema: "1.0.0" },
      payload: { instance_ref: initialized.value.instance_ref },
    });
    assert.equal(disposed.ok, true, JSON.stringify(disposed));
    if (!disposed.ok) return;
    assert.equal(disposed.value.disposed, true);

    const afterDispose = await plugin.invoke(
      fixture.invokeRequestFor(initialized.value.instance_ref, "op-invoke-after-dispose", "success"),
    );
    assert.equal(afterDispose.ok, false);
    if (afterDispose.ok) return;
    assert.equal(afterDispose.failure.code, "instance_unavailable");
  });
}
