BEGIN;

ALTER TABLE qa_platform_outbox
  ADD COLUMN dead_lettered_at timestamptz;

-- A dead-lettered event is a distinct terminal state from "in flight" and
-- "published": SPEC-505 §7 requires dead-letter handling be explicit rather
-- than retried forever, and ADR-012 §7 requires atomicity/duplicate-delivery
-- tests to cover it.
ALTER TABLE qa_platform_outbox
  ADD CONSTRAINT qa_platform_outbox_terminal_state_exclusive
  CHECK (published_at IS NULL OR dead_lettered_at IS NULL);

DROP INDEX IF EXISTS qa_platform_outbox_publishable;
CREATE INDEX qa_platform_outbox_publishable
  ON qa_platform_outbox (available_at, event_id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

COMMENT ON COLUMN qa_platform_outbox.dead_lettered_at IS
  'Set once attempt_count reaches the worker''s max_attempts; excluded from future claims until an operator intervenes.';

-- The outbox worker is a platform-level publisher, not a Workspace-scoped
-- caller: it claims and publishes events across every Workspace in one
-- pass, so its role SHALL see the whole table rather than one
-- current_setting('qa.workspace_id') at a time. This role must be created
-- separately by an operator (CREATE ROLE qa_intelligence_outbox_worker
-- LOGIN ...); the policy below only takes effect once that role exists and
-- is granted table privileges on qa_platform_outbox.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_intelligence_outbox_worker') THEN
    EXECUTE 'CREATE POLICY qa_platform_outbox_worker_full_access
      ON qa_platform_outbox
      TO qa_intelligence_outbox_worker
      USING (true)
      WITH CHECK (true)';
  END IF;
END
$$;

COMMIT;
