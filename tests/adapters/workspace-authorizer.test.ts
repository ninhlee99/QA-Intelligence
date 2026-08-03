import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
  type Clock,
  type WorkspaceIntegrityProofVerifier,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-03T08:00:00.000Z");
  }
}

function context(
  overrides: Partial<WorkspaceContext> = {},
): WorkspaceContext {
  const unsignedContext: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: "workspace-evaluation-001",
    actor_id: "reviewer-001",
    actor_type: "human",
    roles: ["requirement-reviewer"],
    permissions: [
      "requirement:read",
      "knowledge:read",
      "assessment:create",
    ],
    policy_version: "test-policy-0.1.0",
    request_id: "request-001",
    correlation_id: "correlation-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-03T07:00:00.000Z",
    expires_at: "2026-08-03T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
    ...overrides,
  };

  return {
    ...unsignedContext,
    integrity_proof:
      overrides.integrity_proof ?? fixtureProofFor(unsignedContext),
  };
}

const fixtureIntegrityProofVerifier: WorkspaceIntegrityProofVerifier = {
  verify({ canonical_claims, integrity_proof }): boolean {
    return integrity_proof === fixtureProofForCanonicalClaims(canonical_claims);
  },
};

function fixtureProofFor(workspaceContext: WorkspaceContext): string {
  return fixtureProofForCanonicalClaims(
    canonicalWorkspaceIntegrityClaims(workspaceContext),
  );
}

function fixtureProofForCanonicalClaims(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function request(
  contextOverrides: Partial<WorkspaceContext> = {},
  requestOverrides: Partial<WorkspaceAuthorizationRequest> = {},
): WorkspaceAuthorizationRequest {
  return {
    operation_id: "operation-001",
    context: context(contextOverrides),
    purpose: "assess requirement quality",
    consequence_class: "advisory",
    required_permissions: [
      "requirement:read",
      "knowledge:read",
      "assessment:create",
    ],
    resource_refs: [
      "workspace:workspace-evaluation-001",
      "REQ-001@1.0.0",
    ],
    ...requestOverrides,
  };
}

function authorizer(
  overrides: Partial<ConstructorParameters<typeof DeterministicWorkspaceAuthorizer>[0]> = {},
): DeterministicWorkspaceAuthorizer {
  return new DeterministicWorkspaceAuthorizer({
    clock: new FixedClock(),
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: {
      workspace_id: "workspace-evaluation-001",
      status: "active",
    },
    policy: {
      workspace_id: "workspace-evaluation-001",
      version: "test-policy-0.1.0",
      permissions: [
        "requirement:read",
        "knowledge:read",
        "assessment:create",
      ],
    },
    integrity_proof_verifier: fixtureIntegrityProofVerifier,
    ...overrides,
  });
}

test("authorizes a valid fixture context with the effective policy intersection", async () => {
  const result = await authorizer().authorize(request());

  assert.deepEqual(result, {
    ok: true,
    value: {
      policy_version: "test-policy-0.1.0",
      effective_permissions: [
        "requirement:read",
        "knowledge:read",
        "assessment:create",
      ],
      authorized_resource_refs: [
        "workspace:workspace-evaluation-001",
        "REQ-001@1.0.0",
      ],
      decision_evidence: [
        "authorization:allow",
        "operation:operation-001",
        "workspace:workspace-evaluation-001",
        "policy:test-policy-0.1.0",
        "effective-permissions:3",
        "authorized-resources:2",
      ],
    },
  });
});

test("never widens authority beyond the intersection of context and policy", async () => {
  const result = await authorizer().authorize(
    request(
      {
        permissions: [
          "requirement:read",
          "knowledge:read",
          "assessment:create",
          "requirement:approve",
        ],
      },
      { required_permissions: ["assessment:create"] },
    ),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.effective_permissions, [
      "requirement:read",
      "knowledge:read",
      "assessment:create",
    ]);
    assert.equal(
      result.value.effective_permissions.includes("requirement:approve"),
      false,
    );
  }
});

test("fails closed when the trusted context is expired", async () => {
  const result = await authorizer().authorize(
    request({ expires_at: "2026-08-03T08:00:00.000Z" }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "expired_context",
      message: "Workspace context has expired.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:expired-context",
      ],
    },
  });
});

