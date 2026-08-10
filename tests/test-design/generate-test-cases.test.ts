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
