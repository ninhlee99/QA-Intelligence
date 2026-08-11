/**
 * Workspace-scoped credential registry (Phase 6,
 * docs/proposals/professional-qa-mcp-roadmap.md). Implements SPEC-407 §4
 * "approved injection": callers register secrets once by opaque ref; MCP
 * tool args carry only the ref. Values never appear in list/read MCP
 * responses. Implements Playwright `SecretResolver` so execution plans can
 * resolve `secret_ref` without a second secret channel.
 */
import type { WorkspaceContext } from "../requirement-review/public.js";
import type { SecretResolver } from "../adapters/playwright/playwright-execution-engine.js";

export type CredentialKind = "password" | "api_token" | "basic_auth_password" | "other";

export type CredentialRecord = Readonly<{
  secret_ref: string;
  workspace_id: string;
  kind: CredentialKind;
  /** Human label for operators — never the secret value. */
  label: string;
  registered_at: string;
}>;

export type RegisterCredentialInput = Readonly<{
  workspace_id: string;
  secret_ref: string;
  value: string;
  kind?: CredentialKind;
  label?: string;
}>;

export type RegisterCredentialResult =
  | Readonly<{ ok: true; record: CredentialRecord; persisted_path?: string }>
  | Readonly<{ ok: false; code: "invalid_ref" | "empty_value" | "workspace_mismatch"; message: string }>;

/** Structural store used by MCP / Skills — in-memory or file-backed. */
export type WorkspaceCredentialRegistry = {
  register(input: RegisterCredentialInput): RegisterCredentialResult;
  list(workspaceId: string): readonly CredentialRecord[];
  resolve(secretRef: string, workspace: WorkspaceContext): Promise<string | undefined>;
  resolveSync(secretRef: string, workspaceId: string): string | undefined;
};

const REF_PATTERN = /^workspace-secret:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * In-memory registry for the dev MCP slice. Production vault/KMS is out of
 * scope (Phase 6 DoD). Isolation is by `workspace_id` on every resolve.
 */
export class InMemoryWorkspaceCredentialRegistry implements SecretResolver {
  readonly #byWorkspace = new Map<string, Map<string, { value: string; record: CredentialRecord }>>();
  readonly #clock: { now(): Date };

  constructor(clock: { now(): Date } = { now: () => new Date() }) {
    this.#clock = clock;
  }

  register(input: RegisterCredentialInput): RegisterCredentialResult {
    const ref = input.secret_ref.trim();
    if (!REF_PATTERN.test(ref)) {
      return {
        ok: false,
        code: "invalid_ref",
        message: `secret_ref must match ${REF_PATTERN} (got "${input.secret_ref}").`,
      };
    }
    if (input.value.length === 0) {
      return { ok: false, code: "empty_value", message: "Credential value must be non-empty." };
    }
    if (input.workspace_id.trim().length === 0) {
      return { ok: false, code: "workspace_mismatch", message: "workspace_id is required." };
    }

    const record: CredentialRecord = {
      secret_ref: ref,
      workspace_id: input.workspace_id,
      kind: input.kind ?? "password",
      label: input.label?.trim() || ref.replace(/^workspace-secret:/, ""),
      registered_at: this.#clock.now().toISOString(),
    };
    let bucket = this.#byWorkspace.get(input.workspace_id);
    if (bucket === undefined) {
      bucket = new Map();
      this.#byWorkspace.set(input.workspace_id, bucket);
    }
    bucket.set(ref, { value: input.value, record });
    return { ok: true, record };
  }

  /** Metadata only — never returns the secret value. */
  list(workspaceId: string): readonly CredentialRecord[] {
    const bucket = this.#byWorkspace.get(workspaceId);
    if (bucket === undefined) return [];
    return [...bucket.values()].map((entry) => entry.record).sort((a, b) => a.secret_ref.localeCompare(b.secret_ref));
  }

  async resolve(secretRef: string, workspace: WorkspaceContext): Promise<string | undefined> {
    const bucket = this.#byWorkspace.get(workspace.workspace_id);
    if (bucket === undefined) return undefined;
    return bucket.get(secretRef)?.value;
  }

  /** Sync resolve for Skills that already hold WorkspaceContext (login forms). */
  resolveSync(secretRef: string, workspaceId: string): string | undefined {
    return this.#byWorkspace.get(workspaceId)?.get(secretRef)?.value;
  }
}
