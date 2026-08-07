import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryEvaluationCampaignRepository,
  type EvaluationCampaignRecord,
} from "../../src/evaluation/evaluation-campaign-repository.js";
import type {
  EvaluationCampaignRecordStore,
  RetainEvaluationCampaignMutationRequest,
} from "../../src/evaluation/evaluation-campaign-record-store.js";

const NOW = "2026-08-03T16:00:00.000Z";

export type RecordStoreContractFixture = Readonly<{
  workspace_id: string;
  campaign_id: string;
  makeStore(workspaceId: string): Promise<EvaluationCampaignRecordStore> | EvaluationCampaignRecordStore;
  closeStore?(store: EvaluationCampaignRecordStore): Promise<void> | void;
}>;

/**
 * ADR-017 §6: local and shared adapters SHALL pass the same lifecycle,
 * idempotency, optimistic-concurrency, retention, corruption, and Workspace
 * identity contract suite. This harness is that shared suite; each adapter's
 * test file supplies only a factory.
 */
export function runEvaluationCampaignRecordStoreContract(
  adapterName: string,
  fixture: RecordStoreContractFixture,
): void {
  test(`[${adapterName}] atomically retains a created campaign and loads it back`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);

    const retained = await store.retainMutation(mutationRequest(record));
    assert.equal(retained.ok, true, JSON.stringify(retained));
    assert.ok(retained.ok);
    assert.deepEqual(retained.value, record);

    const loaded = await store.load({
      workspace_id: fixture.workspace_id,
      campaign_id: fixture.campaign_id,
    });
    assert.equal(loaded.ok, true, JSON.stringify(loaded));
    assert.ok(loaded.ok);
    assert.deepEqual(loaded.value, record);
  });

  test(`[${adapterName}] replays a retained command result without duplicating state`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);
    const request = mutationRequest(record);

    const first = await store.retainMutation(request);
    const second = await store.retainMutation(request);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.ok(first.ok && second.ok);
    assert.deepEqual(second.value, first.value);
  });

  test(`[${adapterName}] rejects idempotency key reuse bound to a different request`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);
    const request = mutationRequest(record);
    await store.retainMutation(request);

    const conflicting = await store.retainMutation({
      ...request,
      command: { ...request.command, request_digest: "sha256:different-request" },
    });

    assert.equal(conflicting.ok, false);
    assert.ok(!conflicting.ok);
    assert.equal(conflicting.failure.code, "idempotency_conflict");
  });

  test(`[${adapterName}] retains only the next optimistic campaign revision`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const created = await createdRecord(fixture);
    await store.retainMutation(mutationRequest(created));
    const transitioned = await transitionedRecord(fixture);

    const retained = await store.retainMutation(transitionMutationRequest(transitioned));

    assert.equal(retained.ok, true, JSON.stringify(retained));
    assert.ok(retained.ok);
    assert.equal(retained.value.snapshot.revision, 2);
    assert.equal(retained.value.snapshot.state, "validating");
  });

  test(`[${adapterName}] rejects a stale optimistic revision instead of overwriting`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const created = await createdRecord(fixture);
    await store.retainMutation(mutationRequest(created));
    const transitioned = await transitionedRecord(fixture);
    await store.retainMutation(transitionMutationRequest(transitioned));

    const staleRetry = await store.retainMutation({
      ...transitionMutationRequest(transitioned),
      command: {
        kind: "transition",
        idempotency_key: "transition-validating-002-stale",
        request_digest: "sha256:transition-validating-002-stale",
      },
    });

    assert.equal(staleRetry.ok, false);
    assert.ok(!staleRetry.ok);
    assert.equal(staleRetry.failure.code, "stale_revision");
  });

  test(`[${adapterName}] cannot load a retained campaign through another Workspace's reference`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);
    const retained = await store.retainMutation(mutationRequest(record));
    assert.equal(retained.ok, true, JSON.stringify(retained));

    // ADR-017 §6: both adapters SHALL fail closed when a request's Workspace
    // does not match the retained record's Workspace. The enforcement
    // mechanism differs (SQLite checks Workspace identity in code against
    // the file it was opened for; PostgreSQL relies on RLS scoped per call),
    // so the failure code may differ, but neither adapter may return another
    // Workspace's record as if it were addressable from this reference.
    const loaded = await store.load({
      workspace_id: "workspace-contract-other-999",
      campaign_id: fixture.campaign_id,
    });
    assert.equal(loaded.ok, false, JSON.stringify(loaded));
    assert.ok(!loaded.ok);
    assert.ok(
      loaded.failure.code === "workspace_denied" ||
        loaded.failure.code === "not_found" ||
        loaded.failure.code === "persistence_unavailable",
      `unexpected failure code: ${loaded.failure.code}`,
    );
  });

  test(`[${adapterName}] reports not_found for a campaign that was never retained`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));

    const loaded = await store.load({
      workspace_id: fixture.workspace_id,
      campaign_id: "campaign-contract-never-retained",
    });

    assert.equal(loaded.ok, false);
    assert.ok(!loaded.ok);
    assert.equal(loaded.failure.code, "not_found");
  });

  test(`[${adapterName}] rejects a command kind that does not match the retained domain event`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);
    const request = mutationRequest(record);

    const retained = await store.retainMutation({
      ...request,
      command: { ...request.command, kind: "transition" },
    });

    assert.equal(retained.ok, false);
    assert.ok(!retained.ok);
    assert.equal(retained.failure.code, "invalid_request");
  });

  test(`[${adapterName}] normalizes an unknown runtime command kind without throwing`, async (context) => {
    const store = await fixture.makeStore(fixture.workspace_id);
    if (fixture.closeStore) context.after(() => fixture.closeStore!(store));
    const record = await createdRecord(fixture);
    const request = mutationRequest(record);

    const retained = await store.retainMutation({
      ...request,
      command: {
        ...request.command,
        kind: "forged-command-kind" as typeof request.command.kind,
      },
    });

    assert.equal(retained.ok, false);
    assert.ok(!retained.ok);
    assert.equal(retained.failure.code, "invalid_request");
  });
}

