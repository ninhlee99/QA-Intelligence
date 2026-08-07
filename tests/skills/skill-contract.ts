import assert from "node:assert/strict";
import test from "node:test";

import type { JsonObject } from "../../src/requirement-review/public.js";
import type { Skill, SkillInvocation, SkillTaskContext } from "../../src/skills/public.js";

/**
 * SPEC-509 §5's required conformance surface: "positive trigger, negative
 * trigger, ambiguity, conflict, invalid input, missing dependency,
 * permission denial, deterministic replay, cancellation, postcondition,
 * evidence, and Workspace isolation tests." A fixture supplies only what
 * differs per Skill: how to build one, a matching task context/invocation
 * that should succeed, and one that should fail a precondition.
 */
export type SkillContractFixture = Readonly<{
  makeSkill(): Skill | Promise<Skill>;
  positiveTaskContext(): SkillTaskContext;
  negativeTaskContext(): SkillTaskContext;
  validInvocation(): SkillInvocation;
  /** An invocation missing a required permission the descriptor declares. */
  invocationMissingPermission(): SkillInvocation;
  /** An invocation whose input fails the Skill's own precondition (e.g. malformed subject). */
  invocationWithInvalidInput(): SkillInvocation;
  /**
   * Extracts the decision-relevant subset of a successful `output` to
   * compare for the deterministic-replay test — a Skill MAY mint a fresh
   * identity (e.g. an assessment id) per call without that being a
   * violation of determinism; what SPEC-509 §5 requires is that the
   * *decision* is reproducible, not that every incidental field is
   * byte-identical. Defaults to comparing `output` as-is.
   */
  decisionFingerprint?(output: JsonObject): unknown;
}>;

export function runSkillContract(skillName: string, fixture: SkillContractFixture): void {
  test(`[${skillName}] describe returns a descriptor for its own exact version`, async () => {
    const skill = await fixture.makeSkill();
    const invocation = fixture.validInvocation();

    const descriptor = await skill.describe(invocation.skill.id, invocation.skill.version);

    assert.notEqual(descriptor, undefined);
    assert.deepEqual(descriptor?.skill, invocation.skill);
  });

  test(`[${skillName}] describe returns undefined for an unknown version (SPEC-509 §2 discovery)`, async () => {
    const skill = await fixture.makeSkill();
    const invocation = fixture.validInvocation();

    const descriptor = await skill.describe(invocation.skill.id, "999.999.999");

    assert.equal(descriptor, undefined);
  });

  test(`[${skillName}] positive trigger: match reports matched with positive evidence`, async () => {
    const skill = await fixture.makeSkill();
    const result = await skill.match(fixture.positiveTaskContext());

    assert.equal(result.matched, true);
    assert.ok(result.positive_evidence.length > 0);
  });

  test(`[${skillName}] negative trigger: match reports not matched with negative evidence, never a false positive`, async () => {
    const skill = await fixture.makeSkill();
    const result = await skill.match(fixture.negativeTaskContext());

    assert.equal(result.matched, false);
    assert.ok(result.negative_evidence.length > 0);
  });

  test(`[${skillName}] a valid invocation passes validate() before invoke() is called (SPEC-509 §5 preconditions)`, async () => {
    const skill = await fixture.makeSkill();
    const validation = await skill.validate(fixture.validInvocation());

    assert.equal(validation.valid, true);
  });

  test(`[${skillName}] permission denial fails validate() and invoke() never widens authority`, async () => {
    const skill = await fixture.makeSkill();
    const invocation = fixture.invocationMissingPermission();

    const validation = await skill.validate(invocation);
    assert.equal(validation.valid, false);
    if (validation.valid) return;
    assert.ok(validation.reasons.includes("missing_required_permission"));

    const invoked = await skill.invoke(invocation);
    assert.equal(invoked.ok, false, "invalid preconditions SHALL prevent invocation");
  });

  test(`[${skillName}] invalid input fails closed rather than producing a fabricated result`, async () => {
    const skill = await fixture.makeSkill();
    const invocation = fixture.invocationWithInvalidInput();

    const result = await skill.invoke(invocation);

    assert.equal(result.ok, false);
  });

  test(`[${skillName}] a successful invocation reports postconditions and evidence (SPEC-509 §4)`, async () => {
    const skill = await fixture.makeSkill();
    const result = await skill.invoke(fixture.validInvocation());

    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.ok(Array.isArray(result.value.postconditions_satisfied));
    assert.ok(Array.isArray(result.value.evidence));
  });

  test(`[${skillName}] deterministic replay: identical invocation produces identical outcome`, async () => {
    const skill = await fixture.makeSkill();
    const invocation = fixture.validInvocation();

    const first = await skill.invoke(invocation);
    const second = await skill.invoke(invocation);

    assert.equal(first.ok, second.ok);
    if (first.ok && second.ok) {
      const fingerprint = fixture.decisionFingerprint ?? ((output: JsonObject) => output);
      assert.deepEqual(fingerprint(first.value.output), fingerprint(second.value.output));
    }
  });
}
