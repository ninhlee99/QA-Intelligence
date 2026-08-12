/**
 * SPEC-207 Test Design tracer bullet (Phase 3,
 * docs/proposals/professional-qa-mcp-roadmap.md). Deterministic only — no
 * Reasoning Provider — per ADR-002 (rule engine before LLM): a criterion
 * this module cannot bind to a discovered Semantic UI element (this
 * roadmap's Phase 1) becomes a `TestCaseGenerationFinding`, never a
 * fabricated step or assertion (SPEC-207 §6). Generated steps use Phase 2's
 * semantic interaction vocabulary (accessible name/role), so a generated
 * `TestCase` can be handed straight to `ExecuteBrowserTest` without a human
 * hand-authoring a `PlaywrightExecutionPlan`.
 *
 * Per SPEC-207 §4/§3 ("normal, alternate, boundary, and failure behavior
 * SHALL be considered"), a bindable criterion with an executable oracle
 * (`expected_text` and/or url/title/network) produces up to four
 * `TestCaseVariant`s per editable field when `expected_text` is present
 * (negatives invert that text). Richer oracles copy from the AC onto the
 * positive assertion only — never invented.
 */
import type {
  JsonObject,
  JsonValue,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";
import { isJsonObject, readString } from "../shared/rule-engine-support.js";
import type {
  GenerateTestCasesResult,
  TestCase,
  TestCaseExpectedResult,
  TestCaseGeneratedAssertion,
  TestCaseGenerationFinding,
  TestCaseGenerationRequest,
  TestCaseGenerationUiElement,
  TestCaseStep,
  TestCaseVariant,
} from "./public.js";

type CriterionOracles = Readonly<{
  expected_url_includes?: string;
  expected_title_includes?: string;
  expected_network?: NonNullable<TestCaseGeneratedAssertion["expected_network"]>;
}>;

type CriterionInteractionHints = Readonly<{
  option_label?: string;
  wait_for_accessible_name?: string;
  wait_for_accessible_role?: string;
  wait_for_timeout_ms?: number;
}>;

export interface IdFactory {
  next(scope: "test-case" | "finding"): string;
}

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  ids: IdFactory;
}>;

const BOUNDARY_VALUE = "x".repeat(300);
const SYSTEM_ERROR_MARKERS: readonly string[] = ["stack trace", "exception", "internal server error", "traceback"];

const EDGE_CASE_VALUES: Readonly<Record<"empty" | "whitespace" | "unicode", string>> = {
  empty: "",
  whitespace: "   ",
  unicode: "テスト🎉ñ",
};

const NUMERIC_FIELD_NAME_PATTERN = /\b(age|amount|quantity|qty|price|count|number|num|total|balance)\b/i;

/** `type_confusion` is only generated when a field's own accessible name signals a numeric expectation — never fabricated for a field with no such signal (SPEC-207 §6). */
function looksNumeric(accessibleName: string | undefined): boolean {
  return accessibleName !== undefined && NUMERIC_FIELD_NAME_PATTERN.test(accessibleName);
}

/**
 * Fixed, benign probe values (SPEC-207 §4 error guessing/boundary
 * analysis) — standard input-validation probes, inert unless the
 * application fails to escape output, which is exactly the bug each
 * probe checks for. No payload here is destructive, carries a callback,
 * or attempts real code execution beyond a harmless `alert(1)` marker a
 * correctly-escaping page will never run.
 *
 * `<img src=x onerror=alert(1)>` is used rather than `<script>alert(1)</script>`
 * because the DOM spec deliberately never executes a `<script>` tag
 * inserted via `innerHTML` (in any browser) — using it as the probe would
 * make this variant unable to ever catch a real `innerHTML`-based XSS bug,
 * silently passing every vulnerable page. `onerror` on a broken image *does*
 * fire through `innerHTML`, which is why it is the standard XSS test vector
 * for exactly this class of bug.
 *
 * Each probe becomes its own test case (one value injected, that exact
 * value asserted absent) — never a shared forbidden-list where most
 * entries were never actually submitted, which would make the assertion
 * vacuously true for anything but the one value actually injected.
 * `MAX_ADVERSARIAL_PROBES_PER_FIELD` caps how many of these run per field
 * so this list can grow without unboundedly multiplying test case count.
 */