test("fails closed for malformed, future, or inverted context timestamps", async (t) => {
  const cases = [
    {
      name: "malformed issued_at",
      context_overrides: { issued_at: "not-a-timestamp" },
      message: "Workspace context issued_at is malformed.",
      reason: "issued-at-malformed",
    },
    {
      name: "future issued_at",
      context_overrides: { issued_at: "2026-08-03T08:00:00.001Z" },
      message: "Workspace context was issued in the future.",
      reason: "issued-at-future",
    },
    {
      name: "malformed expires_at",
      context_overrides: { expires_at: "2026-08-03 09:00:00Z" },
      message: "Workspace context expires_at is malformed.",
      reason: "expires-at-malformed",
    },
    {
      name: "inverted validity window",
      context_overrides: {
        issued_at: "2026-08-03T07:30:00.000Z",
        expires_at: "2026-08-03T07:00:00.000Z",
      },
      message: "Workspace context validity window is invalid.",
      reason: "validity-window-invalid",
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const result = await authorizer().authorize(
        request(testCase.context_overrides),
      );

      assert.deepEqual(result, {
        ok: false,
        failure: {
          code: "invalid_context",
          message: testCase.message,
          retryable: false,
          evidence: [
            "authorization:deny",
            "operation:operation-001",
            `reason:${testCase.reason}`,
          ],
        },
      });
    });
  }
});

test("fails closed when the context audience is not the configured audience", async () => {
  const result = await authorizer().authorize(
    request({ audience: ["untrusted-service"] }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "wrong_audience",
      message: "Workspace context has the wrong audience.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:wrong-audience",
      ],
    },
  });
});

test("fails closed when the context issuer is not the configured issuer", async () => {
  const result = await authorizer().authorize(
    request({ issuer: "https://attacker.test.invalid" }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "invalid_context",
      message: "Workspace context issuer is not trusted.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:untrusted-issuer",
      ],
    },
  });
});

test("fails closed when the trusted context schema version is unsupported", async () => {
  const result = await authorizer().authorize(
    request({ schema_version: "2.0.0" }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "invalid_context");
    assert.equal(result.failure.evidence.at(-1), "reason:unsupported-context-schema");
  }
});

test("fails closed when the deterministic integrity proof is tampered", async () => {
  const result = await authorizer().authorize(
    request({ integrity_proof: "invalid-test-signature" }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "invalid_context",
      message: "Workspace context integrity proof could not be verified.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:integrity-proof-invalid",
      ],
    },
  });
  assert.equal(JSON.stringify(result).includes("invalid-test-signature"), false);
});

test("fails closed without an injected verifier", async () => {
  const signedContext = context();
  const result = await new DeterministicWorkspaceAuthorizer({
    clock: new FixedClock(),
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: {
      workspace_id: "workspace-evaluation-001",
      status: "active",
    },
    policy: {
      workspace_id: "workspace-evaluation-001",
      version: "test-policy-0.1.0",
      permissions: [
        "requirement:read",
        "knowledge:read",
        "assessment:create",
      ],
    },
  }).authorize(request({}, { context: signedContext }));

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.code, "invalid_context");
    assert.equal(result.failure.evidence.at(-1), "reason:integrity-proof-invalid");
    assert.equal(
      JSON.stringify(result).includes(signedContext.integrity_proof),
      false,
    );
  }
});

test("fails closed when any integrity-bound claim is tampered without a new proof", async (t) => {
  const signedContext = context();
  const tamperedContexts: ReadonlyArray<readonly [string, WorkspaceContext]> = [
    [
      "audience",
      {
        ...signedContext,
        audience: [...signedContext.audience, "extra-service"],
      },
    ],
    ["actor id", { ...signedContext, actor_id: "attacker-001" }],
    ["actor type", { ...signedContext, actor_type: "service" }],
    [
      "roles",
      { ...signedContext, roles: [...signedContext.roles, "administrator"] },
    ],
    [
      "permissions",
      {
        ...signedContext,
        permissions: [...signedContext.permissions, "requirement:approve"],
      },
    ],
    ["issued_at", { ...signedContext, issued_at: "2026-08-03T06:59:59.000Z" }],
    ["expires_at", { ...signedContext, expires_at: "2026-08-03T09:00:01.000Z" }],
  ];

  for (const [claimName, tamperedContext] of tamperedContexts) {
    await t.test(claimName, async () => {
      const result = await authorizer().authorize(
        request({}, { context: tamperedContext }),
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.failure.code, "invalid_context");
        assert.deepEqual(result.failure.evidence, [
          "authorization:deny",
          "operation:operation-001",
          "reason:integrity-proof-invalid",
        ]);
        assert.equal(JSON.stringify(result).includes("attacker-001"), false);
        assert.equal(
          JSON.stringify(result).includes(signedContext.integrity_proof),
          false,
        );
      }
    });
  }
});

