/**
 * Converts a generated `TestCase` (this roadmap's Phase 3) into a
 * `PlaywrightExecutionPlan` (Phase 2) so it can run through
 * `ExecuteBrowserTest`/`PlaywrightExecutionEngine` without a human
 * hand-authoring the plan. This is a pure, deterministic structural
 * translation — it does not reinterpret intent (SPEC-207 §7: "a
 * tool-specific implementation SHALL NOT become a second source of test
 * meaning"). A `TestCase` with no corresponding `TestCaseGeneratedAssertion`
 * (no `expected_text` / url / title / network oracle — see
 * `generate-test-cases.ts`) SHALL NOT be convertible: returning a plan whose
 * `assert` always passes or always fails would silently fabricate a result
 * SPEC-210 §4 forbids.
 */
import type {
  PlaywrightAssertContext,
  PlaywrightExecutionPlan,
  PlaywrightInteractionStep,
} from "../adapters/playwright/playwright-execution-engine.js";
import { networkOracleSatisfied } from "../adapters/playwright/network-oracle.js";
import type { CleanedDomNode } from "../dom-cleaner/public.js";
import type { TestCase, TestCaseGeneratedAssertion } from "./public.js";

export type ToExecutionPlanFailure = Readonly<{
  code: "no_generated_assertion" | "no_navigate_step" | "unsupported_step_action" | "missing_step_target";
  message: string;
}>;

export type ToExecutionPlanResult =
  | Readonly<{ ok: true; value: PlaywrightExecutionPlan }>
  | Readonly<{ ok: false; failure: ToExecutionPlanFailure }>;

export function testCaseToExecutionPlan(
  testCase: TestCase,
  generatedAssertions: readonly TestCaseGeneratedAssertion[],
  /**
   * Real credential/data values keyed by field `accessible_name`, applied
   * only to a `type` step whose generated text is empty (the positive
   * variant — SPEC-207 §6 never invents "correct" data, so the generator
   * always leaves it blank for the caller to supply). A
   * negative/boundary/adversarial step already carries its own fixed
   * probe value and is never overridden here, even if a matching key is
   * present — those values are the test's actual documented intent, not
   * a placeholder.
   */
  fieldValues?: ReadonlyMap<string, string>,
): ToExecutionPlanResult {
  const assertion = generatedAssertions.find((candidate) => candidate.test_case_id === testCase.id);
  if (assertion === undefined) {
    return {
      ok: false,
      failure: {
        code: "no_generated_assertion",
        message: `Test case "${testCase.id}" has no generated assertion (no acceptance criterion declared expected_text) — it cannot be executed unattended.`,
      },
    };
  }

  const navigateStep = testCase.steps.find((step) => step.action === "navigate");
  const url = navigateStep?.input?.["url"];
  if (typeof url !== "string" || url.trim().length === 0) {
    return {
      ok: false,
      failure: { code: "no_navigate_step", message: `Test case "${testCase.id}" has no navigate step with a url.` },
    };
  }

  const steps: PlaywrightInteractionStep[] = [];
  for (const step of testCase.steps) {
    if (step.action === "navigate") continue;
    if (
      step.action !== "type" &&
      step.action !== "click" &&
      step.action !== "select" &&
      step.action !== "wait_for"
    ) {
      return {
        ok: false,
        failure: { code: "unsupported_step_action", message: `Test case "${testCase.id}" step action "${step.action}" has no execution-engine equivalent.` },
      };
    }
    const accessibleName = step.input?.["accessible_name"];
    if (typeof accessibleName !== "string" || accessibleName.trim().length === 0) {
      return {
        ok: false,
        failure: { code: "missing_step_target", message: `Test case "${testCase.id}" has a "${step.action}" step with no accessible_name target.` },
      };
    }
    const accessibleRole = step.input?.["accessible_role"];
    const target = typeof accessibleRole === "string" && accessibleRole.trim().length > 0
      ? { accessible_name: accessibleName, accessible_role: accessibleRole }
      : { accessible_name: accessibleName };

    if (step.action === "click") {
      steps.push({ kind: "click", target });
      continue;
    }
    if (step.action === "wait_for") {
      const timeoutRaw = step.input?.["timeout_ms"];
      const timeout_ms = typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) ? timeoutRaw : undefined;
      steps.push({
        kind: "wait_for",
        target,
        ...(timeout_ms !== undefined ? { timeout_ms } : {}),
      });
      continue;
    }
    if (step.action === "select") {
      const optionLabelsRaw = step.input?.["option_labels"];
      const optionLabels =
        Array.isArray(optionLabelsRaw) &&
        optionLabelsRaw.every((entry) => typeof entry === "string" && entry.trim().length > 0)
          ? optionLabelsRaw.map((entry) => String(entry).trim())
          : undefined;
      const optionLabel = step.input?.["option_label"];
      if (
        (optionLabels === undefined || optionLabels.length === 0) &&
        (typeof optionLabel !== "string" || optionLabel.trim().length === 0)
      ) {
        return {
          ok: false,
          failure: {
            code: "missing_step_target",
            message: `Test case "${testCase.id}" has a select step with no option_label / option_labels.`,
          },
        };
      }
      steps.push({
        kind: "select",
        target,
        option_label:
          typeof optionLabel === "string" && optionLabel.trim().length > 0
            ? optionLabel.trim()
            : optionLabels![0]!,
        ...(optionLabels !== undefined && optionLabels.length > 0 ? { option_labels: optionLabels } : {}),
      });
      continue;
    }
    // A positive-variant `type` step has no literal value (SPEC-207 §6
    // never invents "correct" test data) — it stays an empty string unless
    // the caller supplied one via `fieldValues`. A negative/boundary/
    // adversarial variant carries the generator's own fixed benign probe
    // value (see `generate-test-cases.ts`), which is not invented data
    // but a deliberate, documented test input, and is never overridden.
    const generatedValue = step.input?.["value"];
    const text =
      typeof generatedValue === "string"
        ? generatedValue
        : fieldValues?.get(accessibleName) ?? "";
    steps.push({ kind: "type", target, text });
  }

  const expectedUrl = assertion.expected_url_includes;
  const expectedTitle = assertion.expected_title_includes;
  const expectedNetwork = assertion.expected_network;
  const expectedCount = assertion.expected_result_count;

  if (assertion.expected_text !== undefined) {
    const expectedText = assertion.expected_text;
    return {
      ok: true,
      value: {
        url,
        steps,
        assert: (cleaned: CleanedDomNode, context: PlaywrightAssertContext) =>
          hasText(cleaned, expectedText) &&
          urlTitleOk(context, expectedUrl, expectedTitle) &&
          networkOk(context, expectedNetwork) &&
          countOk(cleaned, expectedCount),
      },
    };
  }

  const forbidden = assertion.forbidden_text ?? [];
  const expectNoDialog = assertion.expect_no_dialog === true;
  return {
    ok: true,
    value: {
      url,
      steps,
      assert: (cleaned: CleanedDomNode, context: PlaywrightAssertContext) =>
        forbidden.every((text) => !hasText(cleaned, text)) &&
        (!expectNoDialog || !context.dialog_triggered) &&
        urlTitleOk(context, expectedUrl, expectedTitle) &&
        networkOk(context, expectedNetwork) &&
        countOk(cleaned, expectedCount),
    },
  };
}

