import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCandidateRepository } from "../../src/adapters/memory/in-memory-candidate-repository.js";
import { evaluateFailureAvoidanceCandidate } from "../../src/memory/failure-avoidance.js";
import { raiseMistakeRecurrenceCandidate } from "../../src/learning-engine/public.js";
import { MistakeRecurrenceTracker, type MistakeOccurrence } from "../../src/learning-engine/mistake-recurrence.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-learning-001",
    actor_type: "service",
    roles: ["learning-engine"],
    permissions: ["candidate:write"],
    policy_version: "policy@1.0.0",
    request_id: "request-learning-001",
    correlation_id: "correlation-learning-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T09:00:00.000Z",
    expires_at: "2026-08-07T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function occurrence(overrides: Partial<MistakeOccurrence> = {}): MistakeOccurrence {
  return {
    workspace_id: "workspace-alpha",
    causal_mistake_key: "missing-header:x-tenant-id",
    trigger: "failed_execution",
    source_ref: "run:RUN-1",
    occurred_at: "2026-08-07T09:00:00.000Z",
    ...overrides,
  };
}

function makeRepository(): InMemoryCandidateRepository {
  return new InMemoryCandidateRepository({ now: () => new Date("2026-08-07T09:30:00.000Z") });
}

test("rejects a non-recurring assessment (fail closed)", async () => {
  const repository = makeRepository();
  const result = await raiseMistakeRecurrenceCandidate(repository, {
    context: workspaceContext(),
    occurrence: occurrence(),
    assessment: { recurring: false },
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    prior_avoidance_fact_refs: [],
    owner: "actor-learning-001",
    expires_at: "2026-09-01T00:00:00.000Z",
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "not_recurring");
});

test("creates a candidate with recurrence evidence in rationale and supporting_evidence_refs", async () => {
  const repository = makeRepository();
  const result = await raiseMistakeRecurrenceCandidate(repository, {
    context: workspaceContext(),
    occurrence: occurrence(),
    assessment: {
      recurring: true,
      occurrence_count: 3,
      affected_runs: ["run:RUN-1", "run:RUN-2", "run:RUN-3"],
      first_observed_at: "2026-08-01T00:00:00.000Z",
    },
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    prior_avoidance_fact_refs: ["avoidance-fact:workspace-alpha:missing-header:x-tenant-id"],
    owner: "actor-learning-001",
    expires_at: "2026-09-01T00:00:00.000Z",
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.discovery_source, "mistake-recurrence");
  assert.match(result.value.rationale, /Observed 3 times/);
  assert.match(result.value.rationale, /run:RUN-1, run:RUN-2, run:RUN-3/);
  assert.ok(result.value.supporting_evidence_refs.includes("avoidance-fact:workspace-alpha:missing-header:x-tenant-id"));
  assert.ok(result.value.supporting_evidence_refs.includes("mistake-recurrence:missing-header:x-tenant-id:count=3"));
  assert.equal(result.value.status, "discovered");
});

test("idempotency: the same idempotency_key does not double-create the candidate", async () => {
  const repository = makeRepository();
  const request = {
    context: workspaceContext(),
    occurrence: occurrence(),
    assessment: {
      recurring: true as const,
      occurrence_count: 2,
      affected_runs: ["run:RUN-1", "run:RUN-2"],
      first_observed_at: "2026-08-01T00:00:00.000Z",
    },
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    prior_avoidance_fact_refs: [],
    owner: "actor-learning-001",
    expires_at: "2026-09-01T00:00:00.000Z",
    idempotency_key: "idem-1",
  };

  const first = await raiseMistakeRecurrenceCandidate(repository, request);
  const second = await raiseMistakeRecurrenceCandidate(repository, request);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second);
});

test("end-to-end: a recurring mistake is distinguished from a one-off, from SessionMemory's decline through to a real candidate", async () => {
  const sessionMemory = new SessionMemory({ now: () => new Date("2026-08-07T09:00:00.000Z") });
  const tracker = new MistakeRecurrenceTracker({ now: () => new Date("2026-08-07T09:30:00.000Z") });
  const repository = makeRepository();

  // First run: a one-off mistake. SPEC-105 §9a says this belongs to
  // SPEC-108 §7.3's avoidance-fact path, not the Learning Engine.
  const firstAssessment = tracker.record(occurrence({ source_ref: "run:RUN-1", occurred_at: "2026-08-01T00:00:00.000Z" }));
  assert.equal(firstAssessment.recurring, false);
  const firstDecision = evaluateFailureAvoidanceCandidate(sessionMemory, {
    workspace_id: "workspace-alpha",
    trigger: "failed_execution",
    causal_mistake_key: "missing-header:x-tenant-id",
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    source_ref: "run:RUN-1",
    consequence_class: "reversible",
    recurring: firstAssessment.recurring,
    ttl_seconds: 3600,
  });
  assert.equal(firstDecision.retained, true);

  // Second run: the same causal mistake recurs. Per §9a, this SHALL NOT
  // be retained as an avoidance fact — it becomes a Learning Engine
  // candidate instead, with the recurrence evidence attached.
  const secondAssessment = tracker.record(occurrence({ source_ref: "run:RUN-2", occurred_at: "2026-08-07T09:00:00.000Z" }));
  assert.equal(secondAssessment.recurring, true);
  const secondDecision = evaluateFailureAvoidanceCandidate(sessionMemory, {
    workspace_id: "workspace-alpha",
    trigger: "failed_execution",
    causal_mistake_key: "missing-header:x-tenant-id",
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    source_ref: "run:RUN-2",
    consequence_class: "reversible",
    recurring: secondAssessment.recurring,
    ttl_seconds: 3600,
  });
  assert.equal(secondDecision.retained, false);
  if (secondDecision.retained) return;
  assert.equal(secondDecision.reason, "requires_learning_engine");

  const candidateResult = await raiseMistakeRecurrenceCandidate(repository, {
    context: workspaceContext(),
    occurrence: occurrence({ source_ref: "run:RUN-2", occurred_at: "2026-08-07T09:00:00.000Z" }),
    assessment: secondAssessment,
    causal_mistake: "The client omits the x-tenant-id header on retry.",
    prior_avoidance_fact_refs: [`avoidance-fact:workspace-alpha:missing-header:x-tenant-id:${firstDecision.retained ? firstDecision.entry.retained_at : ""}`],
    owner: "actor-learning-001",
    expires_at: "2026-09-01T00:00:00.000Z",
    idempotency_key: "idem-recurrence-1",
  });

  assert.equal(candidateResult.ok, true, JSON.stringify(candidateResult));
  if (!candidateResult.ok) return;
  assert.equal(candidateResult.value.discovery_source, "mistake-recurrence");
  assert.match(candidateResult.value.rationale, /Observed 2 times/);
});
