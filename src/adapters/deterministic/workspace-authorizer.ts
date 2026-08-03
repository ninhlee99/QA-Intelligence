import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
} from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

export type WorkspaceState = Readonly<{
  workspace_id: string;
  status: "active" | "suspended";
}>;

export type WorkspaceAuthorizationPolicy = Readonly<{
  workspace_id: string;
  version: string;
  permissions: readonly string[];
}>;

export type WorkspaceIntegrityProofVerification = Readonly<{
  /** Canonical claim payload. A production adapter should verify its real signature. */
  canonical_claims: string;
  integrity_proof: string;
}>;

/**
 * Verification seam for a real signature/MAC verifier or a deterministic test
 * verifier. This adapter deliberately does not implement substitute cryptography.
 */
export interface WorkspaceIntegrityProofVerifier {
  verify(verification: WorkspaceIntegrityProofVerification): boolean;
}

export type DeterministicWorkspaceAuthorizerOptions = Readonly<{
  clock: Clock;
  expected_issuer: string;
  expected_audience: string;
  workspace: WorkspaceState;
  policy: WorkspaceAuthorizationPolicy;
  integrity_proof_verifier?: WorkspaceIntegrityProofVerifier;
}>;

/** Deterministic adapter for the SPEC-506 Workspace authorization seam. */
export class DeterministicWorkspaceAuthorizer implements WorkspaceAuthorizer {
  readonly #options: DeterministicWorkspaceAuthorizerOptions;

  constructor(options: DeterministicWorkspaceAuthorizerOptions) {
    this.#options = options;
  }

  authorize(
    request: WorkspaceAuthorizationRequest,
  ): Promise<WorkspaceAuthorizationResult> {
    if (request.context.schema_version !== "1.0.0") {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context schema version is unsupported.",
          "unsupported-context-schema",
        ),
      );
    }
    const issuedAt = parseRfc3339Timestamp(request.context.issued_at);
    if (issuedAt === undefined) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context issued_at is malformed.",
          "issued-at-malformed",
        ),
      );
    }

    const expiresAt = parseRfc3339Timestamp(request.context.expires_at);
    if (expiresAt === undefined) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context expires_at is malformed.",
          "expires-at-malformed",
        ),
      );
    }

    if (issuedAt >= expiresAt) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context validity window is invalid.",
          "validity-window-invalid",
        ),
      );
    }

    const now = this.#options.clock.now().getTime();
    if (issuedAt > now) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context was issued in the future.",
          "issued-at-future",
        ),
      );
    }

    if (expiresAt <= now) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "expired_context",
          "Workspace context has expired.",
          "expired-context",
        ),
      );
    }

    if (request.context.workspace_id !== this.#options.workspace.workspace_id) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context does not match the configured Workspace.",
          "workspace-context-mismatch",
        ),
      );
    }

    if (
      this.#options.policy.workspace_id !==
      this.#options.workspace.workspace_id
    ) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Authorization policy does not belong to the configured Workspace.",
          "workspace-policy-mismatch",
        ),
      );
    }

    if (!request.context.audience.includes(this.#options.expected_audience)) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "wrong_audience",
          "Workspace context has the wrong audience.",
          "wrong-audience",
        ),
      );
    }

    if (request.context.issuer !== this.#options.expected_issuer) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context issuer is not trusted.",
          "untrusted-issuer",
        ),
      );
    }

    if (
      !verifiedIntegrityProof(
        request.context,
        this.#options.integrity_proof_verifier,
      )
    ) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "invalid_context",
          "Workspace context integrity proof could not be verified.",
          "integrity-proof-invalid",
        ),
      );
    }

    if (request.context.policy_version !== this.#options.policy.version) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "stale_policy",
          "Workspace context does not reference the active policy.",
          "stale-policy",
          true,
        ),
      );
    }

    if (this.#options.workspace.status === "suspended") {
      return Promise.resolve(
        denied(
          request.operation_id,
          "suspended_workspace",
          "Workspace is suspended.",
          "workspace-suspended",
        ),
      );
    }

    const policyPermissions = new Set(this.#options.policy.permissions);
    const effectivePermissions = unique(request.context.permissions).filter(
      (permission) => policyPermissions.has(permission),
    );
    const effectivePermissionSet = new Set(effectivePermissions);

    if (
      unique(request.required_permissions).some(
        (permission) => !effectivePermissionSet.has(permission),
      )
    ) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "insufficient_permission",
          "One or more required permissions are not authorized.",
          "required-permission-missing",
        ),
      );
    }

    const crossWorkspaceIds = crossWorkspaceTargets(
      request.resource_refs,
      request.context.workspace_id,
    );
    const administrativeApproval = authorizedAdministrativeScope(
      request,
      effectivePermissionSet,
      crossWorkspaceIds,
    );

    if (crossWorkspaceIds.length > 0 && administrativeApproval === undefined) {
      return Promise.resolve(
        denied(
          request.operation_id,
          "insufficient_permission",
          "Cross-Workspace resources are outside the authorized scope.",
          "cross-workspace-scope-denied",
        ),
      );
    }

    return Promise.resolve({
      ok: true,
      value: {
        policy_version: this.#options.policy.version,
        effective_permissions: effectivePermissions,
        authorized_resource_refs: unique(request.resource_refs),
        decision_evidence: [
          "authorization:allow",
          `operation:${request.operation_id}`,
          `workspace:${request.context.workspace_id}`,
          `policy:${this.#options.policy.version}`,
          ...(administrativeApproval === undefined
            ? []
            : [`administrative-scope:${administrativeApproval}`]),
          `effective-permissions:${effectivePermissions.length}`,
          `authorized-resources:${unique(request.resource_refs).length}`,
        ],
      },
    });
  }
}

