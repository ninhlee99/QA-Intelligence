import assert from "node:assert/strict";
import test from "node:test";

import { defaultAgentRunBudgets, resolveAgentRunBudgets } from "../../src/runtime/default-budgets.js";

test("advisory consequence class resolves the SPEC-508 §3.1 low-tier default", () => {
  const budgets = defaultAgentRunBudgets("advisory");
  assert.deepEqual(budgets, {
    max_steps: 8,
    max_duration_seconds: 120,
    max_tool_calls: 10,
    max_retries: 1,
    max_tokens: 40_000,
  });
});

test("controlled_side_effect and reversible share the mid-tier default", () => {
  assert.deepEqual(defaultAgentRunBudgets("reversible"), defaultAgentRunBudgets("controlled_side_effect"));
  assert.equal(defaultAgentRunBudgets("reversible").max_steps, 20);
  assert.equal(defaultAgentRunBudgets("reversible").max_tokens, 150_000);
  assert.equal(defaultAgentRunBudgets("reversible").max_duration_seconds, 600);
});

test("high_consequence resolves the highest tier default", () => {
  const budgets = defaultAgentRunBudgets("high_consequence");
  assert.equal(budgets.max_steps, 40);
  assert.equal(budgets.max_tokens, 400_000);
  assert.equal(budgets.max_tool_calls, 100);
  assert.equal(budgets.max_duration_seconds, 1_800);
});

test("resolveAgentRunBudgets falls back to defaults for unspecified fields", () => {
  const resolved = resolveAgentRunBudgets("advisory", {});
  assert.deepEqual(resolved, defaultAgentRunBudgets("advisory"));
});

test("resolveAgentRunBudgets honors a stricter caller override", () => {
  const resolved = resolveAgentRunBudgets("high_consequence", { max_steps: 5, max_tokens: 10_000 });
  assert.equal(resolved.max_steps, 5);
  assert.equal(resolved.max_tokens, 10_000);
  // Fields not overridden still fall back to the class default.
  assert.equal(resolved.max_tool_calls, 100);
  assert.equal(resolved.max_duration_seconds, 1_800);
});

test("resolveAgentRunBudgets carries a looser caller override verbatim (adjudication happens at authorization time, not here)", () => {
  const resolved = resolveAgentRunBudgets("advisory", { max_steps: 1_000 });
  assert.equal(resolved.max_steps, 1_000);
});

test("resolveAgentRunBudgets omits optional fields the caller and the default both leave unset", () => {
  const resolved = resolveAgentRunBudgets("advisory", {});
  assert.equal(resolved.max_cost, undefined);
  assert.equal(resolved.max_tool_cost, undefined);
  assert.equal(resolved.max_repeated_action_fingerprints, undefined);
  assert.equal(resolved.max_no_progress_iterations, undefined);
});
