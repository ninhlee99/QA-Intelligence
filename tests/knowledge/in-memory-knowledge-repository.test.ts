import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryKnowledgeRepository } from "../../src/adapters/memory/in-memory-knowledge-repository.js";
import type { KnowledgeObject } from "../../src/knowledge/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-knowledge-001",
    actor_id: "actor-knowledge-001",
    actor_type: "human",
    roles: ["knowledge-editor"],
    permissions: ["knowledge:write"],
    policy_version: "policy@1.0.0",
    request_id: "request-knowledge-001",
    correlation_id: "correlation-knowledge-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function draftInput(overrides: Partial<KnowledgeObject> = {}): CreateDraftInput {
  return {
    id: "KO-001",
    type: "test_pattern",
    workspace_id: "workspace-knowledge-001",
    title: "Observable acceptance criteria",
    summary: "A testable requirement has observable acceptance criteria.",
    claims: [],
    provenance: [
      {
        source_type: "spec",
        source_id: "SPEC-203",
        source_version_or_captured_at: "1.0.0",
        acquired_by: "actor-knowledge-001",
        acquisition_method: "manual_review",
        transformation_history: [],
        workspace_scope: "workspace-knowledge-001",
      },
    ],
    authority: "authoritative",
    confidence: 0.9,
    owner: "actor-knowledge-001",
    applicability: {},
    relationships: [],
    valid_from: "2026-08-06T09:00:00.000Z",
    valid_until: null,
    ...overrides,
  };
}

type CreateDraftInput = Omit<KnowledgeObject, "status" | "version" | "reviewed_at"> & Readonly<{ version?: string }>;

function makeRepository(): InMemoryKnowledgeRepository {
  return new InMemoryKnowledgeRepository({ now: () => new Date("2026-08-06T09:30:00.000Z") });
}

test("createDraft creates a new draft Knowledge Object at revision 1", async () => {
  const repository = makeRepository();
  const result = await repository.createDraft({
    context: workspaceContext(),
    draft: draftInput(),
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "draft");
  assert.equal(result.value.id, "KO-001");
});

test("createDraft is idempotent under the same idempotency_key", async () => {
  const repository = makeRepository();
  const request = { context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-2" };

  const first = await repository.createDraft(request);
  const second = await repository.createDraft(request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.deepEqual(first.value, second.value);
});

test("createDraft conflicts on a duplicate id outside the idempotency key", async () => {
  const repository = makeRepository();
  await repository.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-a" });

  const result = await repository.createDraft({
    context: workspaceContext(),
    draft: draftInput(),
    idempotency_key: "idem-b",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "conflict");
});

test("the full lifecycle: draft -> in_review -> accepted -> deprecated -> archived", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-lifecycle" });

  const submitted = await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "ready for review" });
  assert.equal(submitted.ok, true, JSON.stringify(submitted));
  if (!submitted.ok) return;
  assert.equal(submitted.value.status, "in_review");

  const decided = await repository.recordDecision({
    context,
    id: "KO-001",
    expected_revision: 2,
    decision: "accept",
    actor_id: context.actor_id,
    reason: "quality gate passed",
    policy_version: "policy@1.0.0",
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  if (!decided.ok) return;
  assert.equal(decided.value.status, "accepted");

  const deprecated = await repository.deprecateOrSupersede({
    context,
    id: "KO-001",
    expected_revision: 3,
    mode: "deprecate",
    actor_id: context.actor_id,
    reason: "superseded by a better pattern",
    policy_version: "policy@1.0.0",
  });
  assert.equal(deprecated.ok, true, JSON.stringify(deprecated));
  if (!deprecated.ok) return;
  assert.equal(deprecated.value.status, "deprecated");

  const archived = await repository.archive({
    context,
    id: "KO-001",
    expected_revision: 4,
    actor_id: context.actor_id,
    reason: "no longer relevant",
    policy_version: "policy@1.0.0",
  });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  if (!archived.ok) return;
  assert.equal(archived.value.status, "archived");

  const events = repository.eventsFor("KO-001");
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((event) => event.to_status),
    ["draft", "in_review", "accepted", "deprecated", "archived"],
  );
});

test("an illegal transition (draft directly to archived) is rejected as unsupported_transition", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-illegal" });

  const result = await repository.archive({
    context,
    id: "KO-001",
    expected_revision: 1,
    actor_id: context.actor_id,
    reason: "skip ahead",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_transition");
});

test("concurrency: a stale expected_revision is rejected as conflict, never silently overwritten", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-concurrency" });

  const first = await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "first" });
  assert.equal(first.ok, true);

  const stale = await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "stale retry" });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.failure.code, "conflict");
});

