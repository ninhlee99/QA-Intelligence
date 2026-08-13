import assert from "node:assert/strict";
import test from "node:test";
import { assessApiContractDrift } from "../../src/deep-testing/api-contract-drift.js";
import { assessPerformanceBudget } from "../../src/deep-testing/performance-budget.js";

test("API drift catches removed operations, responses, and new required inputs", () => {
  const baseline = { "/users": { get: { required_parameters: [], response_statuses: ["200", "404"] } } };
  assert.equal(assessApiContractDrift({ baseline, candidate: {} }).breaking, true);
  const changed = assessApiContractDrift({ baseline, candidate: { "/users": { get: { required_parameters: ["tenant"], response_statuses: ["200"] } } } });
  assert.equal(changed.changes.length, 2);
});

test("performance gate fails both exceeded and missing measurements", () => {
  const result = assessPerformanceBudget({ observations: [{ name: "lcp", value: 2600, unit: "ms" }], budgets: { lcp: 2500, bundle: 200000 } });
  assert.equal(result.passed, false); assert.equal(result.violations.length, 2);
});
