import assert from "node:assert/strict";
import test from "node:test";

import { GenerateTestCases, type IdFactory } from "../../src/test-design/generate-test-cases.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";
import type {
  TestCase,
  TestCaseGenerationRequest,
  TestCaseGenerationUiElement,
} from "../../src/test-design/public.js";

const WORKSPACE_ID = "workspace-test-design-binding-001";

class SequenceIds implements IdFactory {
  #testCase = 0;
  #finding = 0;
  next(scope: "test-case" | "finding"): string {
    if (scope === "test-case") return `test-case-${++this.#testCase}`;
    return `finding-${++this.#finding}`;
  }
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["policy:allow-test-design"],
      },
    });
  }
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-001",
    actor_type: "human",
    roles: ["test-designer"],
    permissions: ["test-case:create"],
    policy_version: "test-policy@0.1.0",
    request_id: "request-001",
    correlation_id: "correlation-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T07:00:00.000Z",
    expires_at: "2026-08-07T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "fixture-proof",
  };
}

function baseRequest(
  overrides: Partial<TestCaseGenerationRequest> & { acceptance_criteria: TestCaseGenerationRequest["acceptance_criteria"]; ui_map_elements: readonly TestCaseGenerationUiElement[] },
): TestCaseGenerationRequest {
  return {
    operation_id: "operation-001",
    workspace_id: WORKSPACE_ID,
    context: context(),
    requirement_ref: "REQ-BINDING-001@1.0.0",
    requirement_title: "Binding matcher coverage",
    ui_map_source_url: "https://example.invalid/screen",
    ...overrides,
  };
}

test("does not bind a field name that only appears as a substring of a longer word in the statement", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Passwordless sign-in link is present.", expected_text: "Check your email" },
      ],
      ui_map_elements: [
        { id: "field-password", kind: "field", accessible_name: "Password", accessible_role: "textbox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.test_cases.length, 0, JSON.stringify(result.value.test_cases, null, 2));
  assert.equal(result.value.findings.length, 1);
  assert.equal(result.value.findings[0]!.category, "unbindable_criterion");
});

test("still binds a field name that appears as a whole word in the statement", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Password field accepts the entered value.", expected_text: "Welcome" },
      ],
      ui_map_elements: [
        { id: "field-password", kind: "field", accessible_name: "Password", accessible_role: "textbox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.findings.length, 0, JSON.stringify(result.value.findings, null, 2));
  assert.ok(result.value.test_cases.length > 0);
});

test("escapes regex-special characters in an accessible name instead of throwing or mismatching", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: 'The "Save (draft)" action stores the current form.', expected_text: "Draft saved" },
      ],
      ui_map_elements: [
        { id: "action-save-draft", kind: "action", accessible_name: "Save (draft)", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.findings.length, 0, JSON.stringify(result.value.findings, null, 2));
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive, "expected the Save (draft) action to bind despite regex-special characters");
});

test("never binds an element with an empty or undefined accessible name", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [{ id: "AC-1", statement: "Something happens.", expected_text: "Done" }],
      ui_map_elements: [
        { id: "field-unnamed", kind: "field", accessible_name: "", accessible_role: "textbox", interaction_hint: "editable" },
        { id: "action-unnamed", kind: "action", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.test_cases.length, 0);
  assert.equal(result.value.findings[0]!.category, "unbindable_criterion");
});

test("always generates empty/whitespace/unicode edge-case variants for a bindable, expected_text-bearing criterion", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Nickname field accepts the entered value.", expected_text: "Welcome" },
      ],
      ui_map_elements: [
        { id: "field-nickname", kind: "field", accessible_name: "Nickname", accessible_role: "textbox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const generated: readonly TestCase[] = result.value.test_cases;
  for (const kind of ["empty", "whitespace", "unicode"] as const) {
    const cases = generated.filter((testCase) => testCase.tags?.includes(kind));
    assert.equal(cases.length, 1, `expected exactly one ${kind} case`);
  }
});

