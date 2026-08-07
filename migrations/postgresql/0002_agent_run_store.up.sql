BEGIN;

CREATE TABLE qa_agent_runs (
  workspace_id text NOT NULL CHECK (workspace_id <> ''),
  run_id text NOT NULL CHECK (run_id <> ''),
  revision bigint NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN (
    'requested', 'resolving', 'awaiting_authorization', 'ready', 'running',
    'awaiting_approval', 'suspended', 'validating', 'completed', 'failed',
    'cancelled', 'timed_out', 'blocked'
  )),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= started_at),
  PRIMARY KEY (workspace_id, run_id)
);

CREATE TABLE qa_agent_run_events (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, sequence),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES qa_agent_runs (workspace_id, run_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX qa_agent_run_events_revision
  ON qa_agent_run_events (workspace_id, run_id, revision);

CREATE TABLE qa_agent_run_commands (
  workspace_id text NOT NULL,
  run_id text NOT NULL,
  command_kind text NOT NULL CHECK (command_kind IN (
    'start', 'authorize', 'execute', 'approve', 'resume', 'cancel'
  )),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_digest text NOT NULL CHECK (request_digest <> ''),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  retained_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, run_id, command_kind, idempotency_key),
  FOREIGN KEY (workspace_id, run_id)
    REFERENCES qa_agent_runs (workspace_id, run_id)
    ON DELETE RESTRICT
);

ALTER TABLE qa_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_agent_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_agent_run_events FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_agent_run_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_agent_run_commands FORCE ROW LEVEL SECURITY;

CREATE POLICY qa_agent_runs_workspace_scope
  ON qa_agent_runs
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_agent_run_events_workspace_scope
  ON qa_agent_run_events
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_agent_run_commands_workspace_scope
  ON qa_agent_run_commands
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

COMMENT ON TABLE qa_agent_runs IS
  'SPEC-410 §5 system-of-record Agent Run snapshots; authoritative semantics remain in SPEC-508.';

COMMIT;
