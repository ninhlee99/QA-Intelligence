import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteKnowledgeRepository } from "../../src/adapters/sqlite/sqlite-knowledge-repository.js";
import type { KnowledgeObject } from "../../src/knowledge/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

const WORKSPACE_ID = "workspace-sqlite-knowledge-001";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-sqlite-knowledge-001",
    actor_type: "human",
    roles: ["knowledge-editor"],
    permissions: ["knowledge:write"],
    policy_version: "policy@1.0.0",
    request_id: "request-sqlite-knowledge-001",
    correlation_id: "correlation-sqlite-knowledge-001",
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

function draftInput(overrides: Partial<KnowledgeObject> = {}): CreateDraftInput {
  return {
    id: "KO-SQLITE-001",
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
        acquired_by: "actor-sqlite-knowledge-001",
        acquisition_method: "manual_review",
        transformation_history: [],
        workspace_scope: WORKSPACE_ID,
      },
    ],
    authority: "authoritative",
    confidence: 0.9,
    owner: "actor-sqlite-knowledge-001",
    applicability: {},
    relationships: [],
    valid_from: "2026-08-06T09:00:00.000Z",
    valid_until: null,
    ...overrides,
  };
}

async function withDatabase<T>(run: (databasePath: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "qa-intelligence-knowledge-sqlite-"));
  try {
    return await run(join(root, WORKSPACE_ID, "knowledge.sqlite"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function openRepository(databasePath: string): SqliteKnowledgeRepository {
  return new SqliteKnowledgeRepository({
    database_path: databasePath,
    workspace_id: WORKSPACE_ID,
    clock: { now: () => new Date("2026-08-06T09:30:00.000Z") },
  });
}

test("retains and loads a Knowledge Object from a real, user-owned SQLite file", async () => {
  await withDatabase(async (databasePath) => {
    const repository = openRepository(databasePath);
    try {
      const created = await repository.createDraft({
        context: workspaceContext(),
        draft: draftInput(),
        idempotency_key: "idem-sqlite-1",
      });

      assert.equal(created.ok, true, JSON.stringify(created));
      assert.equal((await stat(databasePath)).isFile(), true);

      const loaded = await repository.getExactVersion(workspaceContext(), "KO-SQLITE-001", "0.1.0");
      assert.equal(loaded.ok, true, JSON.stringify(loaded));
      if (!loaded.ok) return;
      assert.equal(loaded.value.status, "draft");
    } finally {
      repository.close();
    }
  });
});

test("survives a real restart: a fresh instance against the same file sees the prior state", async () => {
  await withDatabase(async (databasePath) => {
    const context = workspaceContext();
    const first = openRepository(databasePath);
    await first.createDraft({ context, draft: draftInput(), idempotency_key: "idem-restart-1" });
    await first.submitForReview({ context, id: "KO-SQLITE-001", expected_revision: 1, reason: "ready" });
    first.close();

    // A genuinely new instance, not the same object — proves durability,
    // not just in-process caching.
    const second = openRepository(databasePath);
    try {
      const result = await second.getExactVersion(context, "KO-SQLITE-001", "0.1.0");
      assert.equal(result.ok, true, JSON.stringify(result));
      if (!result.ok) return;
      assert.equal(result.value.status, "in_review");

      const history = await second.listHistory(context, "KO-SQLITE-001");
      assert.equal(history.ok, true);
      if (!history.ok) return;
      assert.equal(history.value.length, 2, "both the draft and in_review revisions must have survived the restart");
    } finally {
      second.close();
    }
  });
});

test("the full lifecycle persists correctly through a real database: draft -> in_review -> accepted -> deprecated -> archived", async () => {
  await withDatabase(async (databasePath) => {
    const repository = openRepository(databasePath);
    try {
      const context = workspaceContext();
      await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-lifecycle-1" });
      await repository.submitForReview({ context, id: "KO-SQLITE-001", expected_revision: 1, reason: "ready" });
      const decided = await repository.recordDecision({
        context,
        id: "KO-SQLITE-001",
        expected_revision: 2,
        decision: "accept",
        actor_id: context.actor_id,
        reason: "approved",
        policy_version: "policy@1.0.0",
      });
      assert.equal(decided.ok, true, JSON.stringify(decided));
      if (!decided.ok) return;
      assert.equal(decided.value.status, "accepted");

      const deprecated = await repository.deprecateOrSupersede({
        context,
        id: "KO-SQLITE-001",
        expected_revision: 3,
        mode: "deprecate",
        actor_id: context.actor_id,
        reason: "superseded",
        policy_version: "policy@1.0.0",
      });
      assert.equal(deprecated.ok, true);

      const archived = await repository.archive({
        context,
        id: "KO-SQLITE-001",
        expected_revision: 4,
        actor_id: context.actor_id,
        reason: "no longer relevant",
        policy_version: "policy@1.0.0",
      });
      assert.equal(archived.ok, true, JSON.stringify(archived));
      if (!archived.ok) return;
      assert.equal(archived.value.status, "archived");

      const events = repository.eventsFor("KO-SQLITE-001");
      assert.deepEqual(
        events.map((event) => event.to_status),
        ["draft", "in_review", "accepted", "deprecated", "archived"],
      );
    } finally {
      repository.close();
    }
  });
});

test("concurrency: a stale expected_revision is rejected as conflict against a real database", async () => {
  await withDatabase(async (databasePath) => {
    const repository = openRepository(databasePath);
    try {
      const context = workspaceContext();
      await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-concurrency-1" });
      await repository.submitForReview({ context, id: "KO-SQLITE-001", expected_revision: 1, reason: "first" });

      const stale = await repository.submitForReview({ context, id: "KO-SQLITE-001", expected_revision: 1, reason: "stale retry" });

      assert.equal(stale.ok, false);
      if (stale.ok) return;
      assert.equal(stale.failure.code, "conflict");
    } finally {
      repository.close();
    }
  });
});

test("createDraft is idempotent under the same idempotency_key against a real database", async () => {
  await withDatabase(async (databasePath) => {
    const repository = openRepository(databasePath);
    try {
      const request = { context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-real-idempotent" };
      const first = await repository.createDraft(request);
      const second = await repository.createDraft(request);

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      assert.deepEqual(first.value, second.value);
    } finally {
      repository.close();
    }
  });
});

test("Workspace isolation: opening the same database with a different Workspace id sees nothing (cross-Workspace fails closed)", async () => {
  await withDatabase(async (databasePath) => {
    const owner = openRepository(databasePath);
    await owner.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-isolation-1" });
    owner.close();

    const otherWorkspaceRepository = new SqliteKnowledgeRepository({
      database_path: databasePath,
      workspace_id: "workspace-sqlite-knowledge-other",
      clock: { now: () => new Date("2026-08-06T09:30:00.000Z") },
    });
    try {
      const result = await otherWorkspaceRepository.getCurrentAccepted(
        workspaceContext({ workspace_id: "workspace-sqlite-knowledge-other" }),
        "KO-SQLITE-001",
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.failure.code, "not_found");
    } finally {
      otherWorkspaceRepository.close();
    }
  });
});

test("query filters correctly against a real database", async () => {
  await withDatabase(async (databasePath) => {
    const repository = openRepository(databasePath);
    try {
      const context = workspaceContext();
      await repository.createDraft({ context, draft: draftInput({ id: "KO-A", type: "pattern" }), idempotency_key: "idem-qa-1" });
      await repository.createDraft({ context, draft: draftInput({ id: "KO-B", type: "rule" }), idempotency_key: "idem-qb-1" });

      const result = await repository.query({ context, type: "pattern", status: ["draft"] });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0]?.id, "KO-A");
    } finally {
      repository.close();
    }
  });
});
