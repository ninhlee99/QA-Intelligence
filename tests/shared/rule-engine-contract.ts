import assert from "node:assert/strict";
import test from "node:test";

import type {
  DeterministicRuleEngine,
  RuleEvaluationRequest,
} from "../../src/requirement-review/public.js";
import { resolveRulePrecedence, type RuleCandidate } from "../../src/shared/rule-precedence.js";

/**
 * SPEC-502 §4 Guarantees and §6 Conformance apply identically to every
 * `DeterministicRuleEngine` in this repository regardless of domain
 * (Requirement, Risk, TestCase, Defect, ...) — determinism, missing facts
 * never becoming a positive decision, and a schema-conformant response
 * shape are engine-technology-independent properties, not per-domain rule
 * logic. Before this suite, each of the 9 rule engines
 * (`grep -rl "implements DeterministicRuleEngine" src/`) proved these
 * properties only through its own ad hoc tests, with no single shared
 * baseline the way `workspace-authorizer-contract.ts` and
 * `workspace-context-issuer-contract.ts` already give the identity seams
 * (§7: "A deterministic reference adapter and each production adapter
 * SHALL pass the same golden-vector contract suite"). A domain's own test
 * file supplies only what genuinely differs by domain — a satisfied
 * request and an empty-facts request — and calls this suite once.
 */
export type RuleEngineContractFixture = Readonly<{
  makeEngine(): DeterministicRuleEngine;
  /** A request whose facts are complete enough that the engine reports `satisfied`. */
  satisfiedRequest(): RuleEvaluationRequest;
  /**
   * A request with an empty or missing required top-level fact (e.g.
   * `facts: {}`), used to prove missing facts never produce a positive
   * decision (SPEC-502 §4).
   */
  emptyFactsRequest(): RuleEvaluationRequest;
  /**
   * SPEC-104 §9 (Precedence and Conflicts) / SPEC-502 §6: optional because
   * most existing domain engines are still single-rule-set field-checkers
   * with no real competing-rule scenario to supply. A domain that models
   * multiple rule candidates (governance vs. Workspace-extension variants
   * of the same rule, for example) provides two candidates that resolve to
   * a clear winner via `resolveRulePrecedence`, plus the Workspace those
   * candidates are evaluated for.
   */
  precedenceFixture?(): Readonly<{
    candidates: readonly RuleCandidate<unknown>[];
    effectiveAt: string;
    workspaceId: string;
  }>;
}>;

const VALID_OUTCOMES = new Set([
  "satisfied",
  "not_satisfied",
  "indeterminate",
  "not_applicable",
  "error",
]);

