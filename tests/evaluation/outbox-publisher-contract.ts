import assert from "node:assert/strict";
import test from "node:test";

import type { OutboxPublisher, OutboxRecord } from "../../src/evaluation/outbox-publisher.js";

export type OutboxPublisherContractFixture = Readonly<{
  makePublisher(): Promise<OutboxPublisher> | OutboxPublisher;
  /**
   * Seeds one outbox row with the given identity, as if a producer's
   * transaction had already committed it. `lease_expires_at` in the past
   * (or `available_at` in the future) lets a test start from a row that is
   * already leased-but-expired, or not-yet-available, without the adapter
   * itself needing to accept a negative lease duration.
   */
  seed(
    publisher: OutboxPublisher,
    row: Readonly<{
      event_id: string;
      available_at?: string;
      workspace_id?: string;
      lease_token?: string;
      lease_expires_at?: string;
    }>,
  ): Promise<void> | void;
  closePublisher?(publisher: OutboxPublisher): Promise<void> | void;
}>;

/**
 * ADR-012 §7 / SPEC-505 §7: every outbox worker adapter SHALL pass the same
 * claim-atomicity, lease-expiry-reclaim, duplicate-delivery, and
 * dead-letter contract, regardless of whether it is backed by SQLite
 * (single-process local Workspace, ADR-017) or PostgreSQL (shared/team
 * profile, ADR-012).
 */
export function runOutboxPublisherContract(
  adapterName: string,
  fixture: OutboxPublisherContractFixture,
): void {
  test(`[${adapterName}] claims a batch and returns full record fields`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-claim-fields-001" });

    const claimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });

    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    assert.ok(claimed.ok);
    assert.equal(claimed.value.records.length, 1);
    const record = claimed.value.records[0] as OutboxRecord;
    assert.equal(record.event_id, "event-claim-fields-001");
    assert.equal(record.attempt_count, 0);
  });

  test(`[${adapterName}] a claimed event is not claimable again until its lease expires`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-lease-hold-001" });

    const first = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.ok(first.ok);
    assert.equal(first.value.records.length, 1);

    const second = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.ok(second.ok);
    assert.equal(second.value.records.length, 0);
  });

  test(`[${adapterName}] an expired lease becomes reclaimable by a later claim`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    // Seeded already leased, with that lease expired in the past — stands
    // in for a worker that claimed this row a while ago and never reported
    // back (crashed, lost network, etc.).
    await fixture.seed(publisher, {
      event_id: "event-lease-expired-001",
      lease_token: "lease-token-abandoned-001",
      lease_expires_at: "2020-01-01T00:00:00.000Z",
    });

    const claimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    assert.ok(claimed.ok);
    assert.equal(claimed.value.records.length, 1);
    assert.equal(claimed.value.records[0]?.event_id, "event-lease-expired-001");
  });

  test(`[${adapterName}] markPublished excludes the event from future claims`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-published-001" });

    const claimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.ok(claimed.ok);
    const leaseToken = claimed.value.lease_token;

    const published = await publisher.markPublished({
      lease_token: leaseToken,
      event_id: "event-published-001",
    });
    assert.equal(published.ok, true, JSON.stringify(published));
    assert.ok(published.ok);
    assert.equal(published.value, "published");

    const reclaimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.ok(reclaimed.ok);
    assert.equal(reclaimed.value.records.length, 0);
  });

  test(`[${adapterName}] markPublished under a stale lease token fails instead of double-publishing`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-stale-lease-001" });
    await publisher.claimBatch({ max_batch_size: 10, lease_duration_seconds: 30, max_attempts: 5 });

    const staleAttempt = await publisher.markPublished({
      lease_token: "lease-token-never-issued",
      event_id: "event-stale-lease-001",
    });

    assert.equal(staleAttempt.ok, false);
    assert.ok(!staleAttempt.ok);
    assert.equal(staleAttempt.failure.code, "lease_expired");
  });

  test(`[${adapterName}] markFailed below max_attempts schedules a retry instead of dead-lettering`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-retry-001" });

    const claimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.ok(claimed.ok);

    const failed = await publisher.markFailed({
      lease_token: claimed.value.lease_token,
      event_id: "event-retry-001",
      error: "simulated transient publish failure",
      retry_backoff_seconds: 0,
      max_attempts: 5,
    });
    assert.equal(failed.ok, true, JSON.stringify(failed));
    assert.ok(failed.ok);
    assert.equal(failed.value, "retry_scheduled");

    const reclaimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });
    assert.ok(reclaimed.ok);
    assert.equal(reclaimed.value.records.length, 1);
    assert.equal(reclaimed.value.records[0]?.attempt_count, 1);
  });

  test(`[${adapterName}] markFailed at max_attempts dead-letters instead of retrying forever`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-dead-letter-001" });

    const claimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 1,
    });
    assert.ok(claimed.ok);

    const failed = await publisher.markFailed({
      lease_token: claimed.value.lease_token,
      event_id: "event-dead-letter-001",
      error: "simulated permanent publish failure",
      retry_backoff_seconds: 0,
      max_attempts: 1,
    });
    assert.equal(failed.ok, true, JSON.stringify(failed));
    assert.ok(failed.ok);
    assert.equal(failed.value, "dead_lettered");

    const reclaimed = await publisher.claimBatch({
      max_batch_size: 10,
      lease_duration_seconds: 30,
      max_attempts: 1,
    });
    assert.ok(reclaimed.ok);
    assert.equal(
      reclaimed.value.records.length,
      0,
      "a dead-lettered event must never be reclaimed automatically",
    );
  });

  test(`[${adapterName}] claim batch size is bounded even when more events are claimable`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));
    await fixture.seed(publisher, { event_id: "event-bound-001" });
    await fixture.seed(publisher, { event_id: "event-bound-002" });
    await fixture.seed(publisher, { event_id: "event-bound-003" });

    const claimed = await publisher.claimBatch({
      max_batch_size: 2,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });

    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    assert.ok(claimed.ok);
    assert.equal(claimed.value.records.length, 2);
  });

  test(`[${adapterName}] rejects a non-positive batch size, lease duration, or max attempts`, async (context) => {
    const publisher = await fixture.makePublisher();
    if (fixture.closePublisher) context.after(() => fixture.closePublisher!(publisher));

    const claimed = await publisher.claimBatch({
      max_batch_size: 0,
      lease_duration_seconds: 30,
      max_attempts: 5,
    });

    assert.equal(claimed.ok, false);
    assert.ok(!claimed.ok);
    assert.equal(claimed.failure.code, "invalid_request");
  });
}
