import assert from "node:assert/strict";
import test from "node:test";

import type {
  WorkspaceAuthorizer,
  WorkspaceContextIssuer,
} from "../../src/requirement-review/public.js";
import type { MembershipRecord } from "../../src/adapters/oidc/workspace-context-issuer.js";

export const ISSUER_EXPECTED_ISSUER = "https://identity.test.invalid";
export const ISSUER_EXPECTED_AUDIENCE = "qa-intelligence-test";
export const ISSUER_WORKSPACE_ID = "workspace-issuance-001";
export const ISSUER_ACTOR_ID = "actor-001";

export const MEMBERSHIP: MembershipRecord = {
  workspace_id: ISSUER_WORKSPACE_ID,
  actor_id: ISSUER_ACTOR_ID,
  actor_type: "human",
  roles: ["requirement-reviewer"],
  permissions: ["requirement:read", "knowledge:read", "assessment:create"],
  policy_version: "test-policy-0.1.0",
};

/**
 * ADR-014 §2: "the identity provider [is kept] behind a seam with a
 * production OIDC adapter and deterministic signed-claims test adapter" —
 * this harness is the shared suite both pass, mirroring
 * workspace-authorizer-contract.ts's pattern for the sibling verification
 * seam. Each adapter's test file supplies only a factory that builds an
 * issuer, a valid token for a given subject/issuer/audience, and a way to
 * verify the resulting integrity_proof round-trips through a real
 * WorkspaceAuthorizer.
 */
export type WorkspaceContextIssuerContractFixture = Readonly<{
  makeIssuer(overrides?: {
    membership?: ReadonlyMap<string, MembershipRecord>;
    workspaceStatus?: "active" | "suspended";
  }): WorkspaceContextIssuer | Promise<WorkspaceContextIssuer>;
  /** A matching WorkspaceAuthorizer configured to trust this adapter's issued integrity_proof. */
  makeAuthorizer(): WorkspaceAuthorizer | Promise<WorkspaceAuthorizer>;
  signIdToken(claims: {
    sub: string;
    issuer?: string;
    audience?: string;
    expiresInSeconds?: number;
  }): string | Promise<string>;
  /** A token that will never verify against this adapter (bad signature / undecodable). */
  invalidToken(): string | Promise<string>;
}>;

export function runWorkspaceContextIssuerContract(
  adapterName: string,
  fixture: WorkspaceContextIssuerContractFixture,
): void {
  function membershipMap(
    overrides: Partial<MembershipRecord> = {},
  ): ReadonlyMap<string, MembershipRecord> {
    return new Map([
      [ISSUER_ACTOR_ID, { ...MEMBERSHIP, ...overrides }],
    ]);
  }

  test(`[${adapterName}] issues a trusted context whose integrity_proof authorizes`, async () => {
    const issuer = await fixture.makeIssuer({ membership: membershipMap() });
    const token = await fixture.signIdToken({ sub: ISSUER_ACTOR_ID });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, true, JSON.stringify(issued));
    if (!issued.ok) return;

    assert.equal(issued.value.workspace_id, ISSUER_WORKSPACE_ID);
    assert.equal(issued.value.actor_id, ISSUER_ACTOR_ID);
    assert.deepEqual(issued.value.roles, MEMBERSHIP.roles);
    assert.deepEqual(issued.value.permissions, MEMBERSHIP.permissions);
    assert.equal(issued.value.policy_version, MEMBERSHIP.policy_version);
    assert.ok(issued.value.issued_at < issued.value.expires_at);
    assert.notEqual(issued.value.integrity_proof, "");

    const authorizer = await fixture.makeAuthorizer();
    const authorization = await authorizer.authorize({
      operation_id: "operation-001",
      context: issued.value,
      purpose: "assess requirement quality",
      consequence_class: "advisory",
      required_permissions: ["requirement:read"],
      resource_refs: [`workspace:${ISSUER_WORKSPACE_ID}`],
    });

    assert.equal(authorization.ok, true, JSON.stringify(authorization));
  });

  test(`[${adapterName}] fails closed for an invalid or unverifiable token`, async () => {
    const issuer = await fixture.makeIssuer({ membership: membershipMap() });
    const token = await fixture.invalidToken();

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "invalid_token");
  });

  test(`[${adapterName}] fails closed for an expired token`, async () => {
    const issuer = await fixture.makeIssuer({ membership: membershipMap() });
    const token = await fixture.signIdToken({
      sub: ISSUER_ACTOR_ID,
      expiresInSeconds: -10,
    });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "expired_token");
  });

  test(`[${adapterName}] fails closed for an untrusted issuer`, async () => {
    const issuer = await fixture.makeIssuer({ membership: membershipMap() });
    const token = await fixture.signIdToken({
      sub: ISSUER_ACTOR_ID,
      issuer: "https://attacker.test.invalid",
    });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "untrusted_issuer");
  });

  test(`[${adapterName}] fails closed for the wrong audience`, async () => {
    const issuer = await fixture.makeIssuer({ membership: membershipMap() });
    const token = await fixture.signIdToken({
      sub: ISSUER_ACTOR_ID,
      audience: "untrusted-service",
    });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "wrong_audience");
  });

  test(`[${adapterName}] fails closed when the actor has no membership in the Workspace`, async () => {
    const issuer = await fixture.makeIssuer({ membership: new Map() });
    const token = await fixture.signIdToken({ sub: ISSUER_ACTOR_ID });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "no_workspace_membership");
  });

  test(`[${adapterName}] fails closed when the Workspace is suspended`, async () => {
    const issuer = await fixture.makeIssuer({
      membership: membershipMap(),
      workspaceStatus: "suspended",
    });
    const token = await fixture.signIdToken({ sub: ISSUER_ACTOR_ID });

    const issued = await issuer.issue({
      id_token: token,
      operation_id: "operation-001",
      request_id: "request-001",
      correlation_id: "correlation-001",
      environment: "test",
    });

    assert.equal(issued.ok, false);
    if (issued.ok) return;
    assert.equal(issued.failure.code, "suspended_workspace");
  });
}
