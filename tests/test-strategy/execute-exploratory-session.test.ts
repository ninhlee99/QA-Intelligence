import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import type { SemanticUiDiscoveryResult, SemanticUiElement } from "../../src/discovery/public.js";
import { ExecuteExploratorySession } from "../../src/test-strategy/execute-exploratory-session.js";
import type {
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: "policy-1",
        effective_permissions: ["discovery:observe"],
        authorized_resource_refs: ["workspace:workspace-explore"],
        decision_evidence: ["policy:allow-explore"],
      },
    });
  }
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-explore",
    actor_id: "tester-1",
    actor_type: "human",
    roles: ["qa-operator"],
    permissions: ["discovery:observe"],
    policy_version: "policy-1",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-10T07:00:00.000Z",
    expires_at: "2026-08-10T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "proof",
  };
}

function elements(overrides: Partial<SemanticUiElement>[] = []): SemanticUiElement[] {
  const base: SemanticUiElement[] = [
    {
      id: "page-1",
      kind: "page",
      accessible_name: "Demo",
      source_node_id: "n1",
      confidence: 1,
    },
    {
      id: "field-1",
      kind: "field",
      accessible_name: "Email",
      accessible_role: "textbox",
      interaction_hint: "editable",
      source_node_id: "n2",
      confidence: 1,
    },
    {
      id: "action-1",
      kind: "action",
      accessible_name: "Submit",
      accessible_role: "button",
      interaction_hint: "clickable",
      source_node_id: "n3",
      confidence: 1,
    },
  ];
  return overrides.length === 0 ? base : (overrides as SemanticUiElement[]);
}

function stubDiscover(handler: (browser?: string) => SemanticUiDiscoveryResult): DiscoverUiSurface {
  return {
    discover: (request: { browser?: string }) => Promise.resolve(handler(request.browser)),
  } as unknown as DiscoverUiSurface;
}

test("exploratory session auto-checks leak + naming oracles on chromium", async () => {
  const skill = new ExecuteExploratorySession({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    discoverUiSurface: stubDiscover(() => ({
      ok: true,
      value: {
        schema_version: "1.0.0",
        workspace_id: "workspace-explore",
        source_url: "https://app.example.test/form",
        capture_id: "capture:1",
        captured_at: "2026-08-10T08:00:00.000Z",
        elements: elements(),
        limitations: [],
      },
    })),
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-explore",
    context: context(),
    url: "https://app.example.test/form",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "completed");
  assert.equal(result.value.browsers[0], "chromium");
  assert.equal(
    result.value.observations.some((o) => o.kind === "oracle" && o.status === "pass" && o.subject.includes("stack traces")),
    true,
  );
  assert.equal(
    result.value.observations.some((o) => o.status === "manual_follow_up"),
    true,
  );
});

test("exploratory session multi-browser parity observation", async () => {
  const skill = new ExecuteExploratorySession({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: {
      next: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    },
    discoverUiSurface: stubDiscover((browser) => ({
      ok: true,
      value: {
        schema_version: "1.0.0",
        workspace_id: "workspace-explore",
        source_url: "https://app.example.test/form",
        capture_id: `capture:${browser}`,
        captured_at: "2026-08-10T08:00:00.000Z",
        elements: elements(),
        limitations: [],
      },
    })),
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-explore",
    context: context(),
    url: "https://app.example.test/form",
    browsers: ["chromium", "firefox"],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.captures.length, 2);
  assert.equal(
    result.value.observations.some((o) => o.subject.includes("multi-browser parity") && o.status === "pass"),
    true,
  );
});

test("exploratory session marks unlabeled controls as oracle fail", async () => {
  const skill = new ExecuteExploratorySession({
    authorizer: new AllowingAuthorizer(),
    clock: { now: () => new Date("2026-08-10T08:00:00.000Z") },
    ids: { next: (scope) => `${scope}-1` },
    discoverUiSurface: stubDiscover(() => ({
      ok: true,
      value: {
        schema_version: "1.0.0",
        workspace_id: "workspace-explore",
        source_url: "https://app.example.test/form",
        capture_id: "capture:1",
        captured_at: "2026-08-10T08:00:00.000Z",
        elements: [
          {
            id: "field-1",
            kind: "field",
            interaction_hint: "editable",
            source_node_id: "n2",
            confidence: 1,
          },
        ],
        limitations: [],
      },
    })),
  });

  const result = await skill.run({
    operation_id: "op-1",
    workspace_id: "workspace-explore",
    context: context(),
    url: "https://app.example.test/form",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.observations.some((o) => o.subject.includes("Accessible names") && o.status === "fail"),
    true,
  );
});