const ADVERSARIAL_PROBES: readonly Readonly<{ id: string; value: string }>[] = [
  { id: "xss-onerror-img", value: "<img src=x onerror=alert(1)>" },
  { id: "sqli-or-1-1", value: "' OR '1'='1" },
  { id: "path-traversal", value: "../../../../etc/passwd" },
  { id: "command-injection", value: "; ls -la" },
];
const MAX_ADVERSARIAL_PROBES_PER_FIELD = ADVERSARIAL_PROBES.length;

type NonAdversarialPerturbationVariant = Exclude<TestCaseVariant, "positive" | "adversarial">;

type VariantSpec = Readonly<{
  value: string;
  assertionText(fieldName: string | undefined, expectedText: string): string;
  forbidden(expectedText: string): readonly string[];
}>;

const VARIANT_SPECS: Readonly<Record<NonAdversarialPerturbationVariant, VariantSpec>> = {
  negative: {
    value: "wrong-value",
    assertionText: (field, text) => `Submitting an invalid "${field}" value does NOT produce the text "${text}".`,
    forbidden: (text) => [text],
  },
  boundary: {
    value: BOUNDARY_VALUE,
    assertionText: (field) => `Submitting an oversized "${field}" value produces no leaked system-error text.`,
    forbidden: () => [...SYSTEM_ERROR_MARKERS],
  },
  empty: {
    value: EDGE_CASE_VALUES.empty,
    assertionText: (field, text) => `Submitting an empty "${field}" value does NOT produce the text "${text}".`,
    forbidden: (text) => [text],
  },
  whitespace: {
    value: EDGE_CASE_VALUES.whitespace,
    assertionText: (field, text) => `Submitting a whitespace-only "${field}" value does NOT produce the text "${text}".`,
    forbidden: (text) => [text],
  },
  unicode: {
    value: EDGE_CASE_VALUES.unicode,
    assertionText: (field) => `Submitting unicode input into "${field}" produces no leaked system-error text (encoding handled correctly).`,
    forbidden: () => [...SYSTEM_ERROR_MARKERS],
  },
  type_confusion: {
    value: "not-a-number",
    assertionText: (field) => `Submitting a non-numeric value into the numeric-looking field "${field}" produces no leaked system-error text.`,
    forbidden: () => [...SYSTEM_ERROR_MARKERS],
  },
};

