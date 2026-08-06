BEGIN;

CREATE TABLE qa_knowledge_objects (
  workspace_id text NOT NULL CHECK (workspace_id <> ''),
  id text NOT NULL CHECK (id <> ''),
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN (
    'draft', 'in_review', 'accepted', 'deprecated', 'superseded', 'archived'
  )),
  object jsonb NOT NULL CHECK (jsonb_typeof(object) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE qa_knowledge_history (
  workspace_id text NOT NULL,
  id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  version text NOT NULL CHECK (version <> ''),
  object jsonb NOT NULL CHECK (jsonb_typeof(object) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id, revision),
  FOREIGN KEY (workspace_id, id)
    REFERENCES qa_knowledge_objects (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE qa_knowledge_lifecycle_events (
  workspace_id text NOT NULL,
  id text NOT NULL,
  event_id text NOT NULL CHECK (event_id <> ''),
  revision bigint NOT NULL CHECK (revision > 0),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, id, event_id),
  FOREIGN KEY (workspace_id, id)
    REFERENCES qa_knowledge_objects (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE qa_knowledge_idempotency (
  workspace_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, idempotency_key)
);

ALTER TABLE qa_knowledge_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_history FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_lifecycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_knowledge_idempotency FORCE ROW LEVEL SECURITY;

CREATE POLICY qa_knowledge_objects_workspace_scope
  ON qa_knowledge_objects
  USING (
    workspace_id = nullif(current_setting('qa.workspace_id', true), '')
    OR workspace_id = 'global'
  )
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_knowledge_history_workspace_scope
  ON qa_knowledge_history
  USING (
    workspace_id = nullif(current_setting('qa.workspace_id', true), '')
    OR workspace_id = 'global'
  )
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_knowledge_lifecycle_events_workspace_scope
  ON qa_knowledge_lifecycle_events
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_knowledge_idempotency_workspace_scope
  ON qa_knowledge_idempotency
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

COMMENT ON TABLE qa_knowledge_objects IS
  'SPEC-401/SPEC-103 system-of-record Knowledge Object state; authoritative lifecycle semantics remain in SPEC-102.';

COMMIT;