test("generates a type_confusion variant only for a field whose accessible name looks numeric", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Age field and the Nickname field accept the entered values.", expected_text: "Welcome" },
      ],
      ui_map_elements: [
        { id: "field-age", kind: "field", accessible_name: "Age", accessible_role: "textbox", interaction_hint: "editable" },
        { id: "field-nickname", kind: "field", accessible_name: "Nickname", accessible_role: "textbox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const typeConfusionCases = result.value.test_cases.filter((testCase) => testCase.tags?.includes("type_confusion"));
  assert.equal(typeConfusionCases.length, 1, "type_confusion SHALL be generated only for the numeric-looking Age field, not Nickname");
  const injectedField = typeConfusionCases[0]!.steps.find((step) => step.action === "type" && (step.input as Record<string, string>)["value"] !== undefined);
  assert.equal(injectedField?.input?.["accessible_name"], "Age");
});

test("generates one test case per adversarial probe, each asserting absence of exactly the value it injected", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Comment field accepts the entered value.", expected_text: "Welcome" },
      ],
      ui_map_elements: [
        { id: "field-comment", kind: "field", accessible_name: "Comment", accessible_role: "textbox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const generated: readonly TestCase[] = result.value.test_cases;
  const assertions = result.value.generated_assertions;
  const adversarialCases = generated.filter((testCase) => testCase.tags?.includes("adversarial"));
  assert.equal(adversarialCases.length, 4, "expected one case per adversarial probe");

  const injectedValues = new Set<string>();
  for (const testCase of adversarialCases) {
    const typeStep = testCase.steps.find((step) => step.action === "type" && (step.input as Record<string, string>)["value"] !== undefined);
    const injected = (typeStep?.input as Record<string, string> | undefined)?.["value"];
    assert.ok(injected, `expected ${testCase.id} to have injected a value`);
    injectedValues.add(injected!);

    const assertion = assertions.find((candidate) => candidate.test_case_id === testCase.id);
    assert.ok(assertion, `expected a generated assertion for ${testCase.id}`);
    assert.equal(assertion!.forbidden_text?.[0], injected, "forbidden_text SHALL assert absence of exactly the value that was injected");
  }
  assert.equal(injectedValues.size, 4, "each adversarial case SHALL inject a distinct probe value, not the same one repeated");
});

test("reports ambiguous_criterion instead of silently binding when two same-kind, same-name fields differ in accessible_role", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC-1", statement: "The Date field accepts the entered value.", expected_text: "Welcome" },
      ],
      ui_map_elements: [
        { id: "field-date-textbox", kind: "field", accessible_name: "Date", accessible_role: "textbox", interaction_hint: "editable" },
        { id: "field-date-combobox", kind: "field", accessible_name: "Date", accessible_role: "combobox", interaction_hint: "editable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.test_cases.length, 0, "no test case SHALL be fabricated against an ambiguous binding");
  assert.equal(result.value.findings.length, 1);
  assert.equal(result.value.findings[0]!.category, "ambiguous_criterion");
});

test("copies AC url/title/network oracles onto the positive generated_assertion only", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "The Sign in action authenticates the user.",
          expected_text: "Welcome",
          expected_url_includes: "/home",
          expected_title_includes: "Home",
          expected_network: {
            url_includes: "/api/login",
            method: "POST",
            status: 200,
            body_includes: "token",
          },
        },
      ],
      ui_map_elements: [
        { id: "action-sign-in", kind: "action", accessible_name: "Sign in", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive);
  const assertion = result.value.generated_assertions.find((a) => a.test_case_id === positive!.id);
  assert.ok(assertion);
  assert.equal(assertion!.expected_text, "Welcome");
  assert.equal(assertion!.expected_url_includes, "/home");
  assert.equal(assertion!.expected_title_includes, "Home");
  assert.deepEqual(assertion!.expected_network, {
    url_includes: "/api/login",
    method: "POST",
    status: 200,
    body_includes: "token",
  });
});