/** Deep module: one `generate()` call hides authorization, per-criterion binding, variant expansion, and TestCase assembly. */
export class GenerateTestCases {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async generate(request: TestCaseGenerationRequest): Promise<GenerateTestCasesResult> {
    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "generate test cases",
      consequence_class: "advisory",
      // Only `test-case:create` — this Skill receives acceptance criteria
      // as already-resolved input (either from a governed Requirement or
      // inline caller intent); it never reads a Requirement itself, so it
      // has no business requiring `requirement:read` (that permission, if
      // needed, is the caller/executor's concern before this Skill runs).
      required_permissions: ["test-case:create"],
      resource_refs: [`workspace:${request.workspace_id}`, request.requirement_ref],
    });
    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }

    if (request.acceptance_criteria.length === 0) {
      return {
        ok: true,
        value: {
          schema_version: "1.0.0",
          workspace_id: request.workspace_id,
          requirement_ref: request.requirement_ref,
          test_cases: [],
          findings: [
            {
              id: this.#dependencies.ids.next("finding"),
              category: "no_acceptance_criteria",
              message: "The requirement has no acceptance criteria to generate test cases from.",
              evidence: [request.requirement_ref],
            },
          ],
          generated_assertions: [],
        },
      };
    }

    const fields = request.ui_map_elements.filter((element) => element.kind === "field");
    const actions = request.ui_map_elements.filter((element) => element.kind === "action");

    const testCases: TestCase[] = [];
    const findings: TestCaseGenerationFinding[] = [];
    const generatedAssertions: TestCaseGeneratedAssertion[] = [];

    for (const criterion of request.acceptance_criteria) {
      const criterionId = readString(criterion, "id") ?? "unknown-criterion";
      const statement = readString(criterion, "statement");
      if (statement === undefined) {
        findings.push({
          id: this.#dependencies.ids.next("finding"),
          category: "unbindable_criterion",
          message: `Acceptance criterion "${criterionId}" has no statement text to bind against the discovered UI.`,
          evidence: [`${request.requirement_ref}#${criterionId}`],
        });
        continue;
      }

      const matchedAction = actions.find((element) => statementMentionsName(statement, element.accessible_name));
      const matchedFields = fields.filter((element) => statementMentionsName(statement, element.accessible_name));

      if (matchedAction === undefined && matchedFields.length === 0) {
        const authHint = looksLikeLoginSurface(fields, actions, request.ui_map_source_url)
          ? " Discovered UI looks like a login/public gate — page may require auth; prefer generate_test_cases with login_* fields or discover_ui_surface_after_login first (not an AC wording bug)."
          : "";
        findings.push({
          id: this.#dependencies.ids.next("finding"),
          category: "unbindable_criterion",
          message: `No discovered UI element (field or action) matches acceptance criterion "${criterionId}": "${statement}". A test case was not fabricated.${authHint}`,
          evidence: [`${request.requirement_ref}#${criterionId}`, `ui-map:${request.ui_map_source_url}`],
        });
        continue;
      }

      if (hasRoleAmbiguity(matchedFields)) {
        findings.push({
          id: this.#dependencies.ids.next("finding"),
          category: "ambiguous_criterion",
          message: `Acceptance criterion "${criterionId}" name-matches multiple fields with different accessible roles: "${statement}". A test case was not fabricated against an ambiguous binding.`,
          evidence: [`${request.requirement_ref}#${criterionId}`, `ui-map:${request.ui_map_source_url}`],
        });
        continue;
      }

      const editableFields = matchedFields.filter((field) => field.interaction_hint === "editable");
      const selectableFields = matchedFields.filter((field) => field.interaction_hint === "selectable");
      const expectedText = readString(criterion, "expected_text");
      const oracles = readCriterionOracles(criterion);
      const interaction = readCriterionInteraction(criterion);

      if (selectableFields.length > 0 && interaction.option_label === undefined) {
        findings.push({
          id: this.#dependencies.ids.next("finding"),
          category: "missing_option_label",
          message: `Acceptance criterion "${criterionId}" binds selectable field(s) but has no option_label — a select step was not invented (SPEC-207 §6).`,
          evidence: [
            `${request.requirement_ref}#${criterionId}`,
            ...selectableFields.map((field) => `ui-element:${field.id}`),
          ],
        });
      }

      const positive = this.#buildCase({
        request,
        criterionId,
        variant: "positive",
        matchedFields,
        matchedAction,
        fieldValues: undefined,
        expectedText,
        oracles,
        interaction,
        variantField: undefined,
        forbiddenOverride: undefined,
      });
      testCases.push(positive.testCase);
      if (positive.assertion !== undefined) generatedAssertions.push(positive.assertion);
      else if (positive.finding !== undefined) findings.push(positive.finding);

      // Negative/boundary/adversarial variants require both a positive
      // expected_text to invert against (otherwise there is nothing
      // authoritative to assert "absent") and at least one editable field
      // to perturb — a pure navigation/click criterion has no input to
      // vary (SPEC-207 §3's "normal, alternate, boundary, and failure
      // behavior" applies per input, not per click). Selectable fields
      // are not perturbed here — option labels are AC-authored, not invented.
      if (expectedText === undefined || editableFields.length === 0) continue;

      for (const field of editableFields) {
        const nonAdversarialVariants: readonly NonAdversarialPerturbationVariant[] = looksNumeric(field.accessible_name)
          ? ["negative", "boundary", "empty", "whitespace", "unicode", "type_confusion"]
          : ["negative", "boundary", "empty", "whitespace", "unicode"];

        for (const variant of nonAdversarialVariants) {
          const spec = VARIANT_SPECS[variant];
          const built = this.#buildCase({
            request,
            criterionId,
            variant,
            matchedFields,
            matchedAction,
            fieldValues: new Map([[field.id, spec.value]]),
            expectedText,
            oracles: undefined,
            interaction,
            variantField: field,
            forbiddenOverride: undefined,
          });
          testCases.push(built.testCase);
          if (built.assertion !== undefined) generatedAssertions.push(built.assertion);
        }

        for (const probe of ADVERSARIAL_PROBES.slice(0, MAX_ADVERSARIAL_PROBES_PER_FIELD)) {
          const built = this.#buildCase({
            request,
            criterionId,
            variant: "adversarial",
            matchedFields,
            matchedAction,
            fieldValues: new Map([[field.id, probe.value]]),
            expectedText,
            oracles: undefined,
            interaction,
            variantField: field,
            forbiddenOverride: [probe.value, ...SYSTEM_ERROR_MARKERS],
          });
          testCases.push(built.testCase);
          if (built.assertion !== undefined) generatedAssertions.push(built.assertion);
        }
      }
    }

    if (
      testCases.length === 0 &&
      findings.some((f) => f.category === "unbindable_criterion") &&
      looksLikeLoginSurface(fields, actions, request.ui_map_source_url)
    ) {
      findings.unshift({
        id: this.#dependencies.ids.next("finding"),
        category: "possible_auth_required",
        message:
          "Discovered surface looks like a login/public gate (password field and/or login URL) while no AC bound. Target page likely needs auth — supply login_url + username_field_name + username + password_field_name + password + submit_action_name on generate_test_cases, or call discover_ui_surface_after_login / run_auto_qa with login first.",
        evidence: [`ui-map:${request.ui_map_source_url}`, ...namedControlEvidence(fields, actions)],
      });
    }

    return {
      ok: true,
      value: {
        schema_version: "1.0.0",
        workspace_id: request.workspace_id,
        requirement_ref: request.requirement_ref,
        test_cases: testCases,
        findings,
        generated_assertions: generatedAssertions,
      },
    };
  }

  #buildCase(input: Readonly<{
    request: TestCaseGenerationRequest;
    criterionId: string;
    variant: TestCaseVariant;
    matchedFields: readonly TestCaseGenerationUiElement[];
    matchedAction: TestCaseGenerationUiElement | undefined;
    fieldValues: ReadonlyMap<string, string> | undefined;
    expectedText: string | undefined;
    /** Positive only — copied from AC; never invented. */
    oracles: CriterionOracles | undefined;
    interaction: CriterionInteractionHints;
    variantField: TestCaseGenerationUiElement | undefined;
    /** Set only for `adversarial` — the specific probe's own value plus system-error markers, never the whole probe list (see `ADVERSARIAL_PROBES`'s doc comment on why). */
    forbiddenOverride: readonly string[] | undefined;
  }>): Readonly<{ testCase: TestCase; assertion: TestCaseGeneratedAssertion | undefined; finding: TestCaseGenerationFinding | undefined }> {
    const {
      request,
      criterionId,
      variant,
      matchedFields,
      matchedAction,
      fieldValues,
      expectedText,
      oracles,
      interaction,
      variantField,
      forbiddenOverride,
    } = input;
    const testCaseId = this.#dependencies.ids.next("test-case");

    const steps: TestCaseStep[] = [{ action: "navigate", input: { url: request.ui_map_source_url } }];
    for (const field of matchedFields) {
      if (field.interaction_hint === "selectable") {
        // Never invent option labels (SPEC-207 §6). Missing label already
        // recorded as missing_option_label; skip the step here.
        if (interaction.option_label === undefined) continue;
        steps.push({
          action: "select",
          input: {
            accessible_name: field.accessible_name ?? "",
            accessible_role: field.accessible_role ?? "",
            option_label: interaction.option_label,
          },
        });
        continue;
      }
      // Only editable (or unspecified field hints treated as type targets)
      // receive type steps — selectable handled above.
      if (field.interaction_hint !== undefined && field.interaction_hint !== "editable") continue;
      const value = fieldValues?.get(field.id);
      steps.push({
        action: "type",
        input: {
          accessible_name: field.accessible_name ?? "",
          accessible_role: field.accessible_role ?? "",
          ...(value !== undefined ? { value } : {}),
        },
      });
    }
    if (matchedAction !== undefined) {
      steps.push({
        action: "click",
        input: { accessible_name: matchedAction.accessible_name ?? "", accessible_role: matchedAction.accessible_role ?? "" },
      });
    }
    if (interaction.wait_for_accessible_name !== undefined) {
      steps.push({
        action: "wait_for",
        input: {
          accessible_name: interaction.wait_for_accessible_name,
          ...(interaction.wait_for_accessible_role !== undefined
            ? { accessible_role: interaction.wait_for_accessible_role }
            : {}),
          ...(interaction.wait_for_timeout_ms !== undefined
            ? { timeout_ms: interaction.wait_for_timeout_ms }
            : {}),
        },
      });
    }

    let assertionText: string;
    let assertion: TestCaseGeneratedAssertion | undefined;
    let finding: TestCaseGenerationFinding | undefined;

    if (variant === "positive") {
      if (hasExecutableOracle(expectedText, oracles)) {
        assertionText =
          expectedText !== undefined
            ? `After the step sequence, the page contains the text "${expectedText}".`
            : `After the step sequence, declared UI/API oracles for "${criterionId}" hold.`;
        assertion = withOracles(
          {
            test_case_id: testCaseId,
            ...(expectedText !== undefined ? { expected_text: expectedText } : {}),
          },
          oracles,
        );
      } else {
        assertionText =
          matchedAction !== undefined
            ? `The "${matchedAction.accessible_name}" action completes without a governed failure outcome.`
            : `The discovered field(s) accept the input required by "${criterionId}".`;
        finding = {
          id: this.#dependencies.ids.next("finding"),
          category: "missing_expected_result",
          message: `Acceptance criterion "${criterionId}" has no expected_text / expected_url_includes / expected_title_includes / expected_network, so no executable assertion was generated for test case "${testCaseId}" — it cannot run unattended until one is supplied or a human authors a plan.`,
          evidence: [`${request.requirement_ref}#${criterionId}`, `test-case:${testCaseId}`],
        };
      }
    } else if (variant === "adversarial") {
      // expectedText and forbiddenOverride are guaranteed defined here
      // (caller only builds this variant with a specific probe's own
      // forbidden list — see ADVERSARIAL_PROBES's doc comment).
      assertionText = `Submitting an injection/XSS probe into "${variantField?.accessible_name}" is not reflected unescaped, does not execute (no dialog fires), and produces no leaked system-error text.`;
      assertion = {
        test_case_id: testCaseId,
        forbidden_text: forbiddenOverride as readonly string[],
        expect_no_dialog: true,
      };
    } else {
      // expectedText is guaranteed defined here (caller only builds these
      // variants when it is).
      const spec = VARIANT_SPECS[variant];
      assertionText = spec.assertionText(variantField?.accessible_name, expectedText as string);
      assertion = {
        test_case_id: testCaseId,
        forbidden_text: spec.forbidden(expectedText as string),
      };
    }

    const expectedResults: TestCaseExpectedResult[] = [
      { assertion: assertionText, authority: `${request.requirement_ref}#${criterionId}` },
    ];

    const testCase: TestCase = {
      id: testCaseId,
      version: "1.0.0",
      status: "draft",
      purpose:
        variant === "positive"
          ? `Validate acceptance criterion "${criterionId}" of ${request.requirement_title}.`
          : `Validate acceptance criterion "${criterionId}" of ${request.requirement_title} under a ${variant} input on "${variantField?.accessible_name}".`,
      traceability: [request.requirement_ref, `${request.requirement_ref}#${criterionId}`],
      preconditions: [`Semantic UI Map available for ${request.ui_map_source_url}`],
      workspace_scope: request.workspace_id,
      steps,
      expected_results: expectedResults,
      owner: "test-design-generator",
      priority: variant === "positive" ? "medium" : "high",
      tags: ["generated", "tracer-bullet", variant],
    };

    return { testCase, assertion, finding };
  }
}

