/**
 * Orchestrate two after-login discoveries (role A vs role B) then compare
 * named controls. Does not invent permission models — only sessions + diff.
 */
import type { DiscoverAfterLogin, DiscoverAfterLoginRequest } from "./discover-after-login.js";
import { compareUiSurfaces, type UiSurfaceCompareResult } from "./compare-ui-surfaces.js";
import type { SemanticUiMap } from "./public.js";
import type { WorkspaceContext } from "../requirement-review/public.js";

export type RoleSessionLogin = Readonly<{
  label: string;
  login_url: string;
  target_url: string;
  username_field_name?: string;
  username?: string;
  password_field_name?: string;
  password?: string;
  submit_action_name?: string;
  sso_action_name?: string;
  sso_wait_url_includes?: string;
  basic_auth_username?: string;
  basic_auth_password?: string;
}>;

export type DiscoverAndCompareRoleSurfacesInput = Readonly<{
  operation_id: string;
  context: WorkspaceContext;
  role_a: RoleSessionLogin;
  role_b: RoleSessionLogin;
}>;

export type DiscoverAndCompareRoleSurfacesFailure = Readonly<{
  class: string;
  code: string;
  message: string;
  retryable: boolean;
  evidence: readonly string[];
  role?: "a" | "b";
}>;

export type DiscoverAndCompareRoleSurfacesResult =
  | Readonly<{
      ok: true;
      value: Readonly<{
        label_a: string;
        label_b: string;
        map_a: SemanticUiMap;
        map_b: SemanticUiMap;
        diff: UiSurfaceCompareResult;
      }>;
    }>
  | Readonly<{ ok: false; failure: DiscoverAndCompareRoleSurfacesFailure }>;

export type DiscoverAndCompareRoleSurfacesDependencies = Readonly<{
  discoverAfterLogin: DiscoverAfterLogin;
}>;

export async function discoverAndCompareRoleSurfaces(
  dependencies: DiscoverAndCompareRoleSurfacesDependencies,
  input: DiscoverAndCompareRoleSurfacesInput,
): Promise<DiscoverAndCompareRoleSurfacesResult> {
  const mapA = await runRole(dependencies, input, "a", input.role_a);
  if (!mapA.ok) return { ok: false, failure: mapA.failure };
  const mapB = await runRole(dependencies, input, "b", input.role_b);
  if (!mapB.ok) return { ok: false, failure: mapB.failure };

  const diff = compareUiSurfaces({
    label_a: input.role_a.label,
    label_b: input.role_b.label,
    elements_a: mapA.value.elements,
    elements_b: mapB.value.elements,
  });

  return {
    ok: true,
    value: {
      label_a: input.role_a.label,
      label_b: input.role_b.label,
      map_a: mapA.value,
      map_b: mapB.value,
      diff,
    },
  };
}

async function runRole(
  dependencies: DiscoverAndCompareRoleSurfacesDependencies,
  input: DiscoverAndCompareRoleSurfacesInput,
  role: "a" | "b",
  session: RoleSessionLogin,
): Promise<
  Readonly<{ ok: true; value: SemanticUiMap }> | Readonly<{ ok: false; failure: DiscoverAndCompareRoleSurfacesFailure }>
> {
  const request: DiscoverAfterLoginRequest = {
    operation_id: `${input.operation_id}:role-${role}`,
    context: input.context,
    login_url: session.login_url,
    target_url: session.target_url,
    ...(session.username_field_name !== undefined ? { username_field_name: session.username_field_name } : {}),
    ...(session.username !== undefined ? { username: session.username } : {}),
    ...(session.password_field_name !== undefined ? { password_field_name: session.password_field_name } : {}),
    ...(session.password !== undefined ? { password: session.password } : {}),
    ...(session.submit_action_name !== undefined ? { submit_action_name: session.submit_action_name } : {}),
    ...(session.sso_action_name !== undefined ? { sso_action_name: session.sso_action_name } : {}),
    ...(session.sso_wait_url_includes !== undefined
      ? { sso_wait_url_includes: session.sso_wait_url_includes }
      : {}),
    ...(session.basic_auth_username !== undefined ? { basic_auth_username: session.basic_auth_username } : {}),
    ...(session.basic_auth_password !== undefined ? { basic_auth_password: session.basic_auth_password } : {}),
  };

  const discovered = await dependencies.discoverAfterLogin.discover(request);
  if (!discovered.ok) {
    return {
      ok: false,
      failure: {
        class: discovered.failure.class,
        code: discovered.failure.code,
        message: discovered.failure.message,
        retryable: discovered.failure.retryable,
        evidence: [...discovered.failure.evidence, `role:${role}`, `label:${session.label}`],
        role,
      },
    };
  }
  return { ok: true, value: discovered.value };
}
