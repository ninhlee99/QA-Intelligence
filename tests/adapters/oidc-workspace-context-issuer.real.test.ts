import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";

import { DeterministicWorkspaceAuthorizer } from "../../src/adapters/deterministic/workspace-authorizer.js";
import { JwksWorkspaceIntegrityProofVerifier } from "../../src/adapters/oidc/jwks-integrity-proof-verifier.js";
import {
  OidcWorkspaceContextIssuer,
  type MembershipRecord,
} from "../../src/adapters/oidc/workspace-context-issuer.js";

import {
  generateSigningKey,
  startJwksServer,
  type SigningKey,
} from "./jwks-fixture-server.js";
import {
  ISSUER_EXPECTED_AUDIENCE,
  ISSUER_EXPECTED_ISSUER,
  ISSUER_WORKSPACE_ID,
  MEMBERSHIP,
  runWorkspaceContextIssuerContract,
} from "./workspace-context-issuer-contract.js";

/**
 * Exercises OidcWorkspaceContextIssuer against real RSA signing and two
 * independent local JWKS endpoints — one standing in for the upstream IdP
 * (the issuer verifies id_token against it), one for the Workspace
 * Manager's own signing key (the WorkspaceAuthorizer verifies the issued
 * integrity_proof against it) — proving the two real cryptographic adapters
 * built for ADR-014 §2 (issuance and verification) actually interoperate
 * end-to-end, not just independently. No external identity provider or
 * environment variable is needed; this test mints its own keys and serves
 * its own JWKS documents, so it always runs as part of `npm test`.
 */

const CONTEXT_ISSUER = "https://workspace-manager.test.invalid";

async function signIdTokenWith(
  key: SigningKey,
  claims: { sub: string; issuer?: string; audience?: string; expiresInSeconds?: number },
): Promise<string> {
  return new SignJWT({})
    .setSubject(claims.sub)
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(claims.issuer ?? ISSUER_EXPECTED_ISSUER)
    .setAudience(claims.audience ?? ISSUER_EXPECTED_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${claims.expiresInSeconds ?? 300}s`)
    .sign(key.privateKey);
}

test("[oidc-real] OidcWorkspaceContextIssuer contract and interoperability with JwksWorkspaceIntegrityProofVerifier", async (t) => {
  const idpKey = await generateSigningKey("idp-key-a");
  const idp = await startJwksServer(() => [idpKey]);
  t.after(() => idp.close());

  const workspaceManagerKey = await generateSigningKey("wm-key-a");
  const workspaceManagerJwks = await startJwksServer(() => [workspaceManagerKey]);
  t.after(() => workspaceManagerJwks.close());

  function makeMembershipResolver(
    membership: ReadonlyMap<string, MembershipRecord>,
  ) {
    return {
      resolve: (actorId: string, workspaceId: string) => {
        const record = membership.get(actorId);
        return record?.workspace_id === workspaceId ? record : undefined;
      },
    };
  }

  await t.test("shared workspace-context-issuer contract suite", () => {
    runWorkspaceContextIssuerContract("oidc-real", {
      makeIssuer(overrides = {}) {
        return new OidcWorkspaceContextIssuer({
          jwks_uri: idp.url,
          expected_issuer: ISSUER_EXPECTED_ISSUER,
          expected_audience: ISSUER_EXPECTED_AUDIENCE,
          workspace: {
            workspace_id: ISSUER_WORKSPACE_ID,
            status: overrides.workspaceStatus ?? "active",
          },
          membership: makeMembershipResolver(
            overrides.membership ?? new Map(),
          ),
          signing_key: workspaceManagerKey.privateKey,
          signing_kid: workspaceManagerKey.kid,
          context_issuer: CONTEXT_ISSUER,
          jwks_cooldown_duration_ms: 0,
        });
      },
      makeAuthorizer() {
        return new DeterministicWorkspaceAuthorizer({
          clock: { now: () => new Date() },
          expected_issuer: CONTEXT_ISSUER,
          expected_audience: ISSUER_EXPECTED_AUDIENCE,
          workspace: { workspace_id: ISSUER_WORKSPACE_ID, status: "active" },
          policy: {
            workspace_id: ISSUER_WORKSPACE_ID,
            version: MEMBERSHIP.policy_version,
            permissions: MEMBERSHIP.permissions,
          },
          integrity_proof_verifier: new JwksWorkspaceIntegrityProofVerifier({
            jwks_uri: workspaceManagerJwks.url,
            expected_issuer: CONTEXT_ISSUER,
            expected_audience: ISSUER_EXPECTED_AUDIENCE,
            jwks_cooldown_duration_ms: 0,
          }),
        });
      },
      signIdToken(claims) {
        return signIdTokenWith(idpKey, claims);
      },
      async invalidToken() {
        const rogueKey = await generateSigningKey("idp-key-rogue");
        return signIdTokenWith(rogueKey, { sub: "actor-001" });
      },
    });
  });

  await t.test(
    "rejects an id_token missing a subject claim",
    async () => {
      const issuer = new OidcWorkspaceContextIssuer({
        jwks_uri: idp.url,
        expected_issuer: ISSUER_EXPECTED_ISSUER,
        expected_audience: ISSUER_EXPECTED_AUDIENCE,
        workspace: { workspace_id: ISSUER_WORKSPACE_ID, status: "active" },
        membership: makeMembershipResolver(
          new Map([[MEMBERSHIP.actor_id, MEMBERSHIP]]),
        ),
        signing_key: workspaceManagerKey.privateKey,
        signing_kid: workspaceManagerKey.kid,
        context_issuer: CONTEXT_ISSUER,
        jwks_cooldown_duration_ms: 0,
      });

      const token = await new SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: idpKey.kid })
        .setIssuer(ISSUER_EXPECTED_ISSUER)
        .setAudience(ISSUER_EXPECTED_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("300s")
        .sign(idpKey.privateKey);

      const issued = await issuer.issue({
        id_token: token,
        operation_id: "operation-001",
        request_id: "request-001",
        correlation_id: "correlation-001",
        environment: "test",
      });

      assert.equal(issued.ok, false);
      if (!issued.ok) {
        assert.equal(issued.failure.code, "invalid_token");
      }
    },
  );

  await t.test(
    "fails closed when the IdP JWKS endpoint is unreachable",
    async () => {
      const unreachableIssuer = new OidcWorkspaceContextIssuer({
        jwks_uri: "http://127.0.0.1:1/jwks.json",
        expected_issuer: ISSUER_EXPECTED_ISSUER,
        expected_audience: ISSUER_EXPECTED_AUDIENCE,
        workspace: { workspace_id: ISSUER_WORKSPACE_ID, status: "active" },
        membership: makeMembershipResolver(
          new Map([[MEMBERSHIP.actor_id, MEMBERSHIP]]),
        ),
        signing_key: workspaceManagerKey.privateKey,
        signing_kid: workspaceManagerKey.kid,
        context_issuer: CONTEXT_ISSUER,
      });

      const token = await signIdTokenWith(idpKey, { sub: MEMBERSHIP.actor_id });
      const issued = await unreachableIssuer.issue({
        id_token: token,
        operation_id: "operation-001",
        request_id: "request-001",
        correlation_id: "correlation-001",
        environment: "test",
      });

      assert.equal(issued.ok, false);
      if (!issued.ok) {
        assert.equal(issued.failure.code, "invalid_token");
      }
    },
  );
});
