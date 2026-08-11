import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SessionMemory } from "../../src/memory/session-memory.js";
import { MistakeRecurrenceTracker } from "../../src/learning-engine/mistake-recurrence.js";
import { FileBackedCandidateRepository } from "../../src/adapters/memory/file-backed-candidate-repository.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

class FixedClock {
  constructor(private iso: string) {}
  now(): Date {
    return new Date(this.iso);
  }
}

function workspaceContext(workspaceId: string): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    actor_id: "actor-1",
    actor_type: "service",
    roles: ["qa"],
    permissions: [],
    policy_version: "policy@1.0.0",
    request_id: "r1",
    correlation_id: "c1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-11T00:00:00.000Z",
    expires_at: "2026-08-12T00:00:00.000Z",
    issuer: "test",
    integrity_proof: "proof",
  };
}

test("SessionMemory avoid:* survives restart via persistRootDir", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-avoid-"));
  try {
    const clock = new FixedClock("2026-08-11T12:00:00.000Z");
    const first = new SessionMemory(clock, { persistRootDir: root });
    const retained = first.evaluate({
      workspace_id: "ws-a",
      key: "avoid:functional:TC-1",
      value: "wrong password binding",
      source_ref: "defect-draft:1",
      consequence_class: "reversible",
      reuse_likely: true,
      ttl_seconds: 3600,
    });
    assert.equal(retained.retained, true);

    const second = new SessionMemory(clock, { persistRootDir: root });
    const hints = second.list("ws-a", "avoid:");
    assert.equal(hints.length, 1);
    assert.equal(hints[0]?.key, "avoid:functional:TC-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MistakeRecurrenceTracker counts survive restart via persistRootDir", () => {
  const root = mkdtempSync(join(tmpdir(), "qa-occ-"));
  try {
    const clock = new FixedClock("2026-08-11T12:00:00.000Z");
    const first = new MistakeRecurrenceTracker(clock, { persistRootDir: root });
    first.record({
      workspace_id: "ws-a",
      causal_mistake_key: "avoid:functional:TC-1",
      trigger: "failed_execution",
      source_ref: "defect-draft:1",
      occurred_at: clock.now().toISOString(),
    });

    const second = new MistakeRecurrenceTracker(clock, { persistRootDir: root });
    assert.equal(second.occurrenceCount("ws-a", "avoid:functional:TC-1"), 1);
    const assessment = second.record({
      workspace_id: "ws-a",
      causal_mistake_key: "avoid:functional:TC-1",
      trigger: "failed_execution",
      source_ref: "defect-draft:2",
      occurred_at: clock.now().toISOString(),
    });
    assert.equal(assessment.recurring, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FileBackedCandidateRepository survives restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-cand-"));
  try {
    const clock = new FixedClock("2026-08-11T12:00:00.000Z");
    const first = new FileBackedCandidateRepository(clock, root);
    const created = await first.createIdempotent({
      context: workspaceContext("ws-a"),
      candidate: {
        id: "candidate:avoid:functional:TC-1",
        workspace_id: "ws-a",
        proposed_claims: [],
        discovery_source: "mistake-recurrence",
        rationale: "recurring",
        supporting_evidence_refs: [],
        contradicting_evidence_refs: [],
        confidence: 0.5,
        uncertainty_reasons: [],
        affected_knowledge_refs: [],
        validation_plan: "human",
        owner: "test",
        expires_at: "2026-09-11T00:00:00.000Z",
      },
      idempotency_key: "idem-1",
    });
    assert.equal(created.ok, true);

    const second = new FileBackedCandidateRepository(clock, root);
    const listed = await second.query({
      context: workspaceContext("ws-a"),
      discovery_source: "mistake-recurrence",
    });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0]?.id, "candidate:avoid:functional:TC-1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
