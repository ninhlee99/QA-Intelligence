import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";

import { DeterministicWorkspaceAuthorizer } from "../../src/adapters/deterministic/workspace-authorizer.js";
import { JwksWorkspaceIntegrityProofVerifier } from "../../src/adapters/oidc/jwks-integrity-proof-verifier.js";

import {
  generateSigningKey,
  startJwksServer,
  type SigningKey,
} from "../../src/adapters/oidc/jwks-fixture-server.js";
import {
  EXPECTED_AUDIENCE,
  EXPECTED_ISSUER,
  POLICY,
  WORKSPACE,
  runWorkspaceAuthorizerContract,
} from "./workspace-authorizer-contract.js";

/**
 * Exercises JwksWorkspaceIntegrityProofVerifier against real RSA signing and
 * a real JWKS HTTP endpoint instead of a fake verifier, mirroring
 * pg-transaction-manager.real.test.ts's "real driver, not a fake" intent for
 * the OIDC/JWKS seam (ADR-014, SPEC-506 §7). No external identity provider
 * is required: this test mints its own ephemeral keypair and serves its own
 * JWKS document over a local HTTP server, so it needs no environment
 * variable and always runs as part of `npm test`.
 */

async function signProofWith(
  key: SigningKey,
  canonicalClaims: string,
  overrides: { issuer?: string; audience?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  return new SignJWT({ canonical_claims: canonicalClaims })
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(overrides.issuer ?? EXPECTED_ISSUER)
    .setAudience(overrides.audience ?? EXPECTED_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${overrides.expiresInSeconds ?? 300}s`)
    .sign(key.privateKey);
}

test("[oidc-real] JwksWorkspaceIntegrityProofVerifier contract and cryptographic edge cases", async (t) => {
  const keyA = await generateSigningKey("key-a");
  const keyB = await generateSigningKey("key-b");
  let activeKeys: readonly SigningKey[] = [keyA];

  const jwks = await startJwksServer(() => activeKeys);
  t.after(() => jwks.close());

  const verifier = new JwksWorkspaceIntegrityProofVerifier({
    jwks_uri: jwks.url,
    expected_issuer: EXPECTED_ISSUER,
    expected_audience: EXPECTED_AUDIENCE,
    jwks_cooldown_duration_ms: 0,
  });

  await t.test("shared workspace-authorizer contract suite", () => {
    runWorkspaceAuthorizerContract("oidc-real", {
      makeAuthorizer(overrides = {}) {
        return new DeterministicWorkspaceAuthorizer({
          clock: { now: () => new Date("2026-08-03T08:00:00.000Z") },
          expected_issuer: EXPECTED_ISSUER,
          expected_audience: EXPECTED_AUDIENCE,
          workspace: overrides.workspace ?? WORKSPACE,
          policy: overrides.policy ?? POLICY,
          ...(overrides.withoutVerifier ? {} : { integrity_proof_verifier: verifier }),
        });
      },
      signProof(canonicalClaims) {
        return signProofWith(keyA, canonicalClaims);
      },
      tamperedProof() {
        return signProofWith(keyA, "sha256:tampered-claims-payload");
      },
    });
  });

  await t.test("rejects a JWT signed by a key not present in the JWKS", async () => {
    const rogueKey = await generateSigningKey("key-rogue");
    const claims = '{"probe":"rogue-key"}';
    const proof = await signProofWith(rogueKey, claims);

    const ok = await verifier.verify({
      canonical_claims: claims,
      integrity_proof: proof,
    });

    assert.equal(ok, false);
  });

  await t.test("rejects an expired JWT", async () => {
    const claims = '{"probe":"expired"}';
    const proof = await signProofWith(keyA, claims, { expiresInSeconds: -10 });

    const ok = await verifier.verify({
      canonical_claims: claims,
      integrity_proof: proof,
    });

    assert.equal(ok, false);
  });

  await t.test("rejects a JWT with the wrong issuer", async () => {
    const claims = '{"probe":"wrong-issuer"}';
    const proof = await signProofWith(keyA, claims, {
      issuer: "https://attacker.test.invalid",
    });

    const ok = await verifier.verify({
      canonical_claims: claims,
      integrity_proof: proof,
    });

    assert.equal(ok, false);
  });

  await t.test("rejects a JWT with the wrong audience", async () => {
    const claims = '{"probe":"wrong-audience"}';
    const proof = await signProofWith(keyA, claims, {
      audience: "untrusted-service",
    });

    const ok = await verifier.verify({
      canonical_claims: claims,
      integrity_proof: proof,
    });

    assert.equal(ok, false);
  });

  await t.test(
    "accepts a JWT signed with a newly rotated key once it is published in the JWKS",
    async () => {
      const claims = '{"probe":"rotated-key"}';
      const proof = await signProofWith(keyB, claims);

      const beforeRotation = await verifier.verify({
        canonical_claims: claims,
        integrity_proof: proof,
      });
      assert.equal(beforeRotation, false);

      activeKeys = [keyA, keyB];

      const afterRotation = await verifier.verify({
        canonical_claims: claims,
        integrity_proof: proof,
      });
      assert.equal(afterRotation, true);
    },
  );

  await t.test(
    "fails closed when the JWKS endpoint is unreachable",
    async () => {
      const unreachableVerifier = new JwksWorkspaceIntegrityProofVerifier({
        jwks_uri: "http://127.0.0.1:1/jwks.json",
        expected_issuer: EXPECTED_ISSUER,
        expected_audience: EXPECTED_AUDIENCE,
      });
      const claims = '{"probe":"unreachable"}';
      const proof = await signProofWith(keyA, claims);

      const ok = await unreachableVerifier.verify({
        canonical_claims: claims,
        integrity_proof: proof,
      });

      assert.equal(ok, false);
    },
  );
});
