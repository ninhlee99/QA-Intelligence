import { createHash } from "node:crypto";

import { DeterministicWorkspaceAuthorizer } from "../../src/adapters/deterministic/workspace-authorizer.js";
import {
  DeterministicWorkspaceContextIssuer,
  type DeterministicIdentityClaims,
  type MembershipRecord,
} from "../../src/adapters/oidc/workspace-context-issuer.js";

import {
  ISSUER_EXPECTED_AUDIENCE,
  ISSUER_EXPECTED_ISSUER,
  ISSUER_WORKSPACE_ID,
  runWorkspaceContextIssuerContract,
} from "./workspace-context-issuer-contract.js";

const CONTEXT_ISSUER = "https://workspace-manager.test.invalid";

function fixtureProofForCanonicalClaims(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function encodeToken(claims: DeterministicIdentityClaims): string {
  return Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
}

runWorkspaceContextIssuerContract("deterministic", {
  makeIssuer(overrides = {}) {
    const membership = overrides.membership ?? new Map<string, MembershipRecord>();
    return new DeterministicWorkspaceContextIssuer({
      expected_issuer: ISSUER_EXPECTED_ISSUER,
      expected_audience: ISSUER_EXPECTED_AUDIENCE,
      workspace: {
        workspace_id: ISSUER_WORKSPACE_ID,
        status: overrides.workspaceStatus ?? "active",
      },
      membership: {
        resolve: (actorId, workspaceId) => {
          const record = membership.get(actorId);
          return record?.workspace_id === workspaceId ? record : undefined;
        },
      },
      decoder: {
        decode: (idToken) => {
          try {
            return JSON.parse(
              Buffer.from(idToken, "base64url").toString("utf8"),
            ) as DeterministicIdentityClaims;
          } catch {
            return undefined;
          }
        },
      },
      signProof: fixtureProofForCanonicalClaims,
      context_issuer: CONTEXT_ISSUER,
      clock: { now: () => new Date("2026-08-03T08:00:00.000Z") },
    });
  },
  makeAuthorizer() {
    return new DeterministicWorkspaceAuthorizer({
      clock: { now: () => new Date("2026-08-03T08:00:00.000Z") },
      expected_issuer: CONTEXT_ISSUER,
      expected_audience: ISSUER_EXPECTED_AUDIENCE,
      workspace: { workspace_id: ISSUER_WORKSPACE_ID, status: "active" },
      policy: {
        workspace_id: ISSUER_WORKSPACE_ID,
        version: "test-policy-0.1.0",
        permissions: ["requirement:read", "knowledge:read", "assessment:create"],
      },
      integrity_proof_verifier: {
        verify: ({ canonical_claims, integrity_proof }) =>
          integrity_proof === fixtureProofForCanonicalClaims(canonical_claims),
      },
    });
  },
  signIdToken(claims) {
    return encodeToken({
      sub: claims.sub,
      iss: claims.issuer ?? ISSUER_EXPECTED_ISSUER,
      aud: claims.audience ?? ISSUER_EXPECTED_AUDIENCE,
      ...(claims.expiresInSeconds !== undefined && claims.expiresInSeconds < 0
        ? { expired: true }
        : {}),
    });
  },
  invalidToken() {
    return "not-a-valid-token";
  },
});
