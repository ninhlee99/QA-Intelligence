BEGIN;

CREATE TABLE qa_evaluation_campaigns (
  workspace_id text NOT NULL CHECK (workspace_id <> ''),
  campaign_id text NOT NULL CHECK (campaign_id <> ''),
  revision bigint NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN (
    'draft', 'validating', 'ready', 'running', 'analyzing',
    'awaiting_review', 'approved', 'conditionally_approved', 'rejected',
    'indeterminate', 'blocked', 'cancelled', 'failed'
  )),
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL CHECK (updated_at >= created_at),
  PRIMARY KEY (workspace_id, campaign_id)
);

CREATE TABLE qa_evaluation_campaign_events (
  workspace_id text NOT NULL,
  campaign_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, campaign_id, sequence),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES qa_evaluation_campaigns (workspace_id, campaign_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX qa_evaluation_campaign_events_revision
  ON qa_evaluation_campaign_events (workspace_id, campaign_id, revision);

CREATE TABLE qa_evaluation_campaign_commands (
  workspace_id text NOT NULL,
  campaign_id text NOT NULL,
  command_kind text NOT NULL CHECK (command_kind IN (
    'create', 'transition', 'trial_boundary', 'recovery'
  )),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  request_digest text NOT NULL CHECK (request_digest <> ''),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  retained_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, campaign_id, command_kind, idempotency_key),
  FOREIGN KEY (workspace_id, campaign_id)
    REFERENCES qa_evaluation_campaigns (workspace_id, campaign_id)
    ON DELETE RESTRICT
);

CREATE TABLE qa_platform_outbox (
  event_id text PRIMARY KEY CHECK (event_id <> ''),
  event_type text NOT NULL CHECK (event_type <> ''),
  schema_version text NOT NULL CHECK (schema_version <> ''),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  producer_id text NOT NULL CHECK (producer_id <> ''),
  producer_version text NOT NULL CHECK (producer_version <> ''),
  workspace_id text NOT NULL CHECK (workspace_id <> ''),
  actor_id text NOT NULL CHECK (actor_id <> ''),
  correlation_id text NOT NULL CHECK (correlation_id <> ''),
  causation_id text NOT NULL CHECK (causation_id <> ''),
  aggregate_id text NOT NULL CHECK (aggregate_id <> ''),
  aggregate_sequence bigint NOT NULL CHECK (aggregate_sequence > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  classification text NOT NULL CHECK (classification <> ''),
  integrity_algorithm text NOT NULL CHECK (integrity_algorithm <> ''),
  integrity_digest text NOT NULL CHECK (integrity_digest <> ''),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  lease_token text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  last_error text,
  CHECK (
    (lease_token IS NULL AND lease_expires_at IS NULL) OR
    (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX qa_platform_outbox_publishable
  ON qa_platform_outbox (available_at, event_id)
  WHERE published_at IS NULL;

CREATE INDEX qa_platform_outbox_aggregate_order
  ON qa_platform_outbox (workspace_id, aggregate_id, aggregate_sequence);

ALTER TABLE qa_evaluation_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_evaluation_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_evaluation_campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_evaluation_campaign_events FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_evaluation_campaign_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_evaluation_campaign_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE qa_platform_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_platform_outbox FORCE ROW LEVEL SECURITY;

CREATE POLICY qa_evaluation_campaigns_workspace_scope
  ON qa_evaluation_campaigns
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_evaluation_campaign_events_workspace_scope
  ON qa_evaluation_campaign_events
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_evaluation_campaign_commands_workspace_scope
  ON qa_evaluation_campaign_commands
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

CREATE POLICY qa_platform_outbox_workspace_scope
  ON qa_platform_outbox
  USING (workspace_id = nullif(current_setting('qa.workspace_id', true), ''))
  WITH CHECK (workspace_id = nullif(current_setting('qa.workspace_id', true), ''));

COMMENT ON TABLE qa_evaluation_campaigns IS
  'ADR-012 system-of-record snapshots; authoritative semantics remain in SPEC-607.';
COMMENT ON TABLE qa_platform_outbox IS
  'SPEC-505 publication intents committed atomically with aggregate mutations.';

COMMIT;
