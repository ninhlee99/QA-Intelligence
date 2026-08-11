/**
 * Workspace-scoped target environment registry (SPEC-512 §12 / Phase 6 half).
 * Hosts register approved base URLs once; discovery/execution resolve
 * `environment_ref` or check raw URLs against the allowlist. Credentials
 * stay in the credential registry — this module only binds identity + URL.
 *
 * Dev escape hatches (documented): `data:` fixture pages and loopback
 * (`127.0.0.1` / `localhost`) remain allowed without registration so local
 * integration fixtures keep working. Non-loopback http(s) MUST match a
 * registered base_url prefix (or exact match).
 */
export type EnvironmentRecord = Readonly<{
  environment_ref: string;
  workspace_id: string;
  /** Canonical base URL or exact fixture URL (data:…). */
  base_url: string;
  label: string;
  registered_at: string;
}>;

export type RegisterEnvironmentInput = Readonly<{
  workspace_id: string;
  environment_ref: string;
  base_url: string;
  label?: string;
}>;

export type RegisterEnvironmentResult =
  | Readonly<{ ok: true; record: EnvironmentRecord }>
  | Readonly<{
      ok: false;
      code: "invalid_ref" | "invalid_url" | "workspace_mismatch";
      message: string;
    }>;

export type ResolveTargetUrlInput = Readonly<{
  workspace_id: string;
  /** Preferred: resolve URL from a registered environment. */
  environment_ref?: string;
  /** Ad hoc URL — checked against allowlist when no environment_ref. */
  url?: string;
}>;

export type ResolveTargetUrlResult =
  | Readonly<{ ok: true; url: string; environment_ref?: string; via: "environment_ref" | "url" | "dev_escape" }>
  | Readonly<{
      ok: false;
      code: "missing_target" | "unknown_environment" | "url_not_allowed" | "workspace_mismatch";
      message: string;
    }>;

const REF_PATTERN = /^environment:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class InMemoryWorkspaceEnvironmentRegistry {
  readonly #byWorkspace = new Map<string, Map<string, EnvironmentRecord>>();
  readonly #clock: { now(): Date };

  constructor(clock: { now(): Date } = { now: () => new Date() }) {
    this.#clock = clock;
  }

  register(input: RegisterEnvironmentInput): RegisterEnvironmentResult {
    const ref = input.environment_ref.trim();
    if (!REF_PATTERN.test(ref)) {
      return {
        ok: false,
        code: "invalid_ref",
        message: `environment_ref must match ${REF_PATTERN} (got "${input.environment_ref}").`,
      };
    }
    const baseUrl = input.base_url.trim();
    if (baseUrl.length === 0) {
      return { ok: false, code: "invalid_url", message: "base_url must be non-empty." };
    }
    if (input.workspace_id.trim().length === 0) {
      return { ok: false, code: "workspace_mismatch", message: "workspace_id is required." };
    }

    const record: EnvironmentRecord = {
      environment_ref: ref,
      workspace_id: input.workspace_id,
      base_url: baseUrl,
      label: input.label?.trim() || ref.replace(/^environment:/, ""),
      registered_at: this.#clock.now().toISOString(),
    };
    let bucket = this.#byWorkspace.get(input.workspace_id);
    if (bucket === undefined) {
      bucket = new Map();
      this.#byWorkspace.set(input.workspace_id, bucket);
    }
    bucket.set(ref, record);
    return { ok: true, record };
  }

  list(workspaceId: string): readonly EnvironmentRecord[] {
    const bucket = this.#byWorkspace.get(workspaceId);
    if (bucket === undefined) return [];
    return [...bucket.values()].sort((a, b) => a.environment_ref.localeCompare(b.environment_ref));
  }

  get(workspaceId: string, environmentRef: string): EnvironmentRecord | undefined {
    return this.#byWorkspace.get(workspaceId)?.get(environmentRef.trim());
  }

  /**
   * Resolve a target URL for navigation. Prefer `environment_ref`; otherwise
   * validate `url` against registered bases / dev escape hatches.
   */
  resolveTargetUrl(input: ResolveTargetUrlInput): ResolveTargetUrlResult {
    if (input.workspace_id.trim().length === 0) {
      return { ok: false, code: "workspace_mismatch", message: "workspace_id is required." };
    }

    const envRef = input.environment_ref?.trim();
    if (envRef !== undefined && envRef.length > 0) {
      const record = this.get(input.workspace_id, envRef);
      if (record === undefined) {
        return {
          ok: false,
          code: "unknown_environment",
          message: `environment_ref "${envRef}" is not registered for this Workspace.`,
        };
      }
      return { ok: true, url: record.base_url, environment_ref: record.environment_ref, via: "environment_ref" };
    }

    const url = input.url?.trim();
    if (url === undefined || url.length === 0) {
      return {
        ok: false,
        code: "missing_target",
        message: "Provide environment_ref or url.",
      };
    }

    if (isDevEscapeUrl(url)) {
      return { ok: true, url, via: "dev_escape" };
    }

    if (this.isUrlAllowed(input.workspace_id, url)) {
      return { ok: true, url, via: "url" };
    }

    return {
      ok: false,
      code: "url_not_allowed",
      message: `URL is not in the Workspace environment allowlist (register via register_workspace_environment): ${url}`,
    };
  }

  /** True when url equals or is under a registered base_url for the workspace. */
  isUrlAllowed(workspaceId: string, url: string): boolean {
    if (isDevEscapeUrl(url)) return true;
    const bucket = this.#byWorkspace.get(workspaceId);
    if (bucket === undefined) return false;
    for (const record of bucket.values()) {
      if (urlMatchesBase(url, record.base_url)) return true;
    }
    return false;
  }
}

export function isDevEscapeUrl(url: string): boolean {
  if (url.startsWith("data:")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function urlMatchesBase(url: string, baseUrl: string): boolean {
  if (url === baseUrl) return true;
  // Prefix match for path hierarchies under a registered staging root.
  if (baseUrl.endsWith("/")) return url.startsWith(baseUrl);
  return url.startsWith(`${baseUrl}/`) || url.startsWith(baseUrl);
}
