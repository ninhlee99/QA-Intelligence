import assert from "node:assert/strict";
import test from "node:test";

import { SessionMemory } from "../../src/memory/session-memory.js";
import {
  evaluateFailureAvoidanceCandidate,
  type FailureAvoidanceCandidate,
} from "../../src/memory/failure-avoidance.js";

const WORKSPACE = "workspace-memory-001";

function clockAt(iso: string): { now(): Date } {
  return { now: () => new Date(iso) };
}

function trigger(overrides: Partial<FailureAvoidanceCandidate> = {}): FailureAvoidanceCandidate {
  return {
    workspace_id: WORKSPACE,
    trigger: "defect",
    causal_mistake_key: "missing-header:x-tenant-id",
    causal_mistake: "endpoint requires header X-Tenant-Id that was omitted",
    source_ref: "run://run-001/step-4/defect",
    consequence_class: "advisory",
    recurring: false,
    ttl_seconds: 3600,
    ...overrides,
  };
}

test("a one-off, project-scoped, low-consequence mistake is retained as an avoidance fact (SPEC-108 §7.3)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = evaluateFailureAvoidanceCandidate(memory, trigger());

  assert.equal(decision.retained, true);
  assert.ok(decision.retained);
  assert.equal(decision.entry.value, "endpoint requires header X-Tenant-Id that was omitted");
  assert.equal(memory.get(WORKSPACE, "missing-header:x-tenant-id"), decision.entry);
});

test("a recurring mistake is declined and routed to the Learning Engine instead (SPEC-105 §9a)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = evaluateFailureAvoidanceCandidate(memory, trigger({ recurring: true }));

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "requires_learning_engine");
  assert.equal(memory.get(WORKSPACE, "missing-header:x-tenant-id"), undefined);
});

test("a cross-project generalizable mistake is declined regardless of recurrence (SPEC-108 §4.3)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = evaluateFailureAvoidanceCandidate(
    memory,
    trigger({ applicability_scope: "cross_project", recurring: false }),
  );

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "requires_learning_engine");
});

test("a high-consequence mistake still cannot use the fast path (SPEC-108 §7.2)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = evaluateFailureAvoidanceCandidate(
    memory,
    trigger({ consequence_class: "high_consequence" }),
  );

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "consequence_too_high");
});

test("every failure-avoidance trigger kind is a valid one-off candidate", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));
  const kinds: FailureAvoidanceCandidate["trigger"][] = [
    "defect",
    "incorrect_verdict",
    "blocked_execution",
    "failed_execution",
    "human_corrected_decision",
  ];

  for (const [index, kind] of kinds.entries()) {
    const decision = evaluateFailureAvoidanceCandidate(
      memory,
      trigger({ trigger: kind, causal_mistake_key: `mistake-${index}` }),
    );
    assert.equal(decision.retained, true, `trigger ${kind} should be retained`);
  }
});
