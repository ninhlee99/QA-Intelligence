import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  type WorkspaceState,
  type WorkspaceAuthorizationPolicy,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

export const WORKSPACE: WorkspaceState = {
  workspace_id: "workspace-evaluation-001",
  status: "active",
};

export const POLICY: WorkspaceAuthorizationPolicy = {
  workspace_id: "workspace-evaluation-001",
  version: "test-policy-0.1.0",
  permissions: ["requirement:read", "knowledge:read", "assessment:create"],
};

export const EXPECTED_ISSUER = "https://identity.test.invalid";
export const EXPECTED_AUDIENCE = "qa-intelligence-test";

/**
 * SPEC-506 §7: "Deterministic identity fixtures and the production identity
 * adapter SHALL pass the same validation vectors." This harness is that
 * shared suite; each adapter's test file supplies only a factory that builds
 * an authorizer plus a way to sign a valid integrity proof over given
 * canonical claims, so the same assertions run against both the deterministic
 * fixture adapter and a real OIDC/JWKS-backed adapter.
 */
export type WorkspaceAuthorizerContractFixture = Readonly<{
  /** Builds the authorizer under test. Options override the shared defaults above. */
  makeAuthorizer(overrides?: {
    workspace?: WorkspaceState;
    policy?: WorkspaceAuthorizationPolicy;
    withoutVerifier?: boolean;
  }): WorkspaceAuthorizer | Promise<WorkspaceAuthorizer>;
  /** Produces a valid integrity proof for the given canonical claims payload. */
  signProof(canonicalClaims: string): string | Promise<string>;
  /** Produces a proof that will never verify against any canonical claims. */
  tamperedProof(): string | Promise<string>;
}>;

