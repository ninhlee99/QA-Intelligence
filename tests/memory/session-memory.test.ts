import assert from "node:assert/strict";
import test from "node:test";

import { SessionMemory, type SessionMemoryCandidate } from "../../src/memory/session-memory.js";

const WORKSPACE = "workspace-memory-001";

function clockAt(iso: string): { now(): Date } {
  return { now: () => new Date(iso) };
}

function candidate(overrides: Partial<SessionMemoryCandidate> = {}): SessionMemoryCandidate {
  return {
    workspace_id: WORKSPACE,
    key: "selector:submit-button",
    value: "#submit-btn-v2",
    source_ref: "run://run-001/step-3/observation",
    consequence_class: "advisory",
    reuse_likely: true,
    ttl_seconds: 3600,
    ...overrides,
  };
}

test("retains a low-consequence, project-scoped, reuse-likely candidate via the fast path (SPEC-108 §7.2)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = memory.evaluate(candidate());

  assert.equal(decision.retained, true);
  assert.ok(decision.retained);
  assert.equal(decision.entry.applicability_scope, "project_scoped");
  assert.equal(decision.entry.audit.promoted_via, "fast_path");
  assert.equal(decision.entry.expires_at, "2026-08-05T11:00:00.000Z");
  assert.deepEqual(memory.get(WORKSPACE, "selector:submit-button"), decision.entry);
});

test("declines a candidate with no reuse likelihood (SPEC-108 §7.1) — retention is never the default", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = memory.evaluate(candidate({ reuse_likely: false }));

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "no_reuse_likelihood");
  assert.equal(memory.get(WORKSPACE, "selector:submit-button"), undefined);
});

test("declines a candidate lacking a source reference (SPEC-108 §7.1 provenance sufficiency)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = memory.evaluate(candidate({ source_ref: "" }));

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "missing_provenance");
});

test("declines medium/high-consequence candidates from the fast path (SPEC-108 §7.2)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const medium = memory.evaluate(candidate({ consequence_class: "controlled_side_effect" }));
  const high = memory.evaluate(candidate({ key: "rule:high", consequence_class: "high_consequence" }));

  assert.equal(medium.retained, false);
  assert.ok(!medium.retained);
  assert.equal(medium.reason, "consequence_too_high");
  assert.equal(high.retained, false);
  assert.ok(!high.retained);
  assert.equal(high.reason, "consequence_too_high");
});

test("declines cross-project candidates from the fast path regardless of consequence (SPEC-108 §4.3)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));

  const decision = memory.evaluate(
    candidate({ applicability_scope: "cross_project", consequence_class: "advisory" }),
  );

  assert.equal(decision.retained, false);
  assert.ok(!decision.retained);
  assert.equal(decision.reason, "not_project_scoped");
});

test("fails safe on an expired entry instead of returning stale data (SPEC-108 §9)", () => {
  const clock = { now: () => new Date("2026-08-05T10:00:00.000Z") };
  const memory = new SessionMemory(clock);
  memory.evaluate(candidate({ ttl_seconds: 60 }));
  assert.notEqual(memory.get(WORKSPACE, "selector:submit-button"), undefined);

  clock.now = () => new Date("2026-08-05T10:05:00.000Z");

  assert.equal(memory.get(WORKSPACE, "selector:submit-button"), undefined);
});

test("async review can reject a fast-path promotion, invalidating it immediately (SPEC-108 §7.2)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));
  memory.evaluate(candidate());
  assert.notEqual(memory.get(WORKSPACE, "selector:submit-button"), undefined);

  memory.reject(WORKSPACE, "selector:submit-button");

  assert.equal(memory.get(WORKSPACE, "selector:submit-button"), undefined);
});

test("invalidates every entry for a deleted Workspace (SPEC-108 §8)", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));
  memory.evaluate(candidate({ key: "selector:a" }));
  memory.evaluate(candidate({ key: "selector:b" }));
  assert.equal(memory.entryCount(WORKSPACE), 2);

  memory.invalidateWorkspace(WORKSPACE);

  assert.equal(memory.entryCount(WORKSPACE), 0);
  assert.equal(memory.get(WORKSPACE, "selector:a"), undefined);
});

test("does not leak an entry across Workspaces even with the same key", () => {
  const memory = new SessionMemory(clockAt("2026-08-05T10:00:00.000Z"));
  memory.evaluate(candidate());

  assert.equal(memory.get("workspace-memory-999", "selector:submit-button"), undefined);
});