/**
 * Word-boundary match, not raw substring — a field named "Password" must
 * not spuriously bind a statement containing "Passwordless" (or any other
 * superstring). Uses alphanumeric lookaround rather than `\b` because `\b`
 * only fires at a word/non-word transition: an accessible name ending in a
 * non-word character (e.g. "Save (draft)") has no such transition at its
 * own boundary, so `\b` would silently fail to match there.
 * `accessibleName` is escaped before use in the RegExp since it's
 * arbitrary UI text, not a pattern.
 */
function statementMentionsName(statement: string, accessibleName: string | undefined): boolean {
  if (accessibleName === undefined || accessibleName.trim().length === 0) return false;
  const escaped = accessibleName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "i").test(statement);
}

/**
 * Two discovered fields sharing an accessible_name but differing in
 * accessible_role (e.g. one "Date" field is a textbox, another "Date"
 * field is a combobox) cannot be safely disambiguated by name-matching
 * alone — silently picking one via `.filter()` order would fabricate a
 * binding decision this module has no basis for (SPEC-207 §6: never
 * fabricate). `matchedAction` needs no equivalent check: `actions.find()`
 * already resolves to a single candidate by construction.
 */
function hasRoleAmbiguity(matches: readonly TestCaseGenerationUiElement[]): boolean {
  const roles = new Set(matches.map((match) => match.accessible_role).filter((role): role is string => role !== undefined));
  return roles.size > 1;
}

