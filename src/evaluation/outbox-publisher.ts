/**
 * Provider-neutral worker-side seam for the ADR-012 §7 / SPEC-505 §7
 * transactional outbox: claims (leases) a bounded batch of unpublished
 * `qa_platform_outbox` rows, then reports each claimed event published or
 * failed. Producers (e.g. PostgresEvaluationCampaignRecordStore,
 * SqliteEvaluationCampaignRecordStore) write outbox intent atomically with
 * their own aggregate mutation through a separate seam — this interface is
 * the consumer/worker half SPEC-505 §7 requires ("Publishers SHALL use a
 * transactional outbox... Retry, dead-letter... policies are explicit").
 *
 * The worker is a platform-level process, not a Workspace-scoped caller: it
 * claims and publishes events across every Workspace in one pass, so it
 * SHALL run under a database identity trusted for that (ADR-012 §3;
 * PostgreSQL adapter documents the required role in its own module).
 */
export type OutboxRecord = Readonly<{
  event_id: string;
  event_type: string;
  schema_version: string;
  occurred_at: string;
  recorded_at: string;
  producer_id: string;
  producer_version: string;
  workspace_id: string;
  actor_id: string;
  correlation_id: string;
  causation_id: string;
  aggregate_id: string;
  aggregate_sequence: number;
  payload: unknown;
  classification: string;
  integrity_algorithm: string;
  integrity_digest: string;
  attempt_count: number;
}>;

export type ClaimOutboxBatchRequest = Readonly<{
  /** Upper bound on rows claimed in one call; callers SHALL bound worker concurrency. */
  max_batch_size: number;
  /** How long this worker holds an exclusive lease before another worker may reclaim the row. */
  lease_duration_seconds: number;
  /** Attempts at or above this count are dead-lettered instead of reclaimed. */
  max_attempts: number;
}>;

export type OutboxClaim = Readonly<{
  lease_token: string;
  lease_expires_at: string;
  records: readonly OutboxRecord[];
}>;

export type MarkOutboxPublishedRequest = Readonly<{
  lease_token: string;
  event_id: string;
}>;

export type MarkOutboxFailedRequest = Readonly<{
  lease_token: string;
  event_id: string;
  error: string;
  /** Seconds until this event becomes claimable again; ignored once dead-lettered. */
  retry_backoff_seconds: number;
  max_attempts: number;
}>;

export type OutboxOutcome = "published" | "retry_scheduled" | "dead_lettered";

export type OutboxPublisherFailureCode =
  | "invalid_request"
  | "lease_expired"
  | "not_found"
  | "persistence_unavailable";

export type OutboxPublisherResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{
      ok: false;
      failure: Readonly<{ code: OutboxPublisherFailureCode; message: string }>;
    }>;

export interface OutboxPublisher {
  /**
   * Atomically leases up to `max_batch_size` unpublished, unleased-or-
   * lease-expired rows ordered by `(available_at, event_id)` (ADR-012 §7
   * duplicate-delivery avoidance under concurrent workers) and returns them
   * with a single lease token covering the whole batch.
   */
  claimBatch(request: ClaimOutboxBatchRequest): Promise<OutboxPublisherResult<OutboxClaim>>;

  /**
   * Marks one claimed event durably published. Fails with `lease_expired`
   * if this worker's lease on the event was reclaimed by another worker
   * before this call — the caller SHALL treat that as "someone else now
   * owns this event," not retry it under the stale lease.
   */
  markPublished(
    request: MarkOutboxPublishedRequest,
  ): Promise<OutboxPublisherResult<OutboxOutcome>>;

  /**
   * Records a failed publish attempt. Below `max_attempts` the row becomes
   * reclaimable after `retry_backoff_seconds`; at or above `max_attempts`
   * it is dead-lettered (excluded from future claims until an operator
   * intervenes) rather than retried forever.
   */
  markFailed(
    request: MarkOutboxFailedRequest,
  ): Promise<OutboxPublisherResult<OutboxOutcome>>;
}
