import assert from "node:assert/strict";
import test from "node:test";

import { openApiToApiSmokeCases } from "../../src/api-testing/openapi-to-smoke-cases.js";
import { formatDefectsForTracker } from "../../src/bug-analysis/format-defects-for-tracker.js";
import { compareUiSurfaces } from "../../src/discovery/compare-ui-surfaces.js";
import { InMemoryRegressionSuiteRegistry } from "../../src/test-design/regression-suite-registry.js";
import { InMemoryRequirementResolver } from "../../src/adapters/memory/requirement-resolver.js";
import type { WorkspaceAuthorizer } from "../../src/requirement-review/public.js";
import type { Defect } from "../../src/bug-analysis/public.js";

const allowing: WorkspaceAuthorizer = {
  authorize: async (request) => ({
    ok: true,
    value: {
      policy_version: request.context.policy_version,
      effective_permissions: [...request.required_permissions],
      authorized_resource_refs: [...request.resource_refs],
      decision_evidence: ["allow"],
    },
  }),
};

test("requirement resolver register + list", async () => {
  const resolver = new InMemoryRequirementResolver("ws-1", [], allowing);
  const registered = resolver.register({
    id: "REQ-NEW",
    version: "1.0.0",
    status: "draft",
    title: "Can reset password",
    statement: "User SHALL reset password with email link.",
    source: ["doc"],
    owner: "po",
    capability_id: "Auth",
    scope: { workspace_id: "ws-1" },
    acceptance_criteria: [{ id: "AC-1", statement: "Email is sent." }],
    traceability: [],
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.equal(registered.ref, "REQ-NEW@1.0.0");
  assert.equal(resolver.list().length, 1);
});

test("openApiToApiSmokeCases picks documented statuses", () => {
  const result = openApiToApiSmokeCases({
    openapi: "3.0.0",
    paths: {
      "/health": {
        get: { operationId: "health", responses: { "200": { description: "ok" } } },
      },
      "/items": {
        post: { responses: { "201": { description: "created" } } },
      },
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.cases.length, 2);
  assert.equal(result.cases[0]?.expect.status, 200);
  assert.equal(result.cases[1]?.expect.status, 201);
});

test("openApiToApiSmokeCases can add authz negatives for secured ops", () => {
  const result = openApiToApiSmokeCases(
    {
      openapi: "3.0.0",
      security: [{ bearerAuth: [] }],
      paths: {
        "/me": {
          get: {
            operationId: "me",
            responses: { "200": { description: "ok" }, "401": { description: "unauth" } },
          },
        },
      },
    },
    { include_authz_negatives: true },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.cases.some((c) => c.id === "me"));
  const unauth = result.cases.find((c) => c.id === "me-unauth");
  assert.ok(unauth);
  assert.deepEqual(unauth?.expect.status, 401);
});

test("compareUiSurfaces reports only-A / only-B", () => {
  const compared = compareUiSurfaces({
    label_a: "admin",
    label_b: "viewer",
    elements_a: [
      { id: "1", kind: "action", accessible_name: "Delete", source_node_id: "n1", confidence: 1 },
      { id: "2", kind: "action", accessible_name: "View", source_node_id: "n2", confidence: 1 },
    ],
    elements_b: [
      { id: "3", kind: "action", accessible_name: "View", source_node_id: "n3", confidence: 1 },
    ],
  });
  assert.ok(compared.only_in_a.some((k) => k.includes("Delete")));
  assert.equal(compared.only_in_b.length, 0);
  assert.ok(compared.shared.some((k) => k.includes("View")));
});

test("formatDefectsForTracker emits markdown", () => {
  const defect = {
    id: "DEF-1",
    version: "0.1.0",
    status: "draft",
    summary: "Login fails",
    observed_behavior: "Error",
    expected_behavior: "Welcome",
    expected_behavior_authority: "REQ-1@1.0.0",
    affected_requirement_refs: ["REQ-1@1.0.0"],
    workspace_scope: "ws-1",
    environment_ref: "staging",
    reproduction_conditions: ["Open login"],
    evidence: ["outcome:failed"],
    severity: "high",
    severity_rationale: "blocks login",
    priority: "p1",
    classification: "product_defect",
    suspected_cause: "validation bug",
    owner: "unassigned",
    related_execution_refs: [],
    related_test_refs: ["TC-1"],
  } as Defect;
  const text = formatDefectsForTracker([defect], "markdown");
  assert.ok(text.includes("Login fails"));
  assert.ok(text.includes("NOT confirmed"));
});

test("regression suite registry stores cases", () => {
  const registry = new InMemoryRegressionSuiteRegistry({ now: () => new Date("2026-08-10T00:00:00.000Z") });
  const registered = registry.register({
    workspace_id: "ws-1",
    label: "smoke",
    cases: [
      {
        kind: "api",
        case: { id: "health", method: "GET", path: "/health", expect: { status: 200 } },
      },
    ],
  });
  assert.equal(registered.ok, true);
  assert.equal(registry.list("ws-1").length, 1);
});
