BEGIN;

DROP TABLE IF EXISTS qa_platform_outbox;
DROP TABLE IF EXISTS qa_evaluation_campaign_commands;
DROP TABLE IF EXISTS qa_evaluation_campaign_events;
DROP TABLE IF EXISTS qa_evaluation_campaigns;

COMMIT;