test("fails closed when the context policy is not the active policy", async () => {
  const result = await authorizer().authorize(
    request({ policy_version: "test-policy-0.0.9" }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "stale_policy",
      message: "Workspace context does not reference the active policy.",
      retryable: true,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:stale-policy",
      ],
    },
  });
});

test("fails closed when the context Workspace differs from the configured home Workspace", async () => {
  const result = await authorizer().authorize(
    request({ workspace_id: "workspace-evaluation-002" }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "invalid_context",
      message: "Workspace context does not match the configured Workspace.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:workspace-context-mismatch",
      ],
    },
  });
});

test("fails closed when the policy belongs to a different Workspace", async () => {
  const result = await authorizer({
    policy: {
      workspace_id: "workspace-evaluation-002",
      version: "test-policy-0.1.0",
      permissions: [
        "requirement:read",
        "knowledge:read",
        "assessment:create",
      ],
    },
  }).authorize(request());

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "invalid_context",
      message: "Authorization policy does not belong to the configured Workspace.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:workspace-policy-mismatch",
      ],
    },
  });
});

test("fails closed when the active Workspace has been suspended", async () => {
  const result = await authorizer({
    workspace: {
      workspace_id: "workspace-evaluation-001",
      status: "suspended",
    },
  }).authorize(request());

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "suspended_workspace",
      message: "Workspace is suspended.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:workspace-suspended",
      ],
    },
  });
});

test("fails closed when any required permission is absent from effective authority", async () => {
  const result = await authorizer().authorize(
    request(
      {
        permissions: ["requirement:read", "knowledge:read"],
      },
      { required_permissions: ["assessment:create"] },
    ),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "insufficient_permission",
      message: "One or more required permissions are not authorized.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:required-permission-missing",
      ],
    },
  });
});

test("denies a cross-Workspace resource without an explicit bounded administrative scope", async () => {
  const result = await authorizer().authorize(
    request({}, {
      required_permissions: ["assessment:create"],
      resource_refs: [
        "workspace:workspace-evaluation-002",
        "workspace:workspace-evaluation-002/REQ-SECRET@1.0.0",
      ],
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    failure: {
      code: "insufficient_permission",
      message: "Cross-Workspace resources are outside the authorized scope.",
      retryable: false,
      evidence: [
        "authorization:deny",
        "operation:operation-001",
        "reason:cross-workspace-scope-denied",
      ],
    },
  });
});

test("authorizes only explicitly bounded cross-Workspace resources with administrative approval", async () => {
  const result = await authorizer({
    policy: {
      workspace_id: "workspace-evaluation-001",
      version: "test-policy-0.1.0",
      permissions: ["assessment:create", "workspace:cross_read"],
    },
  }).authorize(
    request(
      {
        permissions: ["assessment:create", "workspace:cross_read"],
        administrative_scope: {
          purpose: "assess requirement quality",
          target_workspace_ids: ["workspace-evaluation-002"],
          approval_ref: "approval-admin-001",
        },
      },
      {
        required_permissions: ["assessment:create", "workspace:cross_read"],
        resource_refs: [
          "workspace:workspace-evaluation-002",
          "workspace:workspace-evaluation-002/REQ-002@1.0.0",
        ],
      },
    ),
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      policy_version: "test-policy-0.1.0",
      effective_permissions: ["assessment:create", "workspace:cross_read"],
      authorized_resource_refs: [
        "workspace:workspace-evaluation-002",
        "workspace:workspace-evaluation-002/REQ-002@1.0.0",
      ],
      decision_evidence: [
        "authorization:allow",
        "operation:operation-001",
        "workspace:workspace-evaluation-001",
        "policy:test-policy-0.1.0",
        "administrative-scope:approval-admin-001",
        "effective-permissions:2",
        "authorized-resources:2",
      ],
    },
  });
});
