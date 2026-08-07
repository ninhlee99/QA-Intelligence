import assert from "node:assert/strict";
import test from "node:test";

import { resolveRulePrecedence, type RuleCandidate } from "../../src/shared/rule-precedence.js";

function candidate(overrides: Partial<RuleCandidate<string>> = {}): RuleCandidate<string> {
  return {
    id: "rule-a",
    version: "1.0.0",
    authority_class: "product",
    specificity: 0,
    workspace_scope: "global",
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_until: null,
    priority: 0,
    outcome: "outcome-a",
    ...overrides,
  };
}

test("authority class wins over specificity when both differ", () => {
  const governance = candidate({ id: "governance-rule", authority_class: "governance", specificity: 0 });
  const productMoreSpecific = candidate({ id: "product-rule", authority_class: "product", specificity: 10 });

  const result = resolveRulePrecedence([governance, productMoreSpecific], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "governance-rule");
});

test("workspace-specific outranks global at equal authority and specificity", () => {
  const global = candidate({ id: "global-rule", workspace_scope: "global" });
  const workspaceSpecific = candidate({ id: "workspace-rule", workspace_scope: "workspace-alpha" });

  const result = resolveRulePrecedence([global, workspaceSpecific], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "workspace-rule");
});

test("newer version wins at equal authority, specificity, and scope", () => {
  const older = candidate({ id: "rule-v1", version: "1.0.0" });
  const newer = candidate({ id: "rule-v2", version: "2.0.0" });

  const result = resolveRulePrecedence([older, newer], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "rule-v2");
});

test("declared priority is the final tiebreaker", () => {
  const lowPriority = candidate({ id: "low-priority", priority: 1 });
  const highPriority = candidate({ id: "high-priority", priority: 5 });

  const result = resolveRulePrecedence([lowPriority, highPriority], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "high-priority");
});

test("a genuine tie across every precedence tier is a conflict, not a silent pick", () => {
  const first = candidate({ id: "rule-one" });
  const second = candidate({ id: "rule-two" });

  const result = resolveRulePrecedence([first, second], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "conflict");
  assert.ok(result.outcome === "conflict");
  assert.equal(result.tied.length, 2);
  assert.deepEqual(
    result.tied.map((tied) => tied.id).sort(),
    ["rule-one", "rule-two"],
  );
});

test("a rule outside its effective period is excluded (SPEC-104 §9 historical time)", () => {
  const expired = candidate({ id: "expired-rule", effective_from: "2020-01-01T00:00:00.000Z", effective_until: "2021-01-01T00:00:00.000Z" });
  const current = candidate({ id: "current-rule" });

  const result = resolveRulePrecedence([expired, current], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "current-rule");
});

test("a Workspace-scoped rule for another Workspace is excluded (isolation, SPEC-104 §12)", () => {
  const otherWorkspace = candidate({ id: "other-workspace-rule", workspace_scope: "workspace-beta" });
  const thisWorkspace = candidate({ id: "this-workspace-rule", workspace_scope: "workspace-alpha" });

  const result = resolveRulePrecedence([otherWorkspace, thisWorkspace], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "resolved");
  assert.ok(result.outcome === "resolved");
  assert.equal(result.winner.id, "this-workspace-rule");
});

test("no applicable rule when every candidate is out of effective period or out of scope", () => {
  const expired = candidate({ effective_from: "2020-01-01T00:00:00.000Z", effective_until: "2021-01-01T00:00:00.000Z" });
  const otherWorkspace = candidate({ workspace_scope: "workspace-beta" });

  const result = resolveRulePrecedence([expired, otherWorkspace], "2026-06-01T00:00:00.000Z", "workspace-alpha");

  assert.equal(result.outcome, "no_applicable_rule");
});
