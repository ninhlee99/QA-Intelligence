import assert from "node:assert/strict";
import test from "node:test";

import { WorkingMemoryKnowledgeSearch } from "../../src/memory/working-memory.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-memory-001",
    actor_id: "reviewer-001",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["knowledge:read"],
    policy_version: "test-policy-0.1.0",
    request_id: "request-001",
    correlation_id: "correlation-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-03T07:00:00.000Z",
    expires_at: "2026-08-03T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "valid-test-signature",
  };
}

function request(overrides: Partial<KnowledgeSearchRequest> = {}): KnowledgeSearchRequest {
  return {
    operation_id: "knowledge-search-001",
    context: context(),
    query: "observable acceptance criteria",
    scopes: ["requirements"],
    authority_statuses: ["accepted"],
    applicability: { capability_id: "requirement-review" },
    limit: 10,
    knowledge_snapshot: "workspace-memory-001@0.1.0",
    ...overrides,
  };
}

function countingKnowledgeSearch(result: KnowledgeSearchResult): Readonly<{
  search: KnowledgeSearch;
  calls(): number;
}> {
  let calls = 0;
  return {
    search: {
      async search(): Promise<KnowledgeSearchResult> {
        calls += 1;
        return result;
      },
    },
    calls: () => calls,
  };
}

const OK_RESULT: KnowledgeSearchResult = {
  ok: true,
  value: {
    hits: [
      {
        knowledge_ref: "KO-observable@1.0.0",
        title: "Observable outcomes",
        excerpt: "A testable requirement has observable acceptance criteria.",
        authority_status: "accepted",
        provenance: ["SPEC-203"],
        evidence: ["knowledge-evidence:KO-observable@1.0.0"],
        relevance: 0.9,
      },
    ],
    knowledge_snapshot: "workspace-memory-001@0.1.0",
    projection_freshness: "current",
    warnings: [],
  },
};

test("reuses a prior result within a run when durable references are unchanged (AP-064)", async () => {
  const inner = countingKnowledgeSearch(OK_RESULT);
  const memory = new WorkingMemoryKnowledgeSearch(inner.search);

  const first = await memory.search(request());
  const second = await memory.search(request({ operation_id: "knowledge-search-002" }));

  assert.deepEqual(first, OK_RESULT);
  assert.deepEqual(second, OK_RESULT);
  assert.equal(inner.calls(), 1, "the second call with unchanged durable references should not re-query");
  assert.deepEqual(memory.reuseStats(), { hits: 1, misses: 1 });
});

test("re-resolves when a durable reference changes (SPEC-309 §4)", async () => {
  const inner = countingKnowledgeSearch(OK_RESULT);
  const memory = new WorkingMemoryKnowledgeSearch(inner.search);

  await memory.search(request());
  await memory.search(request({ knowledge_snapshot: "workspace-memory-001@0.2.0" }));

  assert.equal(inner.calls(), 2, "a changed Knowledge Store snapshot must force re-resolution");
  assert.deepEqual(memory.reuseStats(), { hits: 0, misses: 2 });
});

test("re-resolves when the query text changes even with the same scope", async () => {
  const inner = countingKnowledgeSearch(OK_RESULT);
  const memory = new WorkingMemoryKnowledgeSearch(inner.search);

  await memory.search(request({ query: "observable acceptance criteria" }));
  await memory.search(request({ query: "authoritative source" }));

  assert.equal(inner.calls(), 2);
});

test("does not reuse across different Workspaces even with an identical query", async () => {
  const inner = countingKnowledgeSearch(OK_RESULT);
  const memory = new WorkingMemoryKnowledgeSearch(inner.search);

  await memory.search(request());
  await memory.search(
    request({ context: { ...context(), workspace_id: "workspace-memory-002" } }),
  );

  assert.equal(inner.calls(), 2, "Working Memory SHALL be Workspace-scoped (SPEC-108 §4.1)");
});

test("clear() forces the next call to re-resolve", async () => {
  const inner = countingKnowledgeSearch(OK_RESULT);
  const memory = new WorkingMemoryKnowledgeSearch(inner.search);

  await memory.search(request());
  memory.clear();
  await memory.search(request());

  assert.equal(inner.calls(), 2);
});
