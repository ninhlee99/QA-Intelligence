BEGIN;

DROP POLICY IF EXISTS qa_platform_outbox_worker_full_access ON qa_platform_outbox;

DROP INDEX IF EXISTS qa_platform_outbox_publishable;
CREATE INDEX qa_platform_outbox_publishable
  ON qa_platform_outbox (available_at, event_id)
  WHERE published_at IS NULL;

ALTER TABLE qa_platform_outbox
  DROP CONSTRAINT IF EXISTS qa_platform_outbox_terminal_state_exclusive;

ALTER TABLE qa_platform_outbox
  DROP COLUMN IF EXISTS dead_lettered_at;

COMMIT;
