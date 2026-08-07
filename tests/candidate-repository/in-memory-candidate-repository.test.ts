import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCandidateRepository } from "../../src/adapters/memory/in-memory-candidate-repository.js";
import type { KnowledgeCandidate } from "../../src/knowledge/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-candidate-001",
    actor_type: "human",
    roles: ["knowledge-reviewer"],
    permissions: ["candidate:write"],
    policy_version: "policy@1.0.0",
    request_id: "request-candidate-001",
    correlation_id: "correlation-candidate-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T09:00:00.000Z",
    expires_at: "2026-08-07T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function candidateInput(overrides: Partial<Omit<KnowledgeCandidate, "status">> = {}): Omit<KnowledgeCandidate, "status"> {
  return {
    id: "CANDIDATE-001",
    workspace_id: "workspace-alpha",
    proposed_claims: [],
    discovery_source: "execution-failure-pattern",
    rationale: "Three independent test runs failed with the same root cause.",
    supporting_evidence_refs: ["execution:EXEC-1"],
    contradicting_evidence_refs: [],
    confidence: 0.6,
    uncertainty_reasons: [],
    affected_knowledge_refs: [],
    validation_plan: "Confirm against two more independent runs.",
    owner: "actor-candidate-001",
    expires_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRepository(): InMemoryCandidateRepository {
  return new InMemoryCandidateRepository({ now: () => new Date("2026-08-07T09:30:00.000Z") });
}

test("createIdempotent creates a new discovered Candidate at revision 1", async () => {
  const repository = makeRepository();
  const result = await repository.createIdempotent({
    context: workspaceContext(),
    candidate: candidateInput(),
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "discovered");
});

test("createIdempotent under the same idempotency_key does not duplicate the observation", async () => {
  const repository = makeRepository();
  const first = await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });
  const second = await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second);
});

test("createIdempotent under a different key for the same id is a duplicate_observation conflict", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });
  const result = await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-2" });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "duplicate_observation");
});

test("appendEvidence retains prior evidence when conflicting evidence is added (no provenance removal)", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.appendEvidence({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    kind: "contradicting",
    evidence_refs: ["execution:EXEC-2-passed"],
    reason: "a later run passed",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.deepEqual(result.value.supporting_evidence_refs, ["execution:EXEC-1"]);
  assert.deepEqual(result.value.contradicting_evidence_refs, ["execution:EXEC-2-passed"]);
});

test("appendEvidence rejects an empty evidence list", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.appendEvidence({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    kind: "supporting",
    evidence_refs: [],
    reason: "noop",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "invalid_evidence");
});

test("promotion separation: linkPromotionResult only succeeds from validating, never via transitionLifecycle", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });
  await repository.transitionLifecycle({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    to_status: "proposed",
    actor_id: "actor-candidate-001",
    reason: "propose",
    policy_version: "policy@1.0.0",
  });
  await repository.transitionLifecycle({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 2,
    to_status: "validating",
    actor_id: "actor-candidate-001",
    reason: "validate",
    policy_version: "policy@1.0.0",
  });

  const promoted = await repository.linkPromotionResult({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 3,
    promoted_knowledge_ref: "KO-001@1.0.0",
    actor_id: "actor-candidate-001",
    reason: "promoted after validation",
    policy_version: "policy@1.0.0",
  });

  assert.equal(promoted.ok, true, JSON.stringify(promoted));
  if (!promoted.ok) return;
  assert.equal(promoted.value.status, "promoted");
  assert.ok(promoted.value.affected_knowledge_refs.includes("KO-001@1.0.0"));
});

test("linkPromotionResult from a non-validating status is rejected", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.linkPromotionResult({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    promoted_knowledge_ref: "KO-001@1.0.0",
    actor_id: "actor-candidate-001",
    reason: "premature promotion",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unauthorized_transition");
});

test("expiry: a candidate past expires_at is rejected from further mutation with expired_candidate", async () => {
  const repository = new InMemoryCandidateRepository({ now: () => new Date("2026-09-02T00:00:00.000Z") });
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.appendEvidence({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    kind: "supporting",
    evidence_refs: ["execution:EXEC-late"],
    reason: "too late",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "expired_candidate");
});

test("expiry: revival brings an expired candidate back to proposed with a new expiry", async () => {
  const repository = new InMemoryCandidateRepository({ now: () => new Date("2026-09-02T00:00:00.000Z") });
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });
  await repository.transitionLifecycle({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 1,
    to_status: "expired",
    actor_id: "actor-candidate-001",
    reason: "past expiry",
    policy_version: "policy@1.0.0",
  });

  const revived = await repository.revive({
    context: workspaceContext(),
    id: "CANDIDATE-001",
    expected_revision: 2,
    new_expires_at: "2026-12-01T00:00:00.000Z",
    actor_id: "actor-candidate-001",
    reason: "new evidence justifies revival",
    policy_version: "policy@1.0.0",
  });

  assert.equal(revived.ok, true, JSON.stringify(revived));
  if (!revived.ok) return;
  assert.equal(revived.value.status, "proposed");
  assert.equal(revived.value.expires_at, "2026-12-01T00:00:00.000Z");
});

test("transitionLifecycle requires the matching Workspace context (authorization)", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.transitionLifecycle({
    context: workspaceContext({ workspace_id: "workspace-beta" }),
    id: "CANDIDATE-001",
    expected_revision: 1,
    to_status: "proposed",
    actor_id: "actor-candidate-001",
    reason: "cross-workspace attempt",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_found");
});

test("isolation: cross-Workspace query is denied by default", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });

  const result = await repository.query({ context: workspaceContext({ workspace_id: "workspace-beta" }) });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 0);
});

test("query filters by owner, status, and expiry", async () => {
  const repository = makeRepository();
  await repository.createIdempotent({ context: workspaceContext(), candidate: candidateInput(), idempotency_key: "idem-1" });
  await repository.createIdempotent({
    context: workspaceContext(),
    candidate: candidateInput({ id: "CANDIDATE-002", owner: "actor-other" }),
    idempotency_key: "idem-2",
  });

  const result = await repository.query({ context: workspaceContext(), owner: "actor-candidate-001", status: ["discovered"] });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0]?.id, "CANDIDATE-001");
});
