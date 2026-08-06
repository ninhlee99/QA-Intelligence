import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import type {
  WorkspaceIntegrityProofVerification,
  WorkspaceIntegrityProofVerifier,
} from "../deterministic/workspace-authorizer.js";

export type JwksWorkspaceIntegrityProofVerifierOptions = Readonly<{
  jwks_uri: string | URL;
  expected_issuer: string;
  expected_audience: string;
  /** Minimum interval between JWKS re-fetches on an unknown `kid`. Defaults to jose's own cooldown (30s). */
  jwks_cooldown_duration_ms?: number;
}>;

/**
 * Production `WorkspaceIntegrityProofVerifier` (ADR-014, SPEC-506 §7). Treats
 * `integrity_proof` as a compact JWT, signed by the Workspace Manager's
 * identity provider, whose `canonical_claims` payload claim carries the
 * exact string a caller passed in `verify`. Verifies signature, issuer,
 * audience, and expiry against a remote JWKS (jose caches keys and re-fetches
 * on an unknown `kid`, covering rotation). Any failure — bad signature, wrong
 * issuer/audience, expired token, unreachable JWKS endpoint, or a
 * `canonical_claims` mismatch — denies rather than throws or defaults to
 * allow, matching ADR-014 §4's fail-closed requirement.
 */
export class JwksWorkspaceIntegrityProofVerifier
  implements WorkspaceIntegrityProofVerifier
{
  readonly #options: JwksWorkspaceIntegrityProofVerifierOptions;
  readonly #getKey: JWTVerifyGetKey;

  constructor(options: JwksWorkspaceIntegrityProofVerifierOptions) {
    this.#options = options;
    this.#getKey = createRemoteJWKSet(new URL(options.jwks_uri), {
      ...(options.jwks_cooldown_duration_ms === undefined
        ? {}
        : { cooldownDuration: options.jwks_cooldown_duration_ms }),
    });
  }

  async verify(
    verification: WorkspaceIntegrityProofVerification,
  ): Promise<boolean> {
    try {
      const { payload } = await jwtVerify(
        verification.integrity_proof,
        this.#getKey,
        {
          issuer: this.#options.expected_issuer,
          audience: this.#options.expected_audience,
        },
      );

      return payload["canonical_claims"] === verification.canonical_claims;
    } catch {
      return false;
    }
  }
}
