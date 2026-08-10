import assert from "node:assert/strict";
import test from "node:test";

import { assessUiAccessibilitySmoke } from "../../src/discovery/assess-ui-accessibility-smoke.js";
import type { SemanticUiElement } from "../../src/discovery/public.js";

function el(overrides: Partial<SemanticUiElement> & Pick<SemanticUiElement, "id" | "kind">): SemanticUiElement {
  return {
    source_node_id: `node:${overrides.id}`,
    confidence: 1,
    ...overrides,
  };
}

test("assessUiAccessibilitySmoke flags unlabeled editable fields as critical", () => {
  const report = assessUiAccessibilitySmoke({
    source_url: "https://example.com/form",
    elements: [
      el({ id: "page-1", kind: "page", accessible_name: "Form" }),
      el({ id: "field-1", kind: "field", interaction_hint: "editable", accessible_role: "textbox" }),
    ],
  });

  assert.equal(report.summary.critical, 1);
  assert.ok(report.findings.some((f) => f.category === "unlabeled_editable_field"));
  assert.ok(report.limitations.some((l) => l.includes("WCAG")));
});

test("assessUiAccessibilitySmoke flags duplicate accessible names", () => {
  const report = assessUiAccessibilitySmoke({
    elements: [
      el({ id: "a1", kind: "action", accessible_name: "Submit", interaction_hint: "clickable" }),
      el({ id: "a2", kind: "action", accessible_name: "Submit", interaction_hint: "clickable" }),
    ],
  });

  assert.ok(report.findings.some((f) => f.category === "duplicate_accessible_name" && f.element_ids.length === 2));
});

test("assessUiAccessibilitySmoke is clean when interactive controls are uniquely named", () => {
  const report = assessUiAccessibilitySmoke({
    elements: [
      el({ id: "f1", kind: "field", accessible_name: "Email", interaction_hint: "editable" }),
      el({ id: "a1", kind: "action", accessible_name: "Continue", interaction_hint: "clickable" }),
    ],
  });

  assert.deepEqual(report.summary, { critical: 0, high: 0, medium: 0, low: 0 });
  assert.equal(report.findings.length, 0);
});

test("assessUiAccessibilitySmoke reports empty_surface when discovery returned nothing", () => {
  const report = assessUiAccessibilitySmoke({ elements: [], source_url: "https://example.com" });
  assert.ok(report.findings.some((f) => f.category === "empty_surface"));
});