export function runWorkspaceAuthorizerContract(
  adapterName: string,
  fixture: WorkspaceAuthorizerContractFixture,
): void {
  async function context(
    overrides: Partial<WorkspaceContext> = {},
  ): Promise<WorkspaceContext> {
    const unsignedContext: WorkspaceContext = {
      schema_version: "1.0.0",
      workspace_id: WORKSPACE.workspace_id,
      actor_id: "reviewer-001",
      actor_type: "human",
      roles: ["requirement-reviewer"],
      permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      policy_version: POLICY.version,
      request_id: "request-001",
      correlation_id: "correlation-001",
      audience: [EXPECTED_AUDIENCE],
      environment: "test",
      issued_at: "2026-08-03T07:00:00.000Z",
      expires_at: "2026-08-03T09:00:00.000Z",
      issuer: EXPECTED_ISSUER,
      integrity_proof: "",
      ...overrides,
    };

    return {
      ...unsignedContext,
      integrity_proof:
        overrides.integrity_proof ??
        (await fixture.signProof(
          canonicalWorkspaceIntegrityClaims(unsignedContext),
        )),
    };
  }

  async function request(
    contextOverrides: Partial<WorkspaceContext> = {},
    requestOverrides: Partial<WorkspaceAuthorizationRequest> = {},
  ): Promise<WorkspaceAuthorizationRequest> {
    return {
      operation_id: "operation-001",
      context: await context(contextOverrides),
      purpose: "assess requirement quality",
      consequence_class: "advisory",
      required_permissions: [
        "requirement:read",
        "knowledge:read",
        "assessment:create",
      ],
      resource_refs: ["workspace:workspace-evaluation-001", "REQ-001@1.0.0"],
      ...requestOverrides,
    };
  }

  test(`[${adapterName}] authorizes a valid fixture context with the effective policy intersection`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(await request());

    assert.deepEqual(result, {
      ok: true,
      value: {
        policy_version: POLICY.version,
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
          `policy:${POLICY.version}`,
          "effective-permissions:3",
          "authorized-resources:2",
        ],
      },
    });
  });

  test(`[${adapterName}] never widens authority beyond the intersection of context and policy`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request(
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

  test(`[${adapterName}] fails closed when the trusted context is expired`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ expires_at: "2026-08-03T08:00:00.000Z" }),
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

  test(`[${adapterName}] fails closed for malformed, future, or inverted context timestamps`, async (t) => {
    const authorizer = await fixture.makeAuthorizer();
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
        const result = await authorizer.authorize(
          await request(testCase.context_overrides),
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

  test(`[${adapterName}] fails closed when the context audience is not the configured audience`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ audience: ["untrusted-service"] }),
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

  test(`[${adapterName}] fails closed when the context issuer is not the configured issuer`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ issuer: "https://attacker.test.invalid" }),
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

  test(`[${adapterName}] fails closed when the trusted context schema version is unsupported`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ schema_version: "2.0.0" }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.code, "invalid_context");
      assert.equal(
        result.failure.evidence.at(-1),
        "reason:unsupported-context-schema",
      );
    }
  });

  test(`[${adapterName}] fails closed when the integrity proof is tampered`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const tampered = await fixture.tamperedProof();
    const result = await authorizer.authorize(
      await request({ integrity_proof: tampered }),
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
    assert.equal(JSON.stringify(result).includes(tampered), false);
  });

  test(`[${adapterName}] fails closed without an injected verifier`, async () => {
    const signedContext = await context();
    const authorizer = await fixture.makeAuthorizer({ withoutVerifier: true });
    const result = await authorizer.authorize(
      await request({}, { context: signedContext }),
    );

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.code, "invalid_context");
      assert.equal(
        result.failure.evidence.at(-1),
        "reason:integrity-proof-invalid",
      );
      assert.equal(
        JSON.stringify(result).includes(signedContext.integrity_proof),
        false,
      );
    }
  });

  test(`[${adapterName}] fails closed when any integrity-bound claim is tampered without a new proof`, async (t) => {
    const authorizer = await fixture.makeAuthorizer();
    const signedContext = await context();
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
        const result = await authorizer.authorize(
          await request({}, { context: tamperedContext }),
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

  test(`[${adapterName}] fails closed when the context policy is not the active policy`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ policy_version: "test-policy-0.0.9" }),
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

  test(`[${adapterName}] fails closed when the context Workspace differs from the configured home Workspace`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request({ workspace_id: "workspace-evaluation-002" }),
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

  test(`[${adapterName}] fails closed when the policy belongs to a different Workspace`, async () => {
    const authorizer = await fixture.makeAuthorizer({
      policy: {
        workspace_id: "workspace-evaluation-002",
        version: POLICY.version,
        permissions: POLICY.permissions,
      },
    });
    const result = await authorizer.authorize(await request());

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

  test(`[${adapterName}] fails closed when the active Workspace has been suspended`, async () => {
    const authorizer = await fixture.makeAuthorizer({
      workspace: { workspace_id: WORKSPACE.workspace_id, status: "suspended" },
    });
    const result = await authorizer.authorize(await request());

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

  test(`[${adapterName}] fails closed when any required permission is absent from effective authority`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request(
        { permissions: ["requirement:read", "knowledge:read"] },
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

  test(`[${adapterName}] denies a cross-Workspace resource without an explicit bounded administrative scope`, async () => {
    const authorizer = await fixture.makeAuthorizer();
    const result = await authorizer.authorize(
      await request(
        {},
        {
          required_permissions: ["assessment:create"],
          resource_refs: [
            "workspace:workspace-evaluation-002",
            "workspace:workspace-evaluation-002/REQ-SECRET@1.0.0",
          ],
        },
      ),
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

  test(`[${adapterName}] authorizes only explicitly bounded cross-Workspace resources with administrative approval`, async () => {
    const authorizer = await fixture.makeAuthorizer({
      policy: {
        workspace_id: WORKSPACE.workspace_id,
        version: POLICY.version,
        permissions: ["assessment:create", "workspace:cross_read"],
      },
    });
    const result = await authorizer.authorize(
      await request(
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
        policy_version: POLICY.version,
        effective_permissions: ["assessment:create", "workspace:cross_read"],
        authorized_resource_refs: [
          "workspace:workspace-evaluation-002",
          "workspace:workspace-evaluation-002/REQ-002@1.0.0",
        ],
        decision_evidence: [
          "authorization:allow",
          "operation:operation-001",
          "workspace:workspace-evaluation-001",
          `policy:${POLICY.version}`,
          "administrative-scope:approval-admin-001",
          "effective-permissions:2",
          "authorized-resources:2",
        ],
      },
    });
  });
}