const LOGIN_URL_RE = /\/(login|signin|sign-in|sessions?|auth)\b/i;
const PASSWORD_NAME_RE = /password|passwd|パスワード/i;
const USERNAME_NAME_RE = /username|user\s*name|ユーザー名|email|ログインID|login\s*id/i;
const LOGIN_ACTION_RE = /sign\s*in|log\s*in|ログイン|ログインする/i;

function looksLikeLoginSurface(
  fields: readonly TestCaseGenerationUiElement[],
  actions: readonly TestCaseGenerationUiElement[],
  sourceUrl: string,
): boolean {
  if (LOGIN_URL_RE.test(sourceUrl)) return true;
  const fieldNames = fields.map((el) => el.accessible_name?.trim() ?? "").filter((n) => n.length > 0);
  const actionNames = actions.map((el) => el.accessible_name?.trim() ?? "").filter((n) => n.length > 0);
  const hasPassword = fieldNames.some((n) => PASSWORD_NAME_RE.test(n));
  const hasUsername = fieldNames.some((n) => USERNAME_NAME_RE.test(n));
  const hasLoginAction = actionNames.some((n) => LOGIN_ACTION_RE.test(n));
  // Password alone is common on non-login forms; require a second login signal.
  return hasPassword && (hasUsername || hasLoginAction);
}