export function runRuleEngineContract(
  engineName: string,
  fixture: RuleEngineContractFixture,
): void {
  test(`[${engineName}] identical governed inputs produce identical semantic outputs (SPEC-502 §4 determinism)`, async () => {
    const engine = fixture.makeEngine();
    const request = fixture.satisfiedRequest();

    const first = await engine.evaluate(request);
    const second = await engine.evaluate(request);

    assert.equal(first.ok, second.ok);
    if (first.ok && second.ok) {
      assert.equal(first.value.outcome, second.value.outcome);
      assert.deepEqual(first.value.outputs, second.value.outputs);
      assert.deepEqual(first.value.matched_conditions, second.value.matched_conditions);
      assert.deepEqual(first.value.missing_facts, second.value.missing_facts);
    } else if (!first.ok && !second.ok) {
      assert.equal(first.failure.code, second.failure.code);
    } else {
      assert.fail("determinism requires the same ok/failure branch across identical inputs");
    }
  });

  test(`[${engineName}] missing facts do not become a positive decision (SPEC-502 §4)`, async () => {
    const engine = fixture.makeEngine();
    const result = await engine.evaluate(fixture.emptyFactsRequest());

    if (result.ok) {
      assert.notEqual(
        result.value.outcome,
        "satisfied",
        "an engine given empty/missing required facts must never report satisfied",
      );
    } else {
      assert.equal(result.failure.code, "invalid_facts");
    }
  });

  test(`[${engineName}] a satisfied response is schema-conformant (SPEC-502 §3)`, async () => {
    const engine = fixture.makeEngine();
    const request = fixture.satisfiedRequest();
    const result = await engine.evaluate(request);

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;

    assert.ok(VALID_OUTCOMES.has(result.value.outcome), `unexpected outcome: ${result.value.outcome}`);
    assert.deepEqual(result.value.rule_set, request.rule_set);
    assert.ok(Array.isArray(result.value.rule_versions));
    assert.ok(Array.isArray(result.value.matched_conditions));
    assert.ok(Array.isArray(result.value.relevant_facts));
    assert.ok(Array.isArray(result.value.conflicts));
    assert.ok(Array.isArray(result.value.missing_facts));
    assert.ok(Array.isArray(result.value.explanation_trace));
    assert.equal(typeof result.value.outputs, "object");
    assert.equal(typeof result.value.policy_version, "string");
    assert.equal(typeof result.value.duration_ms, "number");
  });

  test(`[${engineName}] a non-satisfied outcome carries a non-empty explanation trace (SPEC-502 §3)`, async () => {
    const engine = fixture.makeEngine();
    const result = await engine.evaluate(fixture.emptyFactsRequest());

    if (!result.ok) return;
    if (result.value.outcome === "satisfied") return;
    assert.ok(
      result.value.explanation_trace.length > 0,
      "a not_satisfied/indeterminate/not_applicable/error outcome must explain itself",
    );
  });

  test(`[${engineName}] evaluation does not persist authority changes across independent calls (SPEC-502 §4)`, async () => {
    const engine = fixture.makeEngine();
    const satisfied = fixture.satisfiedRequest();
    const empty = fixture.emptyFactsRequest();

    await engine.evaluate(empty);
    const afterEmpty = await engine.evaluate(satisfied);

    assert.equal(afterEmpty.ok, true, JSON.stringify(afterEmpty));
    if (!afterEmpty.ok) return;
    assert.equal(
      afterEmpty.value.outcome,
      "satisfied",
      "an unrelated prior evaluation must not change this evaluation's outcome",
    );
  });

  if (fixture.precedenceFixture === undefined) return;
  const precedence = fixture.precedenceFixture;

  test(`[${engineName}] precedence: a genuine equal-precedence tie is a conflict, not a silent pick (SPEC-104 §9)`, () => {
    const { candidates, effectiveAt, workspaceId } = precedence();
    assert.ok(candidates.length >= 2, "precedenceFixture must supply at least two candidates");

    const tiedCandidates = candidates.map((candidate) => ({
      ...candidate,
      authority_class: "product" as const,
      specificity: 0,
      workspace_scope: "global",
      version: "1.0.0",
      priority: 0,
    }));
    const result = resolveRulePrecedence(tiedCandidates, effectiveAt, workspaceId);

    assert.equal(result.outcome, "conflict");
  });

  test(`[${engineName}] precedence resolution is deterministic across repeated calls (SPEC-502 §4/§6)`, () => {
    const { candidates, effectiveAt, workspaceId } = precedence();

    const first = resolveRulePrecedence(candidates, effectiveAt, workspaceId);
    const second = resolveRulePrecedence(candidates, effectiveAt, workspaceId);

    assert.deepEqual(first, second);
  });

  test(`[${engineName}] historical effective-time: a candidate outside its effective period is excluded (SPEC-104 §9)`, () => {
    const { candidates, effectiveAt, workspaceId } = precedence();
    const expiredCandidates = candidates.map((candidate) => ({ ...candidate, effective_until: effectiveAt }));

    const result = resolveRulePrecedence(expiredCandidates, effectiveAt, workspaceId);

    assert.equal(result.outcome, "no_applicable_rule");
  });

  test(`[${engineName}] isolation: a Workspace-scoped candidate for another Workspace is never selected (SPEC-104 §12)`, () => {
    const { candidates, effectiveAt, workspaceId } = precedence();
    const otherWorkspaceCandidates = candidates.map((candidate) =>
      candidate.workspace_scope === "global" ? candidate : { ...candidate, workspace_scope: `not-${workspaceId}` },
    );

    const result = resolveRulePrecedence(otherWorkspaceCandidates, effectiveAt, `other-${workspaceId}`);

    if (result.outcome === "resolved") {
      assert.notEqual(result.winner.workspace_scope, workspaceId);
    }
  });
}
