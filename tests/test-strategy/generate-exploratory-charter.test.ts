import assert from "node:assert/strict";
import test from "node:test";

import { generateExploratoryCharter } from "../../src/test-strategy/generate-exploratory-charter.js";
import type { SemanticUiElement } from "../../src/discovery/public.js";

function el(overrides: Partial<SemanticUiElement> & Pick<SemanticUiElement, "id" | "kind">): SemanticUiElement {
  return {
    source_node_id: `node:${overrides.id}`,
    confidence: 1,
    ...overrides,
  };
}

test("generateExploratoryCharter sizes the time box from interactive surface size", () => {
  const small = generateExploratoryCharter({
    source_url: "https://example.com/login",
    elements: [
      el({ id: "f1", kind: "field", accessible_name: "Username", interaction_hint: "editable" }),
      el({ id: "a1", kind: "action", accessible_name: "Sign in", interaction_hint: "clickable" }),
    ],
  });
  assert.equal(small.time_box_minutes, 15);
  assert.ok(small.focus_areas.length > 0);
  assert.ok(small.oracles.length > 0);
  assert.ok(small.out_of_scope.some((item) => item.includes("WCAG")));
});

test("generateExploratoryCharter preserves caller objective and requirement_ref out-of-scope note", () => {
  const charter = generateExploratoryCharter({
    elements: [el({ id: "a1", kind: "action", accessible_name: "Save", interaction_hint: "clickable" })],
    objective: "Hunt for silent save failures on the settings screen.",
    requirement_ref: "REQ-42@1.0.0",
  });

  assert.equal(charter.objective, "Hunt for silent save failures on the settings screen.");
  assert.ok(charter.out_of_scope.some((item) => item.includes("REQ-42@1.0.0")));
});
