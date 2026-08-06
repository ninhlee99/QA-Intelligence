import { randomUUID } from "node:crypto";

import type {
  PostgresTransaction,
  PostgresTransactionManager,
} from "./postgres-evaluation-campaign-record-store.js";
import type {
  ClaimOutboxBatchRequest,
  MarkOutboxFailedRequest,
  MarkOutboxPublishedRequest,
  OutboxClaim,
  OutboxOutcome,
  OutboxPublisher,
  OutboxPublisherResult,
  OutboxRecord,
} from "./outbox-publisher.js";

export type PostgresOutboxPublisherDependencies = Readonly<{
  database: PostgresTransactionManager;
}>;

/**
 * PostgreSQL worker adapter (ADR-012/ADR-017 shared/team profile) for the
 * SPEC-505 §7 outbox consumer half. Runs as a platform-level publisher
 * across every Workspace in one pass, so its database identity SHALL be the
 * dedicated `qa_intelligence_outbox_worker` role migration
 * 0003_outbox_dead_letter grants a table-wide RLS policy to — NOT a
 * Workspace-scoped application role, and NOT a superuser (which would
 * bypass RLS for reasons unrelated to this adapter's design). Claiming uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers partition the claimable
 * set instead of blocking or double-claiming the same row (ADR-012 §7
 * concurrent work-claim requirement).
 */
export class PostgresOutboxPublisher implements OutboxPublisher {
  readonly #database: PostgresTransactionManager;

  constructor(dependencies: PostgresOutboxPublisherDependencies) {
    this.#database = dependencies.database;
  }

  async claimBatch(
    request: ClaimOutboxBatchRequest,
  ): Promise<OutboxPublisherResult<OutboxClaim>> {
    const invalid = validateClaimRequest(request);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const leaseToken = randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(
      now.getTime() + request.lease_duration_seconds * 1000,
    ).toISOString();

    try {
      return await this.#database.transaction(async (transaction) => {
        const claimable = await transaction.query<PostgresOutboxRow>({
          name: "outbox_claimable_select",
          text: `
            SELECT event_id FROM qa_platform_outbox
             WHERE published_at IS NULL
               AND dead_lettered_at IS NULL
               AND available_at <= now()
               AND (lease_expires_at IS NULL OR lease_expires_at <= now())
             ORDER BY available_at ASC, event_id ASC
             LIMIT $1
               FOR UPDATE SKIP LOCKED
          `,
          values: [request.max_batch_size],
        });
        if (claimable.rows.length === 0) {
          return succeeded<OutboxClaim>({
            lease_token: leaseToken,
            lease_expires_at: leaseExpiresAt,
            records: [],
          });
        }
        const eventIds = claimable.rows.map((row) => row.event_id);
        const leased = await transaction.query<PostgresOutboxRow>({
          name: "outbox_claim_lease",
          text: `
            UPDATE qa_platform_outbox
               SET lease_token = $1, lease_expires_at = $2::timestamptz
             WHERE event_id = ANY($3::text[])
            RETURNING *
          `,
          values: [leaseToken, leaseExpiresAt, eventIds],
        });
        return succeeded<OutboxClaim>({
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          records: leased.rows.map(toOutboxRecord),
        });
      });
    } catch {
      return failed("persistence_unavailable", "The outbox claim transaction could not be committed.");
    }
  }

  async markPublished(
    request: MarkOutboxPublishedRequest,
  ): Promise<OutboxPublisherResult<OutboxOutcome>> {
    const invalid = validateLeaseRequest(request);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    try {
      return await this.#database.transaction(async (transaction) => {
        const row = await this.#loadLeased(transaction, request.event_id, request.lease_token);
        if (row === undefined) return await this.#leaseFailure(transaction, request.event_id);
        await transaction.query({
          name: "outbox_mark_published",
          text: `
            UPDATE qa_platform_outbox
               SET published_at = now(), lease_token = NULL, lease_expires_at = NULL
             WHERE event_id = $1
          `,
          values: [request.event_id],
        });
        return succeeded<OutboxOutcome>("published");
      });
    } catch {
      return failed("persistence_unavailable", "The outbox publish transaction could not be committed.");
    }
  }

  async markFailed(
    request: MarkOutboxFailedRequest,
  ): Promise<OutboxPublisherResult<OutboxOutcome>> {
    const invalid = validateFailRequest(request);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    try {
      return await this.#database.transaction(async (transaction) => {
        const row = await this.#loadLeased(transaction, request.event_id, request.lease_token);
        if (row === undefined) return await this.#leaseFailure(transaction, request.event_id);
        const nextAttempts = row.attempt_count + 1;
        if (nextAttempts >= request.max_attempts) {
          await transaction.query({
            name: "outbox_mark_dead_lettered",
            text: `
              UPDATE qa_platform_outbox
                 SET attempt_count = $2, last_error = $3, dead_lettered_at = now(),
                     lease_token = NULL, lease_expires_at = NULL
               WHERE event_id = $1
            `,
            values: [request.event_id, nextAttempts, request.error],
          });
          return succeeded<OutboxOutcome>("dead_lettered");
        }
        await transaction.query({
          name: "outbox_mark_retry",
          text: `
            UPDATE qa_platform_outbox
               SET attempt_count = $2, last_error = $3,
                   available_at = now() + make_interval(secs => $4),
                   lease_token = NULL, lease_expires_at = NULL
             WHERE event_id = $1
          `,
          values: [request.event_id, nextAttempts, request.error, request.retry_backoff_seconds],
        });
        return succeeded<OutboxOutcome>("retry_scheduled");
      });
    } catch {
      return failed("persistence_unavailable", "The outbox failure transaction could not be committed.");
    }
  }

  async #loadLeased(
    transaction: PostgresTransaction,
    eventId: string,
    leaseToken: string,
  ): Promise<PostgresOutboxRow | undefined> {
    const loaded = await transaction.query<PostgresOutboxRow>({
      name: "outbox_load_leased",
      text: `SELECT * FROM qa_platform_outbox WHERE event_id = $1 AND lease_token = $2`,
      values: [eventId, leaseToken],
    });
    return loaded.rows[0];
  }

  async #leaseFailure(
    transaction: PostgresTransaction,
    eventId: string,
  ): Promise<OutboxPublisherResult<OutboxOutcome>> {
    const exists = await transaction.query<{ event_id: string }>({
      name: "outbox_exists",
      text: `SELECT event_id FROM qa_platform_outbox WHERE event_id = $1`,
      values: [eventId],
    });
    return exists.rows.length === 0
      ? failed("not_found", "The outbox event was not found.")
      : failed("lease_expired", "This worker no longer holds the lease for this outbox event.");
  }
}

