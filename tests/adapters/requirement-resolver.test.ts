import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryRequirementResolver } from "../../src/adapters/memory/requirement-resolver.js";
import type {
  Requirement,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

const requirement: Requirement = {
  id: "REQ-1",
  version: "1.0.0",
  status: "in_review",
  title: "Export report",
  statement: "The platform shall export a report.",
  source: ["product-brief@1.0.0"],
  owner: "Product",
  capability_id: "reporting",
  scope: { workspace_id: "workspace-alpha" },
  acceptance_criteria: [],
  traceability: [
    { relationship: "derived_from", target_id: "product-brief@1.0.0" },
  ],
};

class AuthorizerStub implements WorkspaceAuthorizer {
  readonly requests: WorkspaceAuthorizationRequest[] = [];

  constructor(private readonly result?: WorkspaceAuthorizationResult) {}

  authorize(
    request: WorkspaceAuthorizationRequest,
  ): Promise<WorkspaceAuthorizationResult> {
    this.requests.push(request);
    return Promise.resolve(
      this.result ?? {
        ok: true,
        value: {
          policy_version: request.context.policy_version,
          effective_permissions: [...request.required_permissions],
          authorized_resource_refs: [...request.resource_refs],
          decision_evidence: ["authorization:requirement-read"],
        },
      },
    );
  }
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-1",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: ["requirement:read"],
    policy_version: "policy-1",
    request_id: "request-1",
    correlation_id: "correlation-1",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-03T00:00:00.000Z",
    expires_at: "2026-08-03T01:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "fixture-proof",
  };
}

test("authorizes exact Workspace and requirement resources before resolving", async () => {
  const authorizer = new AuthorizerStub();
  const resolver = new InMemoryRequirementResolver(
    "workspace-alpha",
    [requirement],
    authorizer,
  );

  const result = await resolver.resolve({
    operation_id: "resolve-1",
    workspace_id: "workspace-alpha",
    context: context(),
    requirement_ref: "REQ-1@1.0.0",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(authorizer.requests[0]?.required_permissions, [
    "requirement:read",
  ]);
  assert.deepEqual(authorizer.requests[0]?.resource_refs, [
    "workspace:workspace-alpha",
    "REQ-1@1.0.0",
  ]);
  if (result.ok) assert.equal(Object.isFrozen(result.value), true);
});

test("fails closed when requirement-read authorization is denied or incomplete", async () => {
  const decisions: WorkspaceAuthorizationResult[] = [
    {
      ok: false,
      failure: {
        code: "insufficient_permission",
        message: "provider detail",
        retryable: false,
        evidence: ["secret://must-not-leak"],
      },
    },
    {
      ok: true,
      value: {
        policy_version: "policy-1",
        effective_permissions: ["requirement:read"],
        authorized_resource_refs: ["workspace:workspace-alpha"],
        decision_evidence: ["authorization:incomplete"],
      },
    },
  ];

  for (const decision of decisions) {
    const resolver = new InMemoryRequirementResolver(
      "workspace-alpha",
      [requirement],
      new AuthorizerStub(decision),
    );
    const result = await resolver.resolve({
      operation_id: "resolve-denied",
      workspace_id: "workspace-alpha",
      context: context(),
      requirement_ref: "REQ-1@1.0.0",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.code, "authorization_denied");
      assert.equal(
        result.failure.evidence.includes("secret://must-not-leak"),
        false,
      );
    }
  }
});