function namedControlEvidence(
  fields: readonly TestCaseGenerationUiElement[],
  actions: readonly TestCaseGenerationUiElement[],
): string[] {
  const names = [...fields, ...actions]
    .map((el) => el.accessible_name?.trim())
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .slice(0, 12);
  return names.map((n) => `discovered:${n}`);
}

function readCriterionOracles(criterion: JsonObject): CriterionOracles {
  const expected_url_includes = readString(criterion, "expected_url_includes");
  const expected_title_includes = readString(criterion, "expected_title_includes");
  const expected_network = readExpectedNetwork(criterion["expected_network"]);
  return {
    ...(expected_url_includes !== undefined ? { expected_url_includes } : {}),
    ...(expected_title_includes !== undefined ? { expected_title_includes } : {}),
    ...(expected_network !== undefined ? { expected_network } : {}),
  };
}

function readCriterionInteraction(criterion: JsonObject): CriterionInteractionHints {
  const option_label = readString(criterion, "option_label");
  const wait_for_accessible_name = readString(criterion, "wait_for_accessible_name");
  const wait_for_accessible_role = readString(criterion, "wait_for_accessible_role");
  const timeoutRaw = criterion["wait_for_timeout_ms"];
  const wait_for_timeout_ms =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? timeoutRaw
      : undefined;
  return {
    ...(option_label !== undefined ? { option_label } : {}),
    ...(wait_for_accessible_name !== undefined ? { wait_for_accessible_name } : {}),
    ...(wait_for_accessible_role !== undefined ? { wait_for_accessible_role } : {}),
    ...(wait_for_timeout_ms !== undefined ? { wait_for_timeout_ms } : {}),
  };
}

function readExpectedNetwork(value: JsonValue | undefined): CriterionOracles["expected_network"] | undefined {
  if (!isJsonObject(value)) return undefined;
  const url_includes = readString(value, "url_includes");
  if (url_includes === undefined || url_includes.trim().length === 0) return undefined;
  const method = readString(value, "method");
  const body_includes = readString(value, "body_includes");
  const status = readNetworkStatus(value["status"]);
  return {
    url_includes,
    ...(method !== undefined ? { method } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(body_includes !== undefined ? { body_includes } : {}),
  };
}

function readNetworkStatus(value: JsonValue | undefined): number | readonly number[] | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const statuses: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) return undefined;
    statuses.push(entry);
  }
  return statuses;
}

function hasExecutableOracle(expectedText: string | undefined, oracles: CriterionOracles | undefined): boolean {
  if (expectedText !== undefined) return true;
  if (oracles === undefined) return false;
  return (
    oracles.expected_url_includes !== undefined ||
    oracles.expected_title_includes !== undefined ||
    oracles.expected_network !== undefined
  );
}

function withOracles(
  base: TestCaseGeneratedAssertion,
  oracles: CriterionOracles | undefined,
): TestCaseGeneratedAssertion {
  if (oracles === undefined) return base;
  return {
    ...base,
    ...(oracles.expected_url_includes !== undefined ? { expected_url_includes: oracles.expected_url_includes } : {}),
    ...(oracles.expected_title_includes !== undefined ? { expected_title_includes: oracles.expected_title_includes } : {}),
    ...(oracles.expected_network !== undefined ? { expected_network: oracles.expected_network } : {}),
  };
}
