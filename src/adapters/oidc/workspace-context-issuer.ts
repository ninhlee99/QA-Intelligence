import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  SignJWT,
  type CryptoKey as JoseCryptoKey,
  type JWTVerifyGetKey,
} from "jose";

import type {
  WorkspaceContext,
  WorkspaceContextIssuanceFailure,
  WorkspaceContextIssuanceRequest,
  WorkspaceContextIssuanceResult,
  WorkspaceContextIssuer,
} from "../../requirement-review/public.js";
import {
  canonicalWorkspaceIntegrityClaims,
  type Clock,
  type WorkspaceState,
} from "../deterministic/workspace-authorizer.js";

export type MembershipRecord = Readonly<{
  workspace_id: string;
  actor_id: string;
  actor_type: string;
  roles: readonly string[];
  permissions: readonly string[];
  policy_version: string;
}>;

/**
 * Seam for resolving Workspace membership, roles, and policy from "governed
 * platform state" (ADR-014 §2). No such platform store exists yet; a real
 * adapter implements this interface without changing the issuer.
 */
export interface WorkspaceMembershipResolver {
  resolve(
    actorId: string,
    workspaceId: string,
  ): MembershipRecord | undefined;
}

const DEFAULT_CONTEXT_TTL_MS = 15 * 60 * 1000;

export type OidcWorkspaceContextIssuerOptions = Readonly<{
  jwks_uri: string | URL;
  expected_issuer: string;
  expected_audience: string;
  workspace: WorkspaceState;
  membership: WorkspaceMembershipResolver;
  /** The Workspace Manager's own signing key for the issued integrity_proof, distinct from the upstream IdP's key. */
  signing_key: JoseCryptoKey;
  signing_kid: string;
  /** Issuer string stamped on the issued context itself. Distinct from expected_issuer, which trusts the upstream IdP. */
  context_issuer: string;
  clock?: Clock;
  context_ttl_ms?: number;
  jwks_cooldown_duration_ms?: number;
}>;

/**
 * Production `WorkspaceContextIssuer` (ADR-014 §2, SPEC-406 §3). Verifies an
 * already-obtained OIDC ID token against a remote JWKS (signature, issuer,
 * audience, expiry), resolves Workspace membership/roles/policy for the
 * token's subject, and — if the target Workspace is not suspended — signs a
 * fresh WorkspaceContext whose integrity_proof a WorkspaceIntegrityProofVerifier
 * can independently verify. Any failure fails closed (ADR-014 §4): no
 * partial or unsigned context is ever returned. Does not perform interactive
 * Authorization Code + PKCE login itself — it consumes a token however one
 * was obtained.
 */
export class OidcWorkspaceContextIssuer implements WorkspaceContextIssuer {
  readonly #options: OidcWorkspaceContextIssuerOptions;
  readonly #getKey: JWTVerifyGetKey;

