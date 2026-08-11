/**
 * Shared helpers: resolve MCP password / basic-auth / field values through
 * the Workspace credential registry when the caller supplies secret_ref
 * instead of a literal. Literals remain supported for local demos.
 */
import type { JsonObject, JsonValue } from "../requirement-review/public.js";
import type { WorkspaceCredentialRegistry } from "./workspace-credential-registry.js";

export type ResolvedSecret =
  | Readonly<{ ok: true; value: string; via: "literal" | "secret_ref"; secret_ref?: string }>
  | Readonly<{ ok: false; message: string }>;

export function resolvePasswordInput(input: Readonly<{
  registry: WorkspaceCredentialRegistry | undefined;
  workspaceId: string;
  password?: string;
  password_secret_ref?: string;
}>): ResolvedSecret {
  const literal = input.password?.trim();
  const ref = input.password_secret_ref?.trim();
  if (literal && ref) {
    return { ok: false, message: "Supply password or password_secret_ref, not both." };
  }
  if (ref) {
    if (input.registry === undefined) {
      return { ok: false, message: `password_secret_ref "${ref}" supplied but no Workspace credential registry is configured.` };
    }
    const value = input.registry.resolveSync(ref, input.workspaceId);
    if (value === undefined) {
      return { ok: false, message: `password_secret_ref "${ref}" is not registered in this Workspace.` };
    }
    return { ok: true, value, via: "secret_ref", secret_ref: ref };
  }
  if (literal) {
    return { ok: true, value: literal, via: "literal" };
  }
  return { ok: false, message: "Login requires password or password_secret_ref." };
}

/** Optional Bearer token for API smoke — omit both for unauthenticated calls. */
export function resolveBearerToken(input: Readonly<{
  registry: WorkspaceCredentialRegistry | undefined;
  workspaceId: string;
  token?: string;
  token_secret_ref?: string;
}>):
  | Readonly<{ ok: true; value: string; via: "literal" | "secret_ref"; secret_ref?: string }>
  | Readonly<{ ok: true; value: undefined }>
  | Readonly<{ ok: false; message: string }> {
  const literal = input.token?.trim();
  const ref = input.token_secret_ref?.trim();
  if (!literal && !ref) return { ok: true, value: undefined };
  if (literal && ref) {
    return { ok: false, message: "Supply bearer_token or bearer_token_secret_ref, not both." };
  }
  if (ref) {
    if (input.registry === undefined) {
      return { ok: false, message: `bearer_token_secret_ref "${ref}" supplied but no Workspace credential registry is configured.` };
    }
    const value = input.registry.resolveSync(ref, input.workspaceId);
    if (value === undefined) {
      return { ok: false, message: `bearer_token_secret_ref "${ref}" is not registered in this Workspace.` };
    }
    return { ok: true, value, via: "secret_ref", secret_ref: ref };
  }
  return { ok: true, value: literal!, via: "literal" };
}

export function resolveBasicAuthPassword(input: Readonly<{
  registry: WorkspaceCredentialRegistry | undefined;
  workspaceId: string;
  username?: string;
  password?: string;
  password_secret_ref?: string;
}>): ResolvedSecret | Readonly<{ ok: true; value: undefined }> | Readonly<{ ok: false; message: string; partial: true }> {
  const username = input.username?.trim();
  const literal = input.password?.trim();
  const ref = input.password_secret_ref?.trim();
  const hasUser = !!username;
  const hasPass = !!literal || !!ref;
  if (!hasUser && !hasPass) return { ok: true, value: undefined };
  if (!hasUser || !hasPass) {
    return { ok: false, message: "basic_auth_username must be paired with basic_auth_password or basic_auth_password_secret_ref.", partial: true };
  }
  if (literal && ref) {
    return { ok: false, message: "Supply basic_auth_password or basic_auth_password_secret_ref, not both." };
  }
  if (ref) {
    if (input.registry === undefined) {
      return { ok: false, message: `basic_auth_password_secret_ref "${ref}" supplied but no Workspace credential registry is configured.` };
    }
    const value = input.registry.resolveSync(ref, input.workspaceId);
    if (value === undefined) {
      return { ok: false, message: `basic_auth_password_secret_ref "${ref}" is not registered in this Workspace.` };
    }
    return { ok: true, value, via: "secret_ref", secret_ref: ref };
  }
  return { ok: true, value: literal!, via: "literal" };
}

/** Merge field_values with field_secret_refs resolved through the registry. */
export function mergeFieldValuesWithSecrets(input: Readonly<{
  registry: WorkspaceCredentialRegistry | undefined;
  workspaceId: string;
  field_values?: Readonly<Record<string, string>>;
  field_secret_refs?: Readonly<Record<string, string>>;
}>): Readonly<{ ok: true; values: ReadonlyMap<string, string> }> | Readonly<{ ok: false; message: string }> {
  const map = new Map<string, string>();
  if (input.field_values !== undefined) {
    for (const [key, value] of Object.entries(input.field_values)) {
      map.set(key, value);
    }
  }
  if (input.field_secret_refs !== undefined) {
    for (const [key, ref] of Object.entries(input.field_secret_refs)) {
      if (input.registry === undefined) {
        return { ok: false, message: `field_secret_refs["${key}"] requires a Workspace credential registry.` };
      }
      if (map.has(key)) {
        return { ok: false, message: `field_values and field_secret_refs both set for "${key}" — pick one.` };
      }
      const value = input.registry.resolveSync(ref, input.workspaceId);
      if (value === undefined) {
        return { ok: false, message: `field_secret_refs["${key}"] ref "${ref}" is not registered in this Workspace.` };
      }
      map.set(key, value);
    }
  }
  return { ok: true, values: map };
}

export function readStringMap(value: JsonValue | undefined): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as JsonObject)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
