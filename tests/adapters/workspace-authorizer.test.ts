import { createHash } from "node:crypto";

import {
  DeterministicWorkspaceAuthorizer,
  type Clock,
  type WorkspaceIntegrityProofVerifier,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import {
  EXPECTED_AUDIENCE,
  EXPECTED_ISSUER,
  POLICY,
  WORKSPACE,
  runWorkspaceAuthorizerContract,
} from "./workspace-authorizer-contract.js";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-03T08:00:00.000Z");
  }
}

function fixtureProofForCanonicalClaims(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

const fixtureIntegrityProofVerifier: WorkspaceIntegrityProofVerifier = {
  verify({ canonical_claims, integrity_proof }): boolean {
    return integrity_proof === fixtureProofForCanonicalClaims(canonical_claims);
  },
};

runWorkspaceAuthorizerContract("deterministic", {
  makeAuthorizer(overrides = {}) {
    return new DeterministicWorkspaceAuthorizer({
      clock: new FixedClock(),
      expected_issuer: EXPECTED_ISSUER,
      expected_audience: EXPECTED_AUDIENCE,
      workspace: overrides.workspace ?? WORKSPACE,
      policy: overrides.policy ?? POLICY,
      ...(overrides.withoutVerifier
        ? {}
        : { integrity_proof_verifier: fixtureIntegrityProofVerifier }),
    });
  },
  signProof(canonicalClaims) {
    return fixtureProofForCanonicalClaims(canonicalClaims);
  },
  tamperedProof() {
    return "invalid-test-signature";
  },
});