  constructor(options: OidcWorkspaceContextIssuerOptions) {
    this.#options = options;
    this.#getKey = createRemoteJWKSet(new URL(options.jwks_uri), {
      ...(options.jwks_cooldown_duration_ms === undefined
        ? {}
        : { cooldownDuration: options.jwks_cooldown_duration_ms }),
    });
  }

  async issue(
    request: WorkspaceContextIssuanceRequest,
  ): Promise<WorkspaceContextIssuanceResult> {
    let subject: string;
    try {
      const { payload } = await jwtVerify(request.id_token, this.#getKey, {
        issuer: this.#options.expected_issuer,
        audience: this.#options.expected_audience,
      });
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        return denied(
          "invalid_token",
          "Identity token is missing a subject claim.",
          "missing-subject",
        );
      }
      subject = payload.sub;
    } catch (error) {
      return deniedForTokenError(error);
    }

    const membership = this.#options.membership.resolve(
      subject,
      this.#options.workspace.workspace_id,
    );
    if (membership === undefined) {
      return denied(
        "no_workspace_membership",
        "Actor has no membership in the requested Workspace.",
        "no-workspace-membership",
      );
    }

    if (this.#options.workspace.status === "suspended") {
      return denied(
        "suspended_workspace",
        "Workspace is suspended and cannot issue context.",
        "workspace-suspended",
      );
    }

    const clock = this.#options.clock ?? { now: () => new Date() };
    const issuedAt = clock.now();
    const expiresAt = new Date(
      issuedAt.getTime() +
        (this.#options.context_ttl_ms ?? DEFAULT_CONTEXT_TTL_MS),
    );

    const unsignedContext: WorkspaceContext = {
      schema_version: "1.0.0",
      workspace_id: this.#options.workspace.workspace_id,
      actor_id: membership.actor_id,
      actor_type: membership.actor_type,
      roles: membership.roles,
      permissions: membership.permissions,
      policy_version: membership.policy_version,
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      audience: [this.#options.expected_audience],
      environment: request.environment,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      issuer: this.#options.context_issuer,
      integrity_proof: "",
    };

    const canonicalClaims = canonicalWorkspaceIntegrityClaims(unsignedContext);
    const integrityProof = await new SignJWT({
      canonical_claims: canonicalClaims,
    })
      .setProtectedHeader({ alg: "RS256", kid: this.#options.signing_kid })
      .setIssuer(this.#options.context_issuer)
      .setAudience(this.#options.expected_audience)
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.#options.signing_key);

    return {
      ok: true,
      value: { ...unsignedContext, integrity_proof: integrityProof },
    };
  }
}

function deniedForTokenError(
  error: unknown,
): WorkspaceContextIssuanceResult {
  if (error instanceof errors.JWTExpired) {
    return denied(
      "expired_token",
      "Identity token has expired.",
      "token-expired",
    );
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") {
      return denied(
        "untrusted_issuer",
        "Identity token issuer is not trusted.",
        "untrusted-issuer",
      );
    }
    if (error.claim === "aud") {
      return denied(
        "wrong_audience",
        "Identity token has the wrong audience.",
        "wrong-audience",
      );
    }
  }
  return denied(
    "invalid_token",
    "Identity token could not be verified.",
    "invalid-token",
  );
}

function denied(
  code: WorkspaceContextIssuanceFailure["code"],
  message: string,
  reason: string,
): WorkspaceContextIssuanceResult {
  return {
    ok: false,
    failure: {
      code,
      message,
      retryable: false,
      evidence: [`issuance:deny`, `reason:${reason}`],
    },
  };
}

/** Deterministic claims a fixture identity token stands in for (no real JWT parsing). */
export type DeterministicIdentityClaims = Readonly<{
  sub: string;
  iss: string;
  aud: string;
  expired?: boolean;
}>;

export interface DeterministicIdentityTokenDecoder {
  decode(idToken: string): DeterministicIdentityClaims | undefined;
}

export type DeterministicWorkspaceContextIssuerOptions = Readonly<{
  expected_issuer: string;
  expected_audience: string;
  workspace: WorkspaceState;
  membership: WorkspaceMembershipResolver;
  decoder: DeterministicIdentityTokenDecoder;
  /** Fixture signer for the issued integrity_proof, matching tests/adapters/workspace-authorizer.test.ts's fixture-sha256 pattern. */
  signProof(canonicalClaims: string): string;
  context_issuer: string;
  clock?: Clock;
  context_ttl_ms?: number;
}>;

/**
 * Deterministic signed-claims `WorkspaceContextIssuer` (ADR-014 §2's required
 * "deterministic signed-claims test adapter", paired with
 * `OidcWorkspaceContextIssuer`). Accepts pre-decoded claims instead of
 * performing real JWKS verification, but applies the same membership,
 * suspension, and fail-closed rules so both adapters pass the same contract
 * suite.
 */
export class DeterministicWorkspaceContextIssuer
  implements WorkspaceContextIssuer
{
  readonly #options: DeterministicWorkspaceContextIssuerOptions;

  constructor(options: DeterministicWorkspaceContextIssuerOptions) {
    this.#options = options;
  }

  issue(
    request: WorkspaceContextIssuanceRequest,
  ): Promise<WorkspaceContextIssuanceResult> {
    const claims = this.#options.decoder.decode(request.id_token);
    if (claims === undefined) {
      return Promise.resolve(
        denied(
          "invalid_token",
          "Identity token could not be verified.",
          "invalid-token",
        ),
      );
    }
    if (claims.expired === true) {
      return Promise.resolve(
        denied(
          "expired_token",
          "Identity token has expired.",
          "token-expired",
        ),
      );
    }
    if (claims.iss !== this.#options.expected_issuer) {
      return Promise.resolve(
        denied(
          "untrusted_issuer",
          "Identity token issuer is not trusted.",
          "untrusted-issuer",
        ),
      );
    }
    if (claims.aud !== this.#options.expected_audience) {
      return Promise.resolve(
        denied(
          "wrong_audience",
          "Identity token has the wrong audience.",
          "wrong-audience",
        ),
      );
    }

    const membership = this.#options.membership.resolve(
      claims.sub,
      this.#options.workspace.workspace_id,
    );
    if (membership === undefined) {
      return Promise.resolve(
        denied(
          "no_workspace_membership",
          "Actor has no membership in the requested Workspace.",
          "no-workspace-membership",
        ),
      );
    }

    if (this.#options.workspace.status === "suspended") {
      return Promise.resolve(
        denied(
          "suspended_workspace",
          "Workspace is suspended and cannot issue context.",
          "workspace-suspended",
        ),
      );
    }

    const clock = this.#options.clock ?? { now: () => new Date() };
    const issuedAt = clock.now();
    const expiresAt = new Date(
      issuedAt.getTime() +
        (this.#options.context_ttl_ms ?? DEFAULT_CONTEXT_TTL_MS),
    );

    const unsignedContext: WorkspaceContext = {
      schema_version: "1.0.0",
      workspace_id: this.#options.workspace.workspace_id,
      actor_id: membership.actor_id,
      actor_type: membership.actor_type,
      roles: membership.roles,
      permissions: membership.permissions,
      policy_version: membership.policy_version,
      request_id: request.request_id,
      correlation_id: request.correlation_id,
      audience: [this.#options.expected_audience],
      environment: request.environment,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      issuer: this.#options.context_issuer,
      integrity_proof: "",
    };

    const integrityProof = this.#options.signProof(
      canonicalWorkspaceIntegrityClaims(unsignedContext),
    );

    return Promise.resolve({
      ok: true,
      value: { ...unsignedContext, integrity_proof: integrityProof },
    });
  }
}
