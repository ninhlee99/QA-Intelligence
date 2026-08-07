import { PostgresOutboxPublisher } from "../../src/evaluation/postgres-outbox-publisher.js";

import { FakePostgresOutboxTransactionManager } from "./fake-postgres-outbox-transaction-manager.js";
import { runOutboxPublisherContract } from "./outbox-publisher-contract.js";

let manager: FakePostgresOutboxTransactionManager;

runOutboxPublisherContract("postgres", {
  makePublisher() {
    manager = new FakePostgresOutboxTransactionManager();
    return new PostgresOutboxPublisher({ database: manager });
  },
  seed(_publisher, row) {
    manager.seed({
      event_id: row.event_id,
      event_type: "evaluation.campaign.created",
      schema_version: "1.0.0",
      occurred_at: "2026-08-06T10:00:00.000Z",
      recorded_at: "2026-08-06T10:00:00.000Z",
      producer_id: "qa-intelligence-contract",
      producer_version: "0.1.0",
      workspace_id: row.workspace_id ?? "workspace-outbox-contract-001",
      actor_id: "evaluation-runner-contract-001",
      correlation_id: row.event_id,
      causation_id: row.event_id,
      aggregate_id: "campaign-outbox-contract-001",
      aggregate_sequence: 1,
      payload: { fixture: true },
      classification: "internal",
      integrity_algorithm: "sha256",
      integrity_digest: "sha256:fixture-digest",
      attempt_count: 0,
      available_at: row.available_at ?? "2020-01-01T00:00:00.000Z",
      lease_token: row.lease_token ?? null,
      lease_expires_at: row.lease_expires_at ?? null,
      published_at: null,
      last_error: null,
      dead_lettered_at: null,
    });
  },
});
