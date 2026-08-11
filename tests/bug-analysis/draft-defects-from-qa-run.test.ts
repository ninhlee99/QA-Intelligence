import assert from "node:assert/strict";
import test from "node:test";

import { draftDefectsFromQaRun } from "../../src/bug-analysis/draft-defects-from-qa-run.js";
import type { QaRunTestCaseResult } from "../../src/reporting/qa-run-report.js";

function result(overrides: Partial<QaRunTestCaseResult> = {}): QaRunTestCaseResult {
  return {
    test_case_id: "tc-1",
    purpose: "Validate Username accepts a correct value.",
    variant: "positive",
    outcome: "failed",
    evidence: ["capture:abc", "/tmp/shot.png"],
    ...overrides,
  };
}

const baseInput = {
  workspace_id: "workspace-001",
  requirement_ref: "REQ-001@1.0.0",
  target_url: "https://example.com/login",
  environment_ref: "environment:op-1",
} as const;

test("draftDefectsFromQaRun emits one draft per failed/flaky case and skips passes", () => {
  const drafts = draftDefectsFromQaRun({
    ...baseInput,
    test_cases: [
      result({ test_case_id: "tc-pass", outcome: "passed" }),
      result({ test_case_id: "tc-fail", outcome: "failed", variant: "positive" }),
      result({ test_case_id: "tc-flaky", outcome: "flaky", variant: "negative" }),
      result({ test_case_id: "tc-skip", outcome: "not_executed", skip_reason: "no assertion" }),
    ],
  });

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]?.id, "DEF-DRAFT:tc-fail");
  assert.equal(drafts[0]?.status, "draft");
  assert.equal(drafts[0]?.confirmed_cause, undefined);
  assert.equal(drafts[1]?.id, "DEF-DRAFT:tc-flaky");
  assert.equal(drafts[1]?.classification, "automation_defect");
});

test("draftDefectsFromQaRun classifies adversarial fails as security_incident / critical / p0", () => {
  const [draft] = draftDefectsFromQaRun({
    ...baseInput,
    test_cases: [result({ variant: "adversarial", outcome: "failed" })],
  });

  assert.equal(draft?.classification, "security_incident");
  assert.equal(draft?.severity, "critical");
  assert.equal(draft?.priority, "p0");
  assert.ok(draft?.suspected_cause);
  assert.equal(draft?.confirmed_cause, undefined);
});

test("draftDefectsFromQaRun synthesizes evidence when the engine captured none", () => {
  const [draft] = draftDefectsFromQaRun({
    ...baseInput,
    test_cases: [result({ evidence: [] })],
  });

  assert.ok(draft);
  assert.ok(draft.evidence.length >= 1);
  assert.ok(draft.evidence.some((entry) => entry.startsWith("outcome:")));
  assert.ok(draft.reproduction_conditions.some((step) => step.includes("https://example.com/login")));
});

test("draftDefectsFromQaRun never invents a confirmed_cause even for security drafts", () => {
  const drafts = draftDefectsFromQaRun({
    ...baseInput,
    test_cases: [
      result({ variant: "adversarial" }),
      result({ test_case_id: "tc-2", variant: "boundary" }),
    ],
  });

  for (const draft of drafts) {
    assert.equal(draft.confirmed_cause, undefined);
    assert.equal(draft.owner, "unassigned");
    assert.deepEqual(draft.affected_requirement_refs, ["REQ-001@1.0.0"]);
  }
});
