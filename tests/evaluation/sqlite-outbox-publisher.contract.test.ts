import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SqliteOutboxPublisher } from "../../src/evaluation/sqlite-outbox-publisher.js";

import { runOutboxPublisherContract } from "./outbox-publisher-contract.js";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS qa_platform_outbox (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    producer_version TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    causation_id TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_sequence INTEGER NOT NULL,
    payload TEXT NOT NULL,
    classification TEXT NOT NULL,
    integrity_algorithm TEXT NOT NULL,
    integrity_digest TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    lease_token TEXT,
    lease_expires_at TEXT,
    published_at TEXT,
    last_error TEXT
  );
`;

let sequence = 0;
let databasePath: string;

runOutboxPublisherContract("sqlite", {
  async makePublisher() {
    sequence += 1;
    const root = await mkdtemp(join(tmpdir(), "qa-intelligence-outbox-sqlite-contract-"));
    databasePath = join(root, `${sequence}`, "qa-intelligence.sqlite");
    await mkdir(dirname(databasePath), { recursive: true });
    // Seed the pre-existing qa_platform_outbox schema (as
    // SqliteEvaluationCampaignRecordStore would have created it) so
    // SqliteOutboxPublisher's own migration step (adding
    // dead_lettered_at) runs against a realistic starting shape.
    const seedDb = new DatabaseSync(databasePath);
    seedDb.exec(SCHEMA);
    seedDb.close();
    return new SqliteOutboxPublisher({ database_path: databasePath });
  },
  seed(_publisher, row) {
    const db = new DatabaseSync(databasePath);
    try {
      db.prepare(
        `INSERT INTO qa_platform_outbox
           (event_id, event_type, schema_version, occurred_at, recorded_at,
            producer_id, producer_version, workspace_id, actor_id,
            correlation_id, causation_id, aggregate_id, aggregate_sequence,
            payload, classification, integrity_algorithm, integrity_digest,
            attempt_count, available_at, lease_token, lease_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.event_id,
        "evaluation.campaign.created",
        "1.0.0",
        "2026-08-06T10:00:00.000Z",
        "2026-08-06T10:00:00.000Z",
        "qa-intelligence-contract",
        "0.1.0",
        row.workspace_id ?? "workspace-outbox-contract-001",
        "evaluation-runner-contract-001",
        row.event_id,
        row.event_id,
        "campaign-outbox-contract-001",
        1,
        JSON.stringify({ fixture: true }),
        "internal",
        "sha256",
        "sha256:fixture-digest",
        0,
        row.available_at ?? "2020-01-01T00:00:00.000Z",
        row.lease_token ?? null,
        row.lease_expires_at ?? null,
      );
    } finally {
      db.close();
    }
  },
  closePublisher(publisher) {
    (publisher as SqliteOutboxPublisher).close();
  },
});
