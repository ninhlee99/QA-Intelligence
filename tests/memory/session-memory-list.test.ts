import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFailureAvoidanceCandidate } from "../../src/memory/failure-avoidance.js";
import { SessionMemory } from "../../src/memory/session-memory.js";

test("SessionMemory.list returns unexpired avoid: hints for one Workspace", () => {
  const clock = { now: () => new Date("2026-08-10T08:00:00.000Z") };
  const memory = new SessionMemory(clock);

  evaluateFailureAvoidanceCandidate(memory, {
    workspace_id: "workspace-a",
    trigger: "failed_execution",
    causal_mistake_key: "avoid:DEF-1:functional",
    causal_mistake: "Submit succeeded silently without confirmation.",
    source_ref: "defect-draft:DEF-1",
    consequence_class: "reversible",
    recurring: false,
    ttl_seconds: 3600,
  });
  memory.evaluate({
    workspace_id: "workspace-a",
    key: "tool:run_auto_qa:last",
    value: "noise",
    source_ref: "run:1",
    consequence_class: "advisory",
    reuse_likely: true,
    ttl_seconds: 3600,
  });

  const hints = memory.list("workspace-a", "avoid:");
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.key, "avoid:DEF-1:functional");
  assert.equal(memory.list("workspace-b", "avoid:").length, 0);
});
