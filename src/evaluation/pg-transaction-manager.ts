import pg from "pg";

import type {
  PostgresQuery,
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionManager,
} from "./postgres-evaluation-campaign-record-store.js";

const { Pool } = pg;

export type PgTransactionManagerDependencies = Readonly<{
  connection_string: string;
  /** Bounds concurrent transactions; ADR-012 requires explicit concurrency limits. */
  max_connections?: number;
  statement_timeout_ms?: number;
}>;

/**
 * Real `pg` driver adapter for the ADR-012/ADR-017 PostgreSQL record-store
 * seam. Every logical operation runs inside one `BEGIN`/`COMMIT`/`ROLLBACK`
 * transaction on one pooled client, so partial writes never become visible
 * and a thrown error always rolls back before the client returns to the pool.
 */
export class PgTransactionManager implements PostgresTransactionManager {
  readonly #pool: InstanceType<typeof Pool>;

  constructor(dependencies: PgTransactionManagerDependencies) {
    this.#pool = new Pool({
      connectionString: dependencies.connection_string,
      max: dependencies.max_connections ?? 10,
      statement_timeout: dependencies.statement_timeout_ms ?? 30_000,
    });
  }

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const transaction: PostgresTransaction = {
        query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> => {
          const result = await client.query(query.text, [...query.values]);
          return { row_count: result.rowCount ?? 0, rows: result.rows as Row[] };
        },
      };
      const value = await operation(transaction);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Closes every pooled connection. Callers SHALL await this during shutdown. */
  async close(): Promise<void> {
    await this.#pool.end();
  }
}