/**
 * Produces an unambiguous, stable payload for integrity verification. Set-like
 * claims are normalized so authorization semantics, rather than input order,
 * determine the signed payload. The proof itself is never included.
 */
export function canonicalWorkspaceIntegrityClaims(
  context: WorkspaceAuthorizationRequest["context"],
): string {
  const administrativeScope = context.administrative_scope;

  return JSON.stringify({
    schema_version: context.schema_version,
    issuer: context.issuer,
    audience: sortedUnique(context.audience),
    workspace_id: context.workspace_id,
    actor: {
      id: context.actor_id,
      type: context.actor_type,
    },
    roles: sortedUnique(context.roles),
    permissions: sortedUnique(context.permissions),
    policy_version: context.policy_version,
    request_id: context.request_id,
    correlation_id: context.correlation_id,
    environment: context.environment,
    issued_at: context.issued_at,
    expires_at: context.expires_at,
    administrative_scope:
      administrativeScope === undefined
        ? null
        : {
            purpose: administrativeScope.purpose,
            target_workspace_ids: sortedUnique(
              administrativeScope.target_workspace_ids,
            ),
            approval_ref: administrativeScope.approval_ref,
          },
  });
}

function verifiedIntegrityProof(
  context: WorkspaceAuthorizationRequest["context"],
  verifier: WorkspaceIntegrityProofVerifier | undefined,
): boolean {
  if (verifier === undefined || context.integrity_proof.length === 0) {
    return false;
  }

  try {
    return verifier.verify({
      canonical_claims: canonicalWorkspaceIntegrityClaims(context),
      integrity_proof: context.integrity_proof,
    });
  } catch {
    return false;
  }
}

function parseRfc3339Timestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(
    value,
  );
  if (match === null) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zone === undefined
  ) {
    return undefined;
  }

  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return undefined;
    }
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function denied(
  operationId: string,
  code:
    | "expired_context"
    | "invalid_context"
    | "wrong_audience"
    | "stale_policy"
    | "suspended_workspace"
    | "insufficient_permission",
  message: string,
  reason: string,
  retryable = false,
): WorkspaceAuthorizationResult {
  return {
    ok: false,
    failure: {
      code,
      message,
      retryable,
      evidence: [
        "authorization:deny",
        `operation:${operationId}`,
        `reason:${reason}`,
      ],
    },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sortedUnique(values: readonly string[]): string[] {
  return unique(values).sort();
}

function crossWorkspaceTargets(
  resourceRefs: readonly string[],
  contextWorkspaceId: string,
): string[] {
  const prefix = "workspace:";
  const targets: string[] = [];

  for (const resourceRef of resourceRefs) {
    if (!resourceRef.startsWith(prefix)) {
      continue;
    }

    const scopedRef = resourceRef.slice(prefix.length);
    if (
      scopedRef === contextWorkspaceId ||
      scopedRef.startsWith(`${contextWorkspaceId}/`)
    ) {
      continue;
    }

    const separator = scopedRef.indexOf("/");
    targets.push(separator === -1 ? scopedRef : scopedRef.slice(0, separator));
  }

  return unique(targets);
}

function authorizedAdministrativeScope(
  request: WorkspaceAuthorizationRequest,
  effectivePermissions: ReadonlySet<string>,
  crossWorkspaceIds: readonly string[],
): string | undefined {
  if (crossWorkspaceIds.length === 0) {
    return undefined;
  }

  const scope = request.context.administrative_scope;
  if (
    scope === undefined ||
    scope.approval_ref.length === 0 ||
    scope.purpose.length === 0 ||
    scope.purpose !== request.purpose ||
    scope.target_workspace_ids.length === 0 ||
    !effectivePermissions.has("workspace:cross_read")
  ) {
    return undefined;
  }

  const approvedTargets = new Set(scope.target_workspace_ids);
  return crossWorkspaceIds.every((workspaceId) =>
    approvedTargets.has(workspaceId)
  )
    ? scope.approval_ref
    : undefined;
}
