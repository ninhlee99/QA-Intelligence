import type {
  PostgresQuery,
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionManager,
} from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";

export type FakeOutboxRow = {
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
  available_at: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  published_at: string | null;
  last_error: string | null;
  dead_lettered_at: string | null;
};

/**
 * In-process fake of the qa_platform_outbox table, executing the same named
 * queries PostgresOutboxPublisher issues. Unlike
 * FakePostgresTransactionManager (the producer-side campaign fake), this
 * fake intentionally never enforces a Workspace RLS scope: the outbox
 * worker is a platform-level publisher across every Workspace by design
 * (see PostgresOutboxPublisher's module docstring), so its queries carry no
 * `workspace_scope_set` call to check against.
 */
export class FakePostgresOutboxTransactionManager implements PostgresTransactionManager {
  #outbox = new Map<string, FakeOutboxRow>();

  /** Test-only seam to seed a row as if a producer's transaction had already committed it. */
  seed(row: FakeOutboxRow): void {
    this.#outbox.set(row.event_id, { ...row });
  }

  get(eventId: string): FakeOutboxRow | undefined {
    const row = this.#outbox.get(eventId);
    return row === undefined ? undefined : { ...row };
  }

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    const staged = new Map(this.#outbox);
    const value = await operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> =>
        this.#execute(staged, query) as PostgresQueryResult<Row>,
    });
    this.#outbox = staged;
    return value;
  }

  #execute(staged: Map<string, FakeOutboxRow>, query: PostgresQuery): PostgresQueryResult<unknown> {
    switch (query.name) {
      case "outbox_claimable_select": {
        const [limit] = query.values as [number];
        const now = new Date().toISOString();
        const rows = [...staged.values()]
          .filter(
            (row) =>
              row.published_at === null &&
              row.dead_lettered_at === null &&
              row.available_at <= now &&
              (row.lease_expires_at === null || row.lease_expires_at <= now),
          )
          .sort((a, b) =>
            a.available_at === b.available_at
              ? a.event_id.localeCompare(b.event_id)
              : a.available_at.localeCompare(b.available_at),
          )
          .slice(0, limit);
        return { row_count: rows.length, rows: rows.map((row) => ({ event_id: row.event_id })) };
      }
      case "outbox_claim_lease": {
        const [leaseToken, leaseExpiresAt, eventIds] = query.values as [string, string, string[]];
        const leased: FakeOutboxRow[] = [];
        for (const eventId of eventIds) {
          const row = staged.get(eventId);
          if (row === undefined) continue;
          const updated: FakeOutboxRow = { ...row, lease_token: leaseToken, lease_expires_at: leaseExpiresAt };
          staged.set(eventId, updated);
          leased.push(updated);
        }
        return { row_count: leased.length, rows: leased };
      }
      case "outbox_load_leased": {
        const [eventId, leaseToken] = query.values as [string, string];
        const row = staged.get(eventId);
        return row !== undefined && row.lease_token === leaseToken
          ? { row_count: 1, rows: [row] }
          : { row_count: 0, rows: [] };
      }
      case "outbox_exists": {
        const [eventId] = query.values as [string];
        const row = staged.get(eventId);
        return row === undefined
          ? { row_count: 0, rows: [] }
          : { row_count: 1, rows: [{ event_id: row.event_id }] };
      }
      case "outbox_mark_published": {
        const [eventId] = query.values as [string];
        const row = staged.get(eventId);
        if (row === undefined) return { row_count: 0, rows: [] };
        staged.set(eventId, {
          ...row,
          published_at: new Date().toISOString(),
          lease_token: null,
          lease_expires_at: null,
        });
        return { row_count: 1, rows: [] };
      }
      case "outbox_mark_dead_lettered": {
        const [eventId, attemptCount, error] = query.values as [string, number, string];
        const row = staged.get(eventId);
        if (row === undefined) return { row_count: 0, rows: [] };
        staged.set(eventId, {
          ...row,
          attempt_count: attemptCount,
          last_error: error,
          dead_lettered_at: new Date().toISOString(),
          lease_token: null,
          lease_expires_at: null,
        });
        return { row_count: 1, rows: [] };
      }
      case "outbox_mark_retry": {
        const [eventId, attemptCount, error, backoffSeconds] = query.values as [
          string,
          number,
          string,
          number,
        ];
        const row = staged.get(eventId);
        if (row === undefined) return { row_count: 0, rows: [] };
        staged.set(eventId, {
          ...row,
          attempt_count: attemptCount,
          last_error: error,
          available_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          lease_token: null,
          lease_expires_at: null,
        });
        return { row_count: 1, rows: [] };
      }
      default:
        throw new Error(`Unsupported fake outbox Postgres query: ${query.name}`);
    }
  }
}
