import assert from "node:assert/strict";
import test from "node:test";

import { buildDefectEvidencePack } from "../../src/bug-analysis/defect-evidence-pack.js";
import { formatDefectsForTracker } from "../../src/bug-analysis/format-defects-for-tracker.js";
import type { Defect } from "../../src/bug-analysis/public.js";

function sampleDefect(overrides: Partial<Defect> = {}): Defect {
  return {
    id: "DEF-DRAFT:TC-1",
    version: "0.1.0",
    status: "draft",
    summary: "Fail sample",
    observed_behavior: "saw fail",
    expected_behavior: "expect pass",
    expected_behavior_authority: "REQ-1@1.0.0",
    affected_requirement_refs: ["REQ-1@1.0.0"],
    workspace_scope: "ws-1",
    environment_ref: "regression",
    reproduction_conditions: ["go", "click"],
    evidence: [
      "outcome:failed",
      "test-case:TC-1",
      "capture:discovery:op-1",
      ".qa-screenshots/op/TC-1/fail.png",
    ],
    severity: "high",
    severity_rationale: "failed regression",
    priority: "p1",
    classification: "product_defect",
    suspected_cause: "possible assertion miss",
    owner: "unassigned",
    related_execution_refs: ["execution:TC-1"],
    related_test_refs: ["TC-1"],
    ...overrides,
  };
}

test("buildDefectEvidencePack classifies screenshot/capture/outcome", () => {
  const pack = buildDefectEvidencePack(sampleDefect());
  assert.equal(pack.confirmed_cause, null);
  assert.ok(pack.entries.some((e) => e.kind === "screenshot"));
  assert.ok(pack.entries.some((e) => e.kind === "capture"));
  assert.ok(pack.entries.some((e) => e.kind === "outcome"));
  assert.ok(pack.markdown_attachment_section.includes("confirmed_cause"));
});

test("buildDefectEvidencePack classifies .qa-traces zip as trace", () => {
  const pack = buildDefectEvidencePack(
    sampleDefect({
      evidence: ["/tmp/.qa-traces/op/run_attempt_1.zip", "capture:x"],
    }),
  );
  assert.ok(pack.entries.some((e) => e.kind === "trace"));
});

test("formatDefectsForTracker includes evidence pack section", () => {
  const text = formatDefectsForTracker([sampleDefect()], "markdown");
  assert.ok(text.includes("Evidence pack"));
  assert.ok(text.includes("screenshot"));
  assert.ok(text.includes("NOT confirmed"));
});
