import assert from "node:assert/strict";
import test from "node:test";

import { generateJourneyTestCases } from "../../src/test-design/generate-journey-test-cases.js";

test("generateJourneyTestCases builds one-hop and multi-hop journeys", () => {
  const result = generateJourneyTestCases({
    workspace_id: "ws-1",
    requirement_ref: "REQ-1@1.0.0",
    start_url: "https://example.com/",
    pages: [
      {
        url: "https://example.com/",
        title: "Home",
        capture_id: "c1",
        element_count: 2,
        named_fields: [],
        named_actions: ["Products"],
        limitations: [],
      },
      {
        url: "https://example.com/products",
        title: "Products",
        capture_id: "c2",
        element_count: 2,
        named_fields: ["Search"],
        named_actions: ["Add"],
        limitations: [],
      },
      {
        url: "https://example.com/cart",
        title: "Cart",
        capture_id: "c3",
        element_count: 1,
        named_fields: [],
        named_actions: ["Checkout"],
        limitations: [],
      },
    ],
    edges: [
      { from_url: "https://example.com/", to_url: "https://example.com/products", link_text: "Products" },
      { from_url: "https://example.com/products", to_url: "https://example.com/cart", link_text: "Cart" },
    ],
    max_hops: 3,
  });

  assert.ok(result.test_cases.length >= 2);
  assert.equal(result.generated_assertions.length, result.test_cases.length);
  assert.ok(result.generated_assertions.every((a) => !!a.expected_url_includes));
  const multi = result.test_cases.find((tc) => tc.id.startsWith("journey-path-"));
  assert.ok(multi);
  assert.ok((multi?.steps.length ?? 0) >= 3);
});

test("generateJourneyTestCases reports finding when no edges", () => {
  const result = generateJourneyTestCases({
    workspace_id: "ws-1",
    start_url: "https://example.com/",
    pages: [],
    edges: [],
  });
  assert.equal(result.test_cases.length, 0);
  assert.ok(result.findings.some((f) => f.includes("No workflow edges")));
});
