import assert from "node:assert/strict";
import test from "node:test";
import { generateStateJourneys } from "../../src/deep-testing/state-model-journeys.js";
import { assessMutationAdequacy } from "../../src/deep-testing/mutation-adequacy.js";

test("state-model generation covers reachable transitions without infinite loops", () => {
  const result = generateStateJourneys({ initial_state: "logged_out", max_steps: 4, transitions: [{ from: "logged_out", action: "login", to: "active" }, { from: "active", action: "suspend", to: "suspended" }, { from: "suspended", action: "restore", to: "active" }] });
  assert.deepEqual(result.uncovered_transitions, []); assert.equal(result.journeys.length, 3);
});

test("mutation gate blocks any surviving critical mutant regardless of aggregate score", () => {
  const result = assessMutationAdequacy({ mutants: [{ id: "M1", critical: true, outcome: "survived" }, { id: "M2", critical: false, outcome: "killed" }], minimum_score: 0.5 });
  assert.equal(result.score, 0.5); assert.equal(result.passed, false);
});
