import assert from "node:assert/strict";
import test from "node:test";

import { WorkingMemoryKnowledgeSearch } from "../../src/memory/working-memory.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
import { reportMemoryObservability } from "../../src/memory/observability.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from "../../src/requirement-review/public.js";

const WORKSPACE = "workspace-memory-001";

function clockAt(iso: string): { now(): Date } {
  return { now: () => new Date(iso) };
}

class StubKnowledgeSearch implements KnowledgeSearch {
  search(_request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    return Promise.resolve({
      ok: true,
      value: {
        hits: [],
        knowledge_snapshot: "1.0.0",
        projection_freshness: "current",
        warnings: [],
      },
    });
  }
}

function searchRequest(query: string): KnowledgeSearchRequest {
  return {
    operation_id: `operation-${query}`,
    context: {
      schema_version: "1.0.0",
      workspace_id: WORKSPACE,
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["requirement-reviewer"],
      permissions: ["knowledge:read"],
      policy_version: "policy-3",
      request_id: "request-1",
      correlation_id: "correlation-1",
      audience: ["qa-intelligence"],
      environment: "test",
      issued_at: "2026-08-05T07:00:00.000Z",
      expires_at: "2026-08-05T09:00:00.000Z",
      issuer: "identity-test",
      integrity_proof: "signed-test-context",
    },
    query,
    scopes: ["requirement"],
    authority_statuses: ["accepted"],
    applicability: { workspace_id: WORKSPACE },
    limit: 5,
    knowledge_snapshot: "1.0.0",
  };
}

test("reports zero hit rate when Working Memory has not been used yet", () => {
  const workingMemory = new WorkingMemoryKnowledgeSearch(new StubKnowledgeSearch());
  const sessionMemory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const report = reportMemoryObservability(WORKSPACE, workingMemory, sessionMemory);

  assert.deepEqual(report.working_memory, { hits: 0, misses: 0, hit_rate: 0 });
  assert.equal(report.session_memory.live_entry_count, 0);
});

test("aggregates Working Memory hit rate and Session Memory promotion/decline counts", async () => {
  const workingMemory = new WorkingMemoryKnowledgeSearch(new StubKnowledgeSearch());
  const sessionMemory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  await workingMemory.search(searchRequest("same query"));
  await workingMemory.search(searchRequest("same query"));
  await workingMemory.search(searchRequest("different query"));

  sessionMemory.evaluate({
    workspace_id: WORKSPACE,
    key: "selector:a",
    value: "#a",
    source_ref: "run://run-1/step-1",
    consequence_class: "advisory",
    reuse_likely: true,
    ttl_seconds: 3600,
  });
  sessionMemory.evaluate({
    workspace_id: WORKSPACE,
    key: "selector:b",
    value: "#b",
    source_ref: "run://run-1/step-2",
    consequence_class: "high_consequence",
    reuse_likely: true,
    ttl_seconds: 3600,
  });

  const report = reportMemoryObservability(WORKSPACE, workingMemory, sessionMemory);

  assert.deepEqual(report.working_memory, { hits: 1, misses: 2, hit_rate: 1 / 3 });
  assert.equal(report.session_memory.promotions, 1);
  assert.equal(report.session_memory.live_entry_count, 1);
  assert.equal(report.session_memory.declines_by_reason.consequence_too_high, 1);
});

test("counts expiry and async-rejection separately from live promotions", () => {
  const clock = { now: () => new Date("2026-08-05T10:00:00.000Z") };
  const sessionMemory = new SessionMemory(clock);
  const workingMemory = new WorkingMemoryKnowledgeSearch(new StubKnowledgeSearch());

  sessionMemory.evaluate({
    workspace_id: WORKSPACE,
    key: "selector:expiring",
    value: "#expiring",
    source_ref: "run://run-1/step-1",
    consequence_class: "advisory",
    reuse_likely: true,
    ttl_seconds: 60,
  });
  sessionMemory.evaluate({
    workspace_id: WORKSPACE,
    key: "selector:rejected",
    value: "#rejected",
    source_ref: "run://run-1/step-2",
    consequence_class: "advisory",
    reuse_likely: true,
    ttl_seconds: 3600,
  });
  sessionMemory.reject(WORKSPACE, "selector:rejected");

  clock.now = () => new Date("2026-08-05T10:05:00.000Z");
  assert.equal(sessionMemory.get(WORKSPACE, "selector:expiring"), undefined);

  const report = reportMemoryObservability(WORKSPACE, workingMemory, sessionMemory);

  assert.equal(report.session_memory.promotions, 2);
  assert.equal(report.session_memory.expiries, 1);
  assert.equal(report.session_memory.async_rejections, 1);
  assert.equal(report.session_memory.live_entry_count, 0);
});