test("network-only AC (no expected_text) still yields an executable positive assertion", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "The Sign in action posts credentials.",
          expected_network: { url_includes: "/api/login", method: "POST", status: [200, 201] },
        },
      ],
      ui_map_elements: [
        { id: "action-sign-in", kind: "action", accessible_name: "Sign in", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.findings.filter((f) => f.category === "missing_expected_result").length, 0);
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive);
  const assertion = result.value.generated_assertions.find((a) => a.test_case_id === positive!.id);
  assert.ok(assertion);
  assert.equal(assertion!.expected_text, undefined);
  assert.deepEqual(assertion!.expected_network, {
    url_includes: "/api/login",
    method: "POST",
    status: [200, 201],
  });
});

test("AC with neither expected_text nor richer oracles still reports missing_expected_result", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [{ id: "AC-1", statement: "The Sign in action works." }],
      ui_map_elements: [
        { id: "action-sign-in", kind: "action", accessible_name: "Sign in", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.generated_assertions.length, 0);
  assert.equal(result.value.findings[0]!.category, "missing_expected_result");
});

test("emits select steps for selectable fields when AC supplies option_label", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "The Country field and the Save action store the selection.",
          expected_text: "Saved",
          option_label: "Vietnam",
        },
      ],
      ui_map_elements: [
        { id: "field-country", kind: "field", accessible_name: "Country", accessible_role: "combobox", interaction_hint: "selectable" },
        { id: "action-save", kind: "action", accessible_name: "Save", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive);
  const selectStep = positive!.steps.find((step) => step.action === "select");
  assert.deepEqual(selectStep?.input, {
    accessible_name: "Country",
    accessible_role: "combobox",
    option_label: "Vietnam",
  });
  assert.equal(positive!.steps.some((step) => step.action === "type"), false);
});

test("selectable field without option_label reports missing_option_label and does not invent a select", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "The Country field accepts a selection.",
          expected_text: "Saved",
        },
      ],
      ui_map_elements: [
        { id: "field-country", kind: "field", accessible_name: "Country", accessible_role: "combobox", interaction_hint: "selectable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.value.findings.some((f) => f.category === "missing_option_label"));
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive);
  assert.equal(positive!.steps.some((step) => step.action === "select"), false);
});

test("emits wait_for after click when AC declares wait_for_accessible_name", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        {
          id: "AC-1",
          statement: "The Sign in action shows the dashboard.",
          expected_text: "Dashboard",
          wait_for_accessible_name: "Dashboard heading",
          wait_for_accessible_role: "heading",
          wait_for_timeout_ms: 5_000,
        },
      ],
      ui_map_elements: [
        { id: "action-sign-in", kind: "action", accessible_name: "Sign in", accessible_role: "button", interaction_hint: "clickable" },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const positive = result.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive);
  const waitStep = positive!.steps.find((step) => step.action === "wait_for");
  assert.deepEqual(waitStep?.input, {
    accessible_name: "Dashboard heading",
    accessible_role: "heading",
    timeout_ms: 5_000,
  });
  const clickIdx = positive!.steps.findIndex((step) => step.action === "click");
  const waitIdx = positive!.steps.findIndex((step) => step.action === "wait_for");
  assert.ok(clickIdx >= 0 && waitIdx > clickIdx);
});

test("emits possible_auth_required when unbindable ACs hit a login-like surface", async () => {
  const generator = new GenerateTestCases({ authorizer: new AllowingAuthorizer(), ids: new SequenceIds() });

  const result = await generator.generate(
    baseRequest({
      acceptance_criteria: [
        { id: "AC1", statement: "キーワード field finds matching resumes.", expected_text: "件" },
      ],
      ui_map_elements: [
        { id: "field-user", kind: "field", accessible_name: "ユーザー名", accessible_role: "textbox", interaction_hint: "editable" },
        { id: "field-pass", kind: "field", accessible_name: "パスワード", accessible_role: "textbox", interaction_hint: "editable" },
        { id: "action-login", kind: "action", accessible_name: "ログイン", accessible_role: "button", interaction_hint: "clickable" },
      ],
      ui_map_source_url: "https://example.invalid/login",
    }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.test_cases.length, 0);
  assert.ok(result.value.findings.some((f) => f.category === "possible_auth_required"));
  assert.ok(
    result.value.findings.some(
      (f) => f.category === "unbindable_criterion" && f.message.includes("login/public gate"),
    ),
  );
});
