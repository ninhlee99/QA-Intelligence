import type {
  PostgresQuery,
  PostgresQueryResult,
  PostgresTransaction,
  PostgresTransactionManager,
} from "../../src/evaluation/postgres-evaluation-campaign-record-store.js";

type RunRow = Readonly<{
  workspace_id: string;
  run_id: string;
  revision: number;
  state: string;
  record: unknown;
  started_at: string;
  updated_at: string;
}>;

type CommandRow = Readonly<{
  workspace_id: string;
  run_id: string;
  command_kind: string;
  idempotency_key: string;
  request_digest: string;
  result: unknown;
  retained_at: string;
}>;

/**
 * In-process fake of the SPEC-410 §5 PostgreSQL Agent Run schema, executing
 * the same named queries PostgresAgentRunRecordStore issues (INSERT ON
 * CONFLICT DO NOTHING / UPDATE WHERE revision = / SELECT) against in-memory
 * tables. Mirrors tests/evaluation/fake-postgres-transaction-manager.ts for
 * the Agent Run aggregate, which carries no outbox intent.
 */
export class FakePostgresTransactionManager implements PostgresTransactionManager {
  #runs = new Map<string, RunRow>();
  #commands = new Map<string, CommandRow>();

  async transaction<Value>(
    operation: (transaction: PostgresTransaction) => Promise<Value>,
  ): Promise<Value> {
    const staged = {
      runs: new Map(this.#runs),
      commands: new Map(this.#commands),
      workspaceScope: undefined as string | undefined,
    };
    const value = await operation({
      query: async <Row>(query: PostgresQuery): Promise<PostgresQueryResult<Row>> =>
        this.#execute(staged, query) as PostgresQueryResult<Row>,
    });
    this.#runs = staged.runs;
    this.#commands = staged.commands;
    return value;
  }

  #execute(
    staged: {
      runs: Map<string, RunRow>;
      commands: Map<string, CommandRow>;
      workspaceScope: string | undefined;
    },
    query: PostgresQuery,
  ): PostgresQueryResult<unknown> {
    switch (query.name) {
      case "workspace_scope_set": {
        const [workspaceId] = query.values as [string];
        staged.workspaceScope = workspaceId;
        return { row_count: 1, rows: [] };
      }
      case "run_command_load": {
        const [workspaceId, runId, commandKind, idempotencyKey] = query.values as [
          string,
          string,
          string,
          string,
        ];
        this.#requireScope(staged, workspaceId);
        const row = staged.commands.get(
          commandKey(workspaceId, runId, commandKind, idempotencyKey),
        );
        return row === undefined ? { row_count: 0, rows: [] } : { row_count: 1, rows: [row] };
      }
      case "run_create": {
        const [workspaceId, runId, revision, state, record, startedAt, updatedAt] =
          query.values as [string, string, number, string, string, string, string];
        this.#requireScope(staged, workspaceId);
        const key = runKey(workspaceId, runId);
        if (staged.runs.has(key)) return { row_count: 0, rows: [] };
        const row: RunRow = {
          workspace_id: workspaceId,
          run_id: runId,
          revision,
          state,
          record: JSON.parse(record),
          started_at: startedAt,
          updated_at: updatedAt,
        };
        staged.runs.set(key, row);
        return { row_count: 1, rows: [{ record: row.record }] };
      }
      case "run_update": {
        const [workspaceId, runId, revision, state, record, updatedAt, expectedRevision] =
          query.values as [string, string, number, string, string, string, number];
        this.#requireScope(staged, workspaceId);
        const key = runKey(workspaceId, runId);
        const current = staged.runs.get(key);
        if (current === undefined || current.revision !== expectedRevision) {
          return { row_count: 0, rows: [] };
        }
        const row: RunRow = {
          ...current,
          revision,
          state,
          record: JSON.parse(record),
          updated_at: updatedAt,
        };
        staged.runs.set(key, row);
        return { row_count: 1, rows: [{ record: row.record }] };
      }
      case "run_load": {
        const [workspaceId, runId] = query.values as [string, string];
        this.#requireScope(staged, workspaceId);
        const row = staged.runs.get(runKey(workspaceId, runId));
        return row === undefined
          ? { row_count: 0, rows: [] }
          : { row_count: 1, rows: [{ record: row.record }] };
      }
      case "run_event_append":
        return { row_count: 1, rows: [{}] };
      case "run_command_retain": {
        const [workspaceId, runId, commandKind, idempotencyKey, requestDigest, result, retainedAt] =
          query.values as [string, string, string, string, string, string, string];
        this.#requireScope(staged, workspaceId);
        const key = commandKey(workspaceId, runId, commandKind, idempotencyKey);
        if (staged.commands.has(key)) return { row_count: 0, rows: [] };
        staged.commands.set(key, {
          workspace_id: workspaceId,
          run_id: runId,
          command_kind: commandKind,
          idempotency_key: idempotencyKey,
          request_digest: requestDigest,
          result: JSON.parse(result),
          retained_at: retainedAt,
        });
        return { row_count: 1, rows: [{ idempotency_key: idempotencyKey }] };
      }
      default:
        throw new Error(`Unsupported fake Postgres query: ${query.name}`);
    }
  }

  /**
   * Mirrors PostgreSQL RLS (`USING (workspace_id = current_setting('qa.workspace_id'))`):
   * every row-touching statement is confined to the transaction's scoped
   * Workspace, so a record from another Workspace is invisible/unwritable
   * even though nothing in the adapter's own TypeScript checks for it.
   */
  #requireScope(
    staged: { workspaceScope: string | undefined },
    workspaceId: string,
  ): void {
    if (staged.workspaceScope !== workspaceId) {
      throw new Error("row-level security policy violation");
    }
  }
}

function runKey(workspaceId: string, runId: string): string {
  return `${workspaceId} ${runId}`;
}

function commandKey(
  workspaceId: string,
  runId: string,
  commandKind: string,
  idempotencyKey: string,
): string {
  return [workspaceId, runId, commandKind, idempotencyKey].join(" ");
}