function networkOk(
  context: PlaywrightAssertContext,
  expected: TestCaseGeneratedAssertion["expected_network"],
): boolean {
  if (expected === undefined) return true;
  return networkOracleSatisfied(context.network, expected);
}

function countOk(
  cleaned: CleanedDomNode,
  expected: TestCaseGeneratedAssertion["expected_result_count"],
): boolean {
  if (expected === undefined) return true;
  const count = countMatchingNodes(cleaned, expected.accessible_role, expected.accessible_name_includes);
  switch (expected.relation) {
    case "eq":
      return count === expected.value;
    case "gte":
      return count >= expected.value;
    case "lte":
      return count <= expected.value;
    default:
      return false;
  }
}

function countMatchingNodes(
  node: CleanedDomNode,
  role: string,
  nameIncludes: string | undefined,
): number {
  const roleNorm = role.trim().toLowerCase();
  const needle = nameIncludes?.trim().toLowerCase();
  let total = 0;
  const visit = (current: CleanedDomNode): void => {
    const nodeRole = current.accessible_role?.trim().toLowerCase();
    if (nodeRole === roleNorm) {
      if (needle === undefined || needle.length === 0) {
        total += 1;
      } else if ((current.accessible_name ?? "").toLowerCase().includes(needle)) {
        total += 1;
      }
    }
    for (const child of current.children) visit(child);
  };
  visit(node);
  return total;
}

function urlTitleOk(
  context: PlaywrightAssertContext,
  expectedUrl: string | undefined,
  expectedTitle: string | undefined,
): boolean {
  if (expectedUrl !== undefined && !context.url.includes(expectedUrl)) return false;
  if (expectedTitle !== undefined && !context.title.includes(expectedTitle)) return false;
  return true;
}

function hasText(node: CleanedDomNode, expected: string): boolean {
  if (node.text?.includes(expected) === true) return true;
  return node.children.some((child) => hasText(child, expected));
}