async function createdRecord(
  fixture: Pick<RecordStoreContractFixture, "workspace_id" | "campaign_id">,
): Promise<EvaluationCampaignRecord> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create({
    workspace_id: fixture.workspace_id,
    campaign_id: fixture.campaign_id,
    actor_id: "evaluation-runner-contract-001",
    idempotency_key: `create-${fixture.campaign_id}`,
    definition: {
      subject: {
        type: "skill",
        id: "assess-requirement-quality",
        version: "0.1.0",
      },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        {
          case_id: "positive-rule-only",
          trial_id: `trial-${fixture.campaign_id}`,
          attempt_id: `attempt-${fixture.campaign_id}`,
        },
      ],
    },
  });
  assert.ok(created.ok);
  return created.value;
}

async function transitionedRecord(
  fixture: Pick<RecordStoreContractFixture, "workspace_id" | "campaign_id">,
): Promise<EvaluationCampaignRecord> {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create({
    workspace_id: fixture.workspace_id,
    campaign_id: fixture.campaign_id,
    actor_id: "evaluation-runner-contract-001",
    idempotency_key: `create-${fixture.campaign_id}`,
    definition: {
      subject: {
        type: "skill",
        id: "assess-requirement-quality",
        version: "0.1.0",
      },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        {
          case_id: "positive-rule-only",
          trial_id: `trial-${fixture.campaign_id}`,
          attempt_id: `attempt-${fixture.campaign_id}`,
        },
      ],
    },
  });
  assert.ok(created.ok);
  const transitioned = await repository.transition({
    workspace_id: fixture.workspace_id,
    campaign_id: fixture.campaign_id,
    actor_id: "evaluation-runner-contract-001",
    expected_revision: 1,
    idempotency_key: `transition-validating-${fixture.campaign_id}`,
    to_state: "validating",
    reason: "definition validation started",
    evidence: ["evidence://definition/validation-started"],
  });
  assert.ok(transitioned.ok);
  return transitioned.value;
}

function mutationRequest(
  record: EvaluationCampaignRecord,
): RetainEvaluationCampaignMutationRequest {
  return {
    record,
    expected_revision: null,
    command: {
      kind: "create",
      idempotency_key: `create-${record.snapshot.campaign_id}`,
      request_digest: `sha256:create-${record.snapshot.campaign_id}`,
    },
    outbox: {
      event_id: `event-create-${record.snapshot.campaign_id}`,
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence-contract",
      producer_version: "0.1.0",
      correlation_id: record.snapshot.campaign_id,
      causation_id: `create-${record.snapshot.campaign_id}`,
      classification: "internal",
    },
  };
}

function transitionMutationRequest(
  record: EvaluationCampaignRecord,
): RetainEvaluationCampaignMutationRequest {
  return {
    record,
    expected_revision: 1,
    command: {
      kind: "transition",
      idempotency_key: `transition-validating-${record.snapshot.campaign_id}`,
      request_digest: `sha256:transition-validating-${record.snapshot.campaign_id}`,
    },
    outbox: {
      event_id: `event-transition-${record.snapshot.campaign_id}`,
      event_type: "evaluation.campaign.transitioned",
      schema_version: "1.0.0",
      producer_id: "qa-intelligence-contract",
      producer_version: "0.1.0",
      correlation_id: record.snapshot.campaign_id,
      causation_id: `transition-validating-${record.snapshot.campaign_id}`,
      classification: "internal",
    },
  };
}