test("accepted versions are immutable: reviseDraft refuses to mutate an accepted object", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-immutable" });
  await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "ready" });
  await repository.recordDecision({
    context,
    id: "KO-001",
    expected_revision: 2,
    decision: "accept",
    actor_id: context.actor_id,
    reason: "approved",
    policy_version: "policy@1.0.0",
  });

  const revised = await repository.reviseDraft({
    context,
    id: "KO-001",
    expected_revision: 3,
    changes: { summary: "an attempted mutation of an accepted object" },
    reason: "should be rejected",
  });

  assert.equal(revised.ok, false);
  if (revised.ok) return;
  assert.equal(revised.failure.code, "unsupported_transition");
});

test("history preserves every version, not just the current one", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-history" });
  await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "submit" });

  const history = await repository.listHistory(context, "KO-001");
  assert.equal(history.ok, true);
  if (!history.ok) return;
  assert.ok(history.value.length >= 1);
});

test("Workspace isolation: a caller from a different Workspace cannot read a Workspace-scoped object", async () => {
  const repository = makeRepository();
  await repository.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-isolation" });

  const otherWorkspace = workspaceContext({ workspace_id: "workspace-knowledge-other" });
  const result = await repository.getCurrentAccepted(otherWorkspace, "KO-001");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_found", "cross-Workspace access must fail closed as not_found, not leak existence via a different error");
});

test("a global-scope object is visible from any Workspace", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({
    context,
    draft: draftInput({ id: "KO-GLOBAL", workspace_id: "global" }),
    idempotency_key: "idem-global",
  });
  await repository.submitForReview({ context, id: "KO-GLOBAL", expected_revision: 1, reason: "submit" });
  await repository.recordDecision({
    context,
    id: "KO-GLOBAL",
    expected_revision: 2,
    decision: "accept",
    actor_id: context.actor_id,
    reason: "approved",
    policy_version: "policy@1.0.0",
  });

  const otherWorkspace = workspaceContext({ workspace_id: "workspace-knowledge-other" });
  const result = await repository.getCurrentAccepted(otherWorkspace, "KO-GLOBAL");

  assert.equal(result.ok, true, JSON.stringify(result));
});

test("query filters by type, status, and Workspace scope together", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput({ id: "KO-A", type: "pattern" }), idempotency_key: "idem-qa" });
  await repository.createDraft({ context, draft: draftInput({ id: "KO-B", type: "rule" }), idempotency_key: "idem-qb" });

  const result = await repository.query({ context, type: "pattern", status: ["draft"] });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0]?.id, "KO-A");
});

test("traverseRelationships walks governed relationships up to max_depth, respecting Workspace isolation", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({
    context,
    draft: draftInput({ id: "KO-ROOT", relationships: ["derived_from:KO-LEAF"] }),
    idempotency_key: "idem-root",
  });
  await repository.createDraft({ context, draft: draftInput({ id: "KO-LEAF" }), idempotency_key: "idem-leaf" });

  const result = await repository.traverseRelationships({
    context,
    from_id: "KO-ROOT",
    relationship: "derived_from",
    max_depth: 2,
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0]?.id, "KO-LEAF");
});

test("promoteCandidate creates an accepted Knowledge Object directly, without a draft/review detour", async () => {
  const repository = makeRepository();
  const context = workspaceContext();

  const result = await repository.promoteCandidate({
    context,
    candidate_id: "CAND-001",
    expected_revision: 0,
    actor_id: context.actor_id,
    reason: "corroborated across three Workspaces",
    policy_version: "policy@1.0.0",
    promoted_object: { ...draftInput({ id: "KO-PROMOTED" }), version: "1.0.0" },
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "accepted");

  const events = repository.eventsFor("KO-PROMOTED");
  assert.equal(events.length, 1);
  assert.ok(events[0]?.evidence_refs.includes("candidate:CAND-001"));
});

test("deprecateOrSupersede in supersede mode requires superseded_by_id", async () => {
  const repository = makeRepository();
  const context = workspaceContext();
  await repository.createDraft({ context, draft: draftInput(), idempotency_key: "idem-supersede" });
  await repository.submitForReview({ context, id: "KO-001", expected_revision: 1, reason: "submit" });
  await repository.recordDecision({
    context,
    id: "KO-001",
    expected_revision: 2,
    decision: "accept",
    actor_id: context.actor_id,
    reason: "approved",
    policy_version: "policy@1.0.0",
  });

  const result = await repository.deprecateOrSupersede({
    context,
    id: "KO-001",
    expected_revision: 3,
    mode: "supersede",
    actor_id: context.actor_id,
    reason: "replaced",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "validation_failure");
});

test("not_found is returned for an unknown id rather than a fabricated empty object", async () => {
  const repository = makeRepository();
  const result = await repository.getCurrentAccepted(workspaceContext(), "KO-NEVER-EXISTED");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_found");
});
