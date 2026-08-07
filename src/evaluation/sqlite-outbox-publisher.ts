import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export type SqliteOutboxPublisherDependencies = Readonly<{
  /** Same SQLite file SqliteEvaluationCampaignRecordStore opened for this Workspace. */
  database_path: string;
}>;

/**
 * Local-first SQLite worker adapter (ADR-017) for the SPEC-505 §7 outbox
 * consumer half: claims (leases), publishes, and retries/dead-letters rows
 * `SqliteEvaluationCampaignRecordStore` already wrote transactionally into
 * `qa_platform_outbox`. A single-process local Workspace has no concurrent
 * worker to race, so claiming here only needs to be atomic against this
 * same process's own concurrent calls, not a distributed lease — `BEGIN
 * IMMEDIATE` gives that within one file.
 */
export class SqliteOutboxPublisher implements OutboxPublisher {
  readonly #database: DatabaseSync;

  constructor(dependencies: SqliteOutboxPublisherDependencies) {
    mkdirSync(dirname(dependencies.database_path), { recursive: true });
    this.#database = new DatabaseSync(dependencies.database_path);
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#database.exec("PRAGMA busy_timeout = 5000");
    this.#ensureDeadLetterColumn();
  }

  close(): void {
    this.#database.close();
  }

  #ensureDeadLetterColumn(): void {
    const columns = this.#database
      .prepare("PRAGMA table_info(qa_platform_outbox)")
      .all() as unknown as ReadonlyArray<{ name: string }>;
    if (columns.length === 0) return; // Table not created yet by the record store; nothing to migrate.
    if (!columns.some((column) => column.name === "dead_lettered_at")) {
      this.#database.exec("ALTER TABLE qa_platform_outbox ADD COLUMN dead_lettered_at TEXT");
    }
  }

  async claimBatch(
    request: ClaimOutboxBatchRequest,
  ): Promise<OutboxPublisherResult<OutboxClaim>> {
    const invalid = validateClaimRequest(request);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const leaseToken = randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + request.lease_duration_seconds * 1000,
    ).toISOString();

    try {
      return this.#transaction(() => {
        const rows = this.#database
          .prepare(
            `SELECT * FROM qa_platform_outbox
              WHERE published_at IS NULL
                AND dead_lettered_at IS NULL
                AND available_at <= ?
                AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
              ORDER BY available_at ASC, event_id ASC
              LIMIT ?`,
          )
          .all(nowIso, nowIso, request.max_batch_size) as unknown as ReadonlyArray<SqliteOutboxRow>;

        for (const row of rows) {
          this.#database
            .prepare(
              `UPDATE qa_platform_outbox
                  SET lease_token = ?, lease_expires_at = ?
                WHERE event_id = ?`,
            )
            .run(leaseToken, leaseExpiresAt, row.event_id);
        }

        return succeeded({
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          records: rows.map(toOutboxRecord),
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
      return this.#transaction(() => {
        const row = this.#loadLeased(request.event_id, request.lease_token);
        if (row === undefined) return this.#leaseFailure(request.event_id);
        this.#database
          .prepare(
            `UPDATE qa_platform_outbox
                SET published_at = ?, lease_token = NULL, lease_expires_at = NULL
              WHERE event_id = ?`,
          )
          .run(new Date().toISOString(), request.event_id);
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
      return this.#transaction(() => {
        const row = this.#loadLeased(request.event_id, request.lease_token);
        if (row === undefined) return this.#leaseFailure(request.event_id);
        const nextAttempts = row.attempt_count + 1;
        if (nextAttempts >= request.max_attempts) {
          this.#database
            .prepare(
              `UPDATE qa_platform_outbox
                  SET attempt_count = ?, last_error = ?, dead_lettered_at = ?,
                      lease_token = NULL, lease_expires_at = NULL
                WHERE event_id = ?`,
            )
            .run(nextAttempts, request.error, new Date().toISOString(), request.event_id);
          return succeeded<OutboxOutcome>("dead_lettered");
        }
        const availableAt = new Date(
          Date.now() + request.retry_backoff_seconds * 1000,
        ).toISOString();
        this.#database
          .prepare(
            `UPDATE qa_platform_outbox
                SET attempt_count = ?, last_error = ?, available_at = ?,
                    lease_token = NULL, lease_expires_at = NULL
              WHERE event_id = ?`,
          )
          .run(nextAttempts, request.error, availableAt, request.event_id);
        return succeeded<OutboxOutcome>("retry_scheduled");
      });
    } catch {
      return failed("persistence_unavailable", "The outbox failure transaction could not be committed.");
    }
  }

  #loadLeased(eventId: string, leaseToken: string): SqliteOutboxRow | undefined {
    return this.#database
      .prepare(`SELECT * FROM qa_platform_outbox WHERE event_id = ? AND lease_token = ?`)
      .get(eventId, leaseToken) as unknown as SqliteOutboxRow | undefined;
  }

  #leaseFailure(eventId: string): OutboxPublisherResult<OutboxOutcome> {
    const exists = this.#database
      .prepare(`SELECT event_id FROM qa_platform_outbox WHERE event_id = ?`)
      .get(eventId);
    return exists === undefined
      ? failed("not_found", "The outbox event was not found.")
      : failed("lease_expired", "This worker no longer holds the lease for this outbox event.");
  }

  #transaction<Value>(operation: () => Value): Value {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

type SqliteOutboxRow = Readonly<{
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
  payload: string;
  classification: string;
  integrity_algorithm: string;
  integrity_digest: string;
  attempt_count: number;
}>;

function toOutboxRecord(row: SqliteOutboxRow): OutboxRecord {
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
    payload: JSON.parse(row.payload),
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
