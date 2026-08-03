import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryKnowledgeSearch,
  type InMemoryKnowledgeRecord,
} from "../../src/adapters/memory/knowledge-search.js";
import type {
  KnowledgeSearchRequest,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

const WORKSPACE = "workspace-evaluation-001";
const SNAPSHOT = "workspace-evaluation-001@0.1.0";

function context(
  workspaceId: string = WORKSPACE,
): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
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

function request(
  overrides: Partial<KnowledgeSearchRequest> = {},
): KnowledgeSearchRequest {
  return {
    operation_id: "knowledge-search-001",
    context: context(),
    query: "observable acceptance criteria",
    scopes: ["requirements"],
    authority_statuses: ["accepted"],
    applicability: { capability_id: "requirement-review" },
    limit: 10,
    knowledge_snapshot: SNAPSHOT,
    ...overrides,
  };
}

function record(
  overrides: Partial<InMemoryKnowledgeRecord> = {},
): InMemoryKnowledgeRecord {
  return {
    workspace_id: WORKSPACE,
    knowledge_snapshot: SNAPSHOT,
    knowledge_ref: "KO-observable@1.0.0",
    title: "Observable outcomes",
    excerpt: "A testable requirement has observable acceptance criteria.",
    authority_status: "accepted",
    scopes: ["requirements"],
    applicability: { capability_id: "requirement-review" },
    provenance: ["SPEC-203"],
    evidence: ["knowledge-evidence:KO-observable@1.0.0"],
    ...overrides,
  };
}

function search(
  records: readonly InMemoryKnowledgeRecord[],
  availability: "available" | "unavailable" = "available",
): InMemoryKnowledgeSearch {
  return new InMemoryKnowledgeSearch({
    workspace_id: WORKSPACE,
    knowledge_snapshot: SNAPSHOT,
    projection_freshness: "current",
    availability,
    records,
  });
}

test("resolves and returns only the exact requested snapshot version", async () => {
  const result = await search([
    record(),
    record({
      knowledge_snapshot: "workspace-evaluation-001@0.0.9",
      knowledge_ref: "KO-old@0.0.9",
    }),
  ]).search(request());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.knowledge_snapshot, SNAPSHOT);
    assert.deepEqual(
      result.value.hits.map((hit) => hit.knowledge_ref),
      ["KO-observable@1.0.0"],
    );
    assert.equal(result.value.projection_freshness, "current");
  }
});

test("orders deterministically by relevance then knowledge reference and applies limit", async () => {
  const result = await search([
    record({
      knowledge_ref: "KO-zulu@1.0.0",
      title: "Observable acceptance criteria",
    }),
    record({
      knowledge_ref: "KO-alpha@1.0.0",
      title: "Observable acceptance criteria",
    }),
    record({
      knowledge_ref: "KO-lower@1.0.0",
      title: "Observable outcome",
      excerpt: "An observable outcome can be tested.",
    }),
  ]).search(request({ limit: 2 }));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      result.value.hits.map((hit) => hit.knowledge_ref),
      ["KO-alpha@1.0.0", "KO-zulu@1.0.0"],
    );
    assert.equal(result.value.hits.length, 2);
  }
});

test("rejects limits outside the inclusive 1 to 100 contract", async () => {
  for (const limit of [0, 101, 1.5]) {
    const result = await search([record()]).search(request({ limit }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.code, "invalid");
    }
  }
});

test("returns accepted authority only and retains provenance and evidence", async () => {
  const result = await search([
    record(),
    record({
      knowledge_ref: "KO-draft@1.0.0",
      authority_status: "draft",
    }),
  ]).search(request({ authority_statuses: ["accepted", "draft"] }));

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.hits, [
      {
        knowledge_ref: "KO-observable@1.0.0",
        title: "Observable outcomes",
        excerpt: "A testable requirement has observable acceptance criteria.",
        authority_status: "accepted",
        provenance: ["SPEC-203"],
        evidence: ["knowledge-evidence:KO-observable@1.0.0"],
        relevance: 1,
      },
    ]);
  }
});

test("fails integrity validation rather than returning accepted knowledge without provenance", async () => {
  const result = await search([
    record({ provenance: [] }),
  ]).search(request());

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "integrity_failure");
    assert.equal(result.failure.retryable, false);
    assert.equal(JSON.stringify(result).includes("observable acceptance"), false);
  }
});

test("denies cross-workspace access without exposing records or snapshot data", async () => {
  const adapter = search([record()]);
  const result = await adapter.search(
    request({ context: context("workspace-other") }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "forbidden",
      message: "Knowledge snapshot is outside the authorized Workspace.",
      retryable: false,
      evidence: [
        "knowledge-search:deny",
        "operation:knowledge-search-001",
        "reason:workspace-mismatch",
      ],
    },
  });
  assert.equal(JSON.stringify(result).includes("KO-observable"), false);
  assert.equal(JSON.stringify(result).includes(SNAPSHOT), false);

  const conflictingApplicability = await adapter.search(
    request({ applicability: { workspace_id: "workspace-other" } }),
  );
  assert.equal(conflictingApplicability.ok, false);
  if (!conflictingApplicability.ok) {
    assert.equal(conflictingApplicability.failure.code, "forbidden");
  }
});

test("distinguishes a stale snapshot from adapter unavailability", async () => {
  const stale = await search([record()]).search(
    request({ knowledge_snapshot: "workspace-evaluation-001@0.0.9" }),
  );
  const unavailable = await search([record()], "unavailable").search(request());

  assert.equal(stale.ok, false);
  assert.equal(unavailable.ok, false);
  if (!stale.ok && !unavailable.ok) {
    assert.equal(stale.failure.code, "stale_projection");
    assert.equal(stale.failure.retryable, true);
    assert.equal(unavailable.failure.code, "unavailable");
    assert.equal(unavailable.failure.retryable, true);
  }
});
