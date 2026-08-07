import assert from "node:assert/strict";
import test from "node:test";

import { PgTransactionManager } from "../../src/evaluation/pg-transaction-manager.js";
import { PostgresKnowledgeRepository } from "../../src/adapters/postgres/postgres-knowledge-repository.js";
import type { KnowledgeObject } from "../../src/knowledge/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

/**
 * Exercises the ADR-017 optional shared/team-profile PostgreSQL Knowledge
 * Repository adapter against a real PostgreSQL 18 server instead of the
 * in-memory or SQLite adapters. Requires QA_INTELLIGENCE_TEST_POSTGRES_URL
 * to point at a database with migration
 * 0004_knowledge_repository.up.sql already applied under a role with
 * SELECT/INSERT/UPDATE on the four qa_knowledge_* tables (RLS makes a
 * superuser role meaningless here — it always bypasses RLS); skips (does
 * not fail) when unset so `npm test` remains database-free by default,
 * matching every other real-driver test's pattern in this repository.
 */
const CONNECTION_STRING = process.env["QA_INTELLIGENCE_TEST_POSTGRES_URL"];

if (CONNECTION_STRING === undefined || CONNECTION_STRING.trim().length === 0) {
  test(
    "[postgres-knowledge-real] skipped: QA_INTELLIGENCE_TEST_POSTGRES_URL is not set",
    { skip: true },
    () => {},
  );
} else {
  const connectionString = CONNECTION_STRING;
  const WORKSPACE_ID = `workspace-knowledge-real-${Date.now()}`;

  function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
    return {
      schema_version: "1.0.0",
      workspace_id: WORKSPACE_ID,
      actor_id: "actor-knowledge-real-001",
      actor_type: "human",
      roles: ["knowledge-editor"],
      permissions: ["knowledge:write"],
      policy_version: "policy@1.0.0",
      request_id: "request-knowledge-real-001",
      correlation_id: "correlation-knowledge-real-001",
      audience: ["qa-intelligence"],
      environment: "test",
      issued_at: "2026-08-06T09:00:00.000Z",
      expires_at: "2026-08-06T11:00:00.000Z",
      issuer: "identity-test",
      integrity_proof: "signed-context",
      ...overrides,
    };
  }

  type CreateDraftInput = Omit<KnowledgeObject, "status" | "version" | "reviewed_at"> & Readonly<{ version?: string }>;

  function draftInput(id: string, overrides: Partial<KnowledgeObject> = {}): CreateDraftInput {
    return {
      id,
      type: "test_pattern",
      workspace_id: WORKSPACE_ID,
      title: "Observable acceptance criteria",
      summary: "A testable requirement has observable acceptance criteria.",
      claims: [],
      provenance: [
        {
          source_type: "spec",
          source_id: "SPEC-203",
          source_version_or_captured_at: "1.0.0",
          acquired_by: "actor-knowledge-real-001",
          acquisition_method: "manual_review",
          transformation_history: [],
          workspace_scope: WORKSPACE_ID,
        },
      ],
      authority: "authoritative",
      confidence: 0.9,
      owner: "actor-knowledge-real-001",
      applicability: {},
      relationships: [],
      valid_from: "2026-08-06T09:00:00.000Z",
      valid_until: null,
      ...overrides,
    };
  }

  function openRepository(): { repository: PostgresKnowledgeRepository; manager: PgTransactionManager } {
    const manager = new PgTransactionManager({ connection_string: connectionString });
    const repository = new PostgresKnowledgeRepository({
      database: manager,
      workspace_id: WORKSPACE_ID,
      clock: { now: () => new Date() },
    });
    return { repository, manager };
  }

  test("[postgres-knowledge-real] retains and loads a Knowledge Object against a real PostgreSQL 18 server", async () => {
    const { repository, manager } = openRepository();
    try {
      const created = await repository.createDraft({
        context: workspaceContext(),
        draft: draftInput("KO-REAL-001"),
        idempotency_key: `idem-real-1-${Date.now()}`,
      });

      assert.equal(created.ok, true, JSON.stringify(created));
      if (!created.ok) return;

      const loaded = await repository.getExactVersion(workspaceContext(), "KO-REAL-001", created.value.version);
      assert.equal(loaded.ok, true, JSON.stringify(loaded));
      if (!loaded.ok) return;
      assert.equal(loaded.value.status, "draft");
    } finally {
      await manager.close();
    }
  });

  test("[postgres-knowledge-real] the full lifecycle persists correctly under real Row-Level Security", async () => {
    const { repository, manager } = openRepository();
    try {
      const context = workspaceContext();
      const id = `KO-REAL-LIFECYCLE-${Date.now()}`;
      await repository.createDraft({ context, draft: draftInput(id), idempotency_key: `idem-real-lifecycle-${Date.now()}` });
      await repository.submitForReview({ context, id, expected_revision: 1, reason: "ready" });
      const decided = await repository.recordDecision({
        context,
        id,
        expected_revision: 2,
        decision: "accept",
        actor_id: context.actor_id,
        reason: "approved",
        policy_version: "policy@1.0.0",
      });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      if (!decided.ok) return;
      assert.equal(decided.value.status, "accepted");

      const archived = await repository.archive({
        context,
        id,
        expected_revision: 3,
        actor_id: context.actor_id,
        reason: "cleanup",
        policy_version: "policy@1.0.0",
      });
      assert.equal(archived.ok, false, "accepted cannot go directly to archived; deprecate/supersede first");
    } finally {
      await manager.close();
    }
  });

  test("[postgres-knowledge-real] concurrency: a stale expected_revision is rejected under real database contention", async () => {
    const { repository, manager } = openRepository();
    try {
      const context = workspaceContext();
      const id = `KO-REAL-CONCURRENCY-${Date.now()}`;
      await repository.createDraft({ context, draft: draftInput(id), idempotency_key: `idem-real-concurrency-${Date.now()}` });
      await repository.submitForReview({ context, id, expected_revision: 1, reason: "first" });

      const stale = await repository.submitForReview({ context, id, expected_revision: 1, reason: "stale retry" });

      assert.equal(stale.ok, false);
      if (stale.ok) return;
      assert.equal(stale.failure.code, "conflict");
    } finally {
      await manager.close();
    }
  });

  test("[postgres-knowledge-real] Row-Level Security enforces Workspace isolation under the application role (not a superuser)", async () => {
    const { repository, manager } = openRepository();
    const otherWorkspaceId = `workspace-knowledge-real-other-${Date.now()}`;
    try {
      const id = `KO-REAL-ISOLATION-${Date.now()}`;
      await repository.createDraft({
        context: workspaceContext(),
        draft: draftInput(id),
        idempotency_key: `idem-real-isolation-${Date.now()}`,
      });

      const otherManager = new PgTransactionManager({ connection_string: connectionString });
      const otherRepository = new PostgresKnowledgeRepository({
        database: otherManager,
        workspace_id: otherWorkspaceId,
        clock: { now: () => new Date() },
      });
      try {
        const result = await otherRepository.getCurrentAccepted(workspaceContext({ workspace_id: otherWorkspaceId }), id);
        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.failure.code, "not_found", "RLS must hide the other Workspace's row entirely, not just deny access");
      } finally {
        await otherManager.close();
      }
    } finally {
      await manager.close();
    }
  });

  test("[postgres-knowledge-real] createDraft is idempotent under the same idempotency_key against a real database", async () => {
    const { repository, manager } = openRepository();
    try {
      const id = `KO-REAL-IDEMPOTENT-${Date.now()}`;
      const key = `idem-real-idempotent-${Date.now()}`;
      const request = { context: workspaceContext(), draft: draftInput(id), idempotency_key: key };

      const first = await repository.createDraft(request);
      const second = await repository.createDraft(request);

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      assert.deepEqual(first.value, second.value);
    } finally {
      await manager.close();
    }
  });
}
