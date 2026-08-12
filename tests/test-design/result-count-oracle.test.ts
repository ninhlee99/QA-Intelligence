import assert from "node:assert/strict";
import test from "node:test";

import { testCaseToExecutionPlan } from "../../src/test-design/to-execution-plan.js";
import type { TestCase, TestCaseGeneratedAssertion } from "../../src/test-design/public.js";
import type { CleanedDomNode } from "../../src/dom-cleaner/public.js";

function leaf(role: string, name: string): CleanedDomNode {
  return {
    node_id: `n-${role}-${name}`,
    tag: "div",
    retained_attributes: {},
    accessible_role: role,
    accessible_name: name,
    children: [],
  };
}

function tree(children: CleanedDomNode[]): CleanedDomNode {
  return { node_id: "root", tag: "body", retained_attributes: {}, children };
}

const baseCase: TestCase = {
  id: "test-case-1",
  version: "1.0.0",
  status: "draft",
  purpose: "count oracle",
  traceability: ["REQ@1"],
  preconditions: [],
  workspace_scope: "ws",
  steps: [
    { action: "navigate", input: { url: "https://example.invalid/search" } },
    { action: "click", input: { accessible_name: "Search", accessible_role: "button" } },
  ],
  expected_results: [{ assertion: "count", authority: "REQ#AC1" }],
  owner: "tester",
};

test("expected_result_count eq passes when cleaned tree matches", () => {
  const assertion: TestCaseGeneratedAssertion = {
    test_case_id: "test-case-1",
    expected_result_count: { accessible_role: "listitem", relation: "eq", value: 2 },
  };
  const plan = testCaseToExecutionPlan(baseCase, [assertion]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const cleaned = tree([leaf("listitem", "A"), leaf("listitem", "B")]);
  assert.equal(
    plan.value.assert(cleaned, { dialog_triggered: false, url: "https://example.invalid/search", title: "t", network: [] }),
    true,
  );
});

test("expected_result_count gte fails when too few nodes", () => {
  const assertion: TestCaseGeneratedAssertion = {
    test_case_id: "test-case-1",
    expected_result_count: { accessible_role: "listitem", relation: "gte", value: 3 },
  };
  const plan = testCaseToExecutionPlan(baseCase, [assertion]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const cleaned = tree([leaf("listitem", "A")]);
  assert.equal(
    plan.value.assert(cleaned, { dialog_triggered: false, url: "https://example.invalid/search", title: "t", network: [] }),
    false,
  );
});