type PostgresOutboxRow = Readonly<{
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

function toOutboxRecord(row: PostgresOutboxRow): OutboxRecord {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    occurred_at: row.occurred_at,
    recorded_at: row.recorded_at,
    producer_id: row.producer_id,
    producer_version: row.producer_version,
    workspace_id: row.workspace_id,
    actor_id: row.actor_id,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    aggregate_id: row.aggregate_id,
    aggregate_sequence: row.aggregate_sequence,
    payload: row.payload,
    classification: row.classification,
    integrity_algorithm: row.integrity_algorithm,
    integrity_digest: row.integrity_digest,
    attempt_count: row.attempt_count,
  };
}

function validateClaimRequest(request: ClaimOutboxBatchRequest): string | undefined {
  if (
    !Number.isInteger(request.max_batch_size) ||
    request.max_batch_size < 1 ||
    !Number.isInteger(request.lease_duration_seconds) ||
    request.lease_duration_seconds < 1 ||
    !Number.isInteger(request.max_attempts) ||
    request.max_attempts < 1
  ) {
    return "max_batch_size, lease_duration_seconds, and max_attempts must be positive integers.";
  }
  return undefined;
}

function validateLeaseRequest(
  request: Readonly<{ lease_token: string; event_id: string }>,
): string | undefined {
  if (request.lease_token.trim().length === 0 || request.event_id.trim().length === 0) {
    return "A lease token and event identity are required.";
  }
  return undefined;
}

function validateFailRequest(request: MarkOutboxFailedRequest): string | undefined {
  const base = validateLeaseRequest(request);
  if (base !== undefined) return base;
  if (
    !Number.isInteger(request.retry_backoff_seconds) ||
    request.retry_backoff_seconds < 0 ||
    !Number.isInteger(request.max_attempts) ||
    request.max_attempts < 1
  ) {
    return "retry_backoff_seconds and max_attempts must be non-negative integers.";
  }
  return undefined;
}

function succeeded<Value>(value: Value): OutboxPublisherResult<Value> {
  return { ok: true, value };
}

function failed<Value>(
  code: "invalid_request" | "lease_expired" | "not_found" | "persistence_unavailable",
  message: string,
): OutboxPublisherResult<Value> {
  return { ok: false, failure: { code, message } };
}
