import assert from "node:assert/strict";
import test from "node:test";

import { generateWorkflowStub } from "../../src/business-analysis/generate-workflow-stub.js";
import { generateRiskStubs } from "../../src/risk-analysis/generate-risk-stub.js";
import { generateTestStrategyStub } from "../../src/test-strategy/generate-test-strategy-stub.js";
import { createAutomationAssetStub } from "../../src/automation/create-automation-asset-stub.js";
import { InMemoryWorkspaceDatasetRegistry } from "../../src/test-data/workspace-dataset-registry.js";
import type { SemanticUiElement } from "../../src/discovery/public.js";
import { testCaseToExecutionPlan } from "../../src/test-design/to-execution-plan.js";
import type { TestCase } from "../../src/test-design/public.js";

function el(overrides: Partial<SemanticUiElement> & Pick<SemanticUiElement, "id" | "kind">): SemanticUiElement {
  return {
    source_node_id: `node:${overrides.id}`,
    confidence: 1,
    ...overrides,
  };
}

const elements = [
  el({ id: "f1", kind: "field", accessible_name: "Email", interaction_hint: "editable" }),
  el({ id: "a1", kind: "action", accessible_name: "Save", interaction_hint: "clickable" }),
];

test("generateWorkflowStub drafts current-state workflow from UI map", () => {
  const workflow = generateWorkflowStub({
    elements,
    workspace_id: "ws-1",
    source_url: "https://example.com/form",
    requirement_ref: "REQ-1@1.0.0",
  });
  assert.equal(workflow.state, "current");
  assert.ok(workflow.activities.length >= 2);
  assert.ok(workflow.traces_to.includes("REQ-1@1.0.0"));
});

test("generateRiskStubs returns grounded draft risks", () => {
  const risks = generateRiskStubs({ elements, workspace_id: "ws-1", source_url: "https://example.com" });
  assert.ok(risks.length >= 1);
  assert.equal(risks.every((r) => r.status === "draft"), true);
});

test("generateTestStrategyStub returns draft strategy with exclusions", () => {
  const strategy = generateTestStrategyStub({
    elements,
    workspace_id: "ws-1",
    objective: "Smoke the form",
  });
  assert.equal(strategy.status, "draft");
  assert.ok(strategy.exclusions && strategy.exclusions.length > 0);
});

test("dataset registry stores metadata only", () => {
  const registry = new InMemoryWorkspaceDatasetRegistry({ now: () => new Date("2026-08-10T00:00:00.000Z") });
  const registered = registry.register({
    workspace_id: "ws-1",
    purpose: "Login boundary probes",
    classification: "adversarial_and_boundary",
  });
  assert.equal(registered.ok, true);
  assert.equal(registry.list("ws-1").length, 1);
});

test("createAutomationAssetStub requires test case refs", () => {
  const bad = createAutomationAssetStub({ workspace_id: "ws-1", implemented_test_case_refs: [] });
  assert.equal(bad.ok, false);
  const good = createAutomationAssetStub({
    workspace_id: "ws-1",
    implemented_test_case_refs: ["TC-1@1.0.0"],
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.asset.implemented_test_case_refs[0], "TC-1@1.0.0");
});

test("to-execution-plan maps select and wait_for steps", () => {
  const testCase: TestCase = {
    id: "TC-SELECT",
    version: "1.0.0",
    status: "draft",
    purpose: "Select an option",
    traceability: ["REQ-1@1.0.0"],
    preconditions: [],
    workspace_scope: "ws-1",
    steps: [
      { action: "navigate", input: { url: "https://example.com" } },
      { action: "wait_for", input: { accessible_name: "Country", timeout_ms: 1000 } },
      { action: "select", input: { accessible_name: "Country", option_label: "Vietnam" } },
    ],
    expected_results: [{ assertion: "Saved", authority: "REQ-1@1.0.0" }],
    owner: "qa",
  };
  const plan = testCaseToExecutionPlan(testCase, [
    { test_case_id: "TC-SELECT", expected_text: "Saved" },
  ]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.value.steps?.length, 2);
  assert.equal(plan.value.steps?.[0]?.kind, "wait_for");
  assert.equal(plan.value.steps?.[1]?.kind, "select");
});
