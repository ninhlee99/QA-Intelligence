import assert from "node:assert/strict";
import test from "node:test";

import { MistakeRecurrenceTracker, type MistakeOccurrence } from "../../src/learning-engine/mistake-recurrence.js";

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

function makeTracker(): MistakeRecurrenceTracker {
  return new MistakeRecurrenceTracker({ now: () => new Date("2026-08-07T09:30:00.000Z") });
}

test("a single occurrence is not recurring", () => {
  const tracker = makeTracker();
  const result = tracker.record(occurrence());

  assert.equal(result.recurring, false);
});

test("a second occurrence of the same causal_mistake_key in the same Workspace is recurring", () => {
  const tracker = makeTracker();
  tracker.record(occurrence({ source_ref: "run:RUN-1", occurred_at: "2026-08-07T09:00:00.000Z" }));
  const second = tracker.record(occurrence({ source_ref: "run:RUN-2", occurred_at: "2026-08-07T10:00:00.000Z" }));

  assert.equal(second.recurring, true);
  assert.ok(second.recurring);
  assert.equal(second.occurrence_count, 2);
  assert.deepEqual(second.affected_runs, ["run:RUN-1", "run:RUN-2"]);
  assert.equal(second.first_observed_at, "2026-08-07T09:00:00.000Z");
});

test("generalizesBeyondWorkspace forces recurring on the first occurrence", () => {
  const tracker = makeTracker();
  const result = tracker.record(occurrence(), true);

  assert.equal(result.recurring, true);
  assert.ok(result.recurring);
  assert.equal(result.occurrence_count, 1);
});

test("Workspace isolation: occurrences in different Workspaces never combine counts", () => {
  const tracker = makeTracker();
  tracker.record(occurrence({ workspace_id: "workspace-alpha" }));
  const otherWorkspace = tracker.record(occurrence({ workspace_id: "workspace-beta" }));

  assert.equal(otherWorkspace.recurring, false);
  assert.equal(tracker.occurrenceCount("workspace-alpha", "missing-header:x-tenant-id"), 1);
  assert.equal(tracker.occurrenceCount("workspace-beta", "missing-header:x-tenant-id"), 1);
});

test("a different causal_mistake_key in the same Workspace does not combine counts", () => {
  const tracker = makeTracker();
  tracker.record(occurrence({ causal_mistake_key: "missing-header:x-tenant-id" }));
  const differentKey = tracker.record(occurrence({ causal_mistake_key: "missing-header:x-request-id" }));

  assert.equal(differentKey.recurring, false);
});

test("occurrenceCount reports 0 for an unobserved key", () => {
  const tracker = makeTracker();
  assert.equal(tracker.occurrenceCount("workspace-alpha", "never-seen"), 0);
});
