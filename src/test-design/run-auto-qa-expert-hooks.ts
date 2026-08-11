/**
 * Optional Expert extensions after the core screen pipeline — best-effort,
 * never fails the parent run_auto_qa when hooks miss or error.
 */
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { openApiToApiSmokeCases } from "../api-testing/openapi-to-smoke-cases.js";
import {
  discoverAndCompareRoleSurfaces,
  type RoleSessionLogin,
} from "../discovery/discover-and-compare-role-surfaces.js";
import type { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import type { DiscoverUiWorkflow } from "../discovery/discover-ui-workflow.js";
import type { JsonObject, JsonValue, WorkspaceContext } from "../requirement-review/public.js";
import { generateJourneyTestCases } from "./generate-journey-test-cases.js";
import type { RegressionCase } from "./regression-suite-registry.js";
import { resolvePasswordInput } from "../credentials/resolve-secret-input.js";
import type { WorkspaceCredentialRegistry } from "../credentials/workspace-credential-registry.js";

export type ExpertHookLoginA = Readonly<{
  login_url: string;
  username_field_name: string;
  username: string;
  password_field_name: string;
  password?: string;
  password_secret_ref?: string;
  submit_action_name: string;
}>;

export type RunExpertHooksInput = Readonly<{
  operation_id: string;
  workspace_id: string;
  context: WorkspaceContext;
  target_url: string;
  requirement_ref: string;
  raw_input: Readonly<Record<string, JsonValue | undefined>>;
  login_a?: ExpertHookLoginA;
  discoverAfterLogin: DiscoverAfterLogin;
  discoverUiWorkflow?: DiscoverUiWorkflow;
  credentials?: WorkspaceCredentialRegistry;
}>;

export type ExpertHooksResult = Readonly<{
  extensions: JsonObject;
  extra_regression_cases: readonly RegressionCase[];
}>;

export async function runExpertHooks(input: RunExpertHooksInput): Promise<ExpertHooksResult> {
  const extensions: Record<string, JsonValue> = {};
  const extra: RegressionCase[] = [];

  await attachOpenApi(input, extensions, extra);
  await attachRoleCompare(input, extensions);
  await attachJourneys(input, extensions, extra);

  return { extensions, extra_regression_cases: extra };
}

async function attachOpenApi(
  input: RunExpertHooksInput,
  extensions: Record<string, JsonValue>,
  extra: RegressionCase[],
): Promise<void> {
  const openapiObj = input.raw_input["openapi"];
  const openapiPath = readString(input.raw_input["openapi_path"]);
  let doc: JsonObject | undefined;
  if (
    openapiObj !== undefined &&
    typeof openapiObj === "object" &&
    openapiObj !== null &&
    !Array.isArray(openapiObj) &&
    Object.keys(openapiObj).length > 0
  ) {
    doc = openapiObj as JsonObject;
  } else if (openapiPath !== undefined) {
    if (!isAbsolute(openapiPath)) {
      extensions["openapi_hook"] = { ok: false, message: "openapi_path must be absolute." };
      return;
    }
    try {
      const text = await readFile(openapiPath, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        extensions["openapi_hook"] = { ok: false, message: "openapi_path must contain a JSON object." };
        return;
      }
      doc = parsed as JsonObject;
    } catch (error) {
      extensions["openapi_hook"] = {
        ok: false,
        message: `Failed to read openapi_path: ${(error as Error).message}`,
      };
      return;
    }
  } else {
    return;
  }

  const includeAuthz = input.raw_input["include_authz_negatives"] === true;
  const includeWrongRole = input.raw_input["include_wrong_role_negatives"] === true;
  const converted = openApiToApiSmokeCases(doc, {
    ...(includeAuthz ? { include_authz_negatives: true } : {}),
    ...(includeWrongRole ? { include_wrong_role_negatives: true } : {}),
  });
  if (!converted.ok) {
    extensions["openapi_hook"] = { ok: false, message: converted.message };
    return;
  }
  for (const apiCase of converted.cases) {
    extra.push({ kind: "api", case: apiCase });
  }
  extensions["openapi_hook"] = {
    ok: true,
    case_count: converted.cases.length,
    warnings: [...converted.warnings],
    note: "API smoke cases merged into auto-registered suite when registry present. Execute via run_regression_suite or execute_api_smoke.",
  };
}

async function attachRoleCompare(
  input: RunExpertHooksInput,
  extensions: Record<string, JsonValue>,
): Promise<void> {
  const roleBRaw = input.raw_input["role_b"];
  if (roleBRaw === undefined || roleBRaw === null) return;
  if (typeof roleBRaw !== "object" || Array.isArray(roleBRaw) || Object.keys(roleBRaw).length === 0) {
    if (typeof roleBRaw === "object" && roleBRaw !== null && !Array.isArray(roleBRaw) && Object.keys(roleBRaw).length === 0) {
      return;
    }
    extensions["role_compare_hook"] = { ok: false, message: "role_b must be an object." };
    return;
  }
  if (input.login_a === undefined) {
    extensions["role_compare_hook"] = {
      ok: false,
      message: "role_b requires login_* fields on run_auto_qa (role A session).",
    };
    return;
  }

  const roleBObj = roleBRaw as JsonObject;
  const roleB = parseRoleB(roleBObj, input.target_url);
  if (!roleB.ok) {
    extensions["role_compare_hook"] = { ok: false, message: roleB.message };
    return;
  }

  const passwordA = resolvePasswordInput({
    registry: input.credentials,
    workspaceId: input.workspace_id,
    ...(input.login_a.password !== undefined ? { password: input.login_a.password } : {}),
    ...(input.login_a.password_secret_ref !== undefined
      ? { password_secret_ref: input.login_a.password_secret_ref }
      : {}),
  });
  if (!passwordA.ok) {
    extensions["role_compare_hook"] = { ok: false, message: passwordA.message };
    return;
  }
  const passwordB = resolvePasswordInput({
    registry: input.credentials,
    workspaceId: input.workspace_id,
    ...(roleB.value.password !== undefined ? { password: roleB.value.password } : {}),
    ...(roleB.value.password_secret_ref !== undefined
      ? { password_secret_ref: roleB.value.password_secret_ref }
      : {}),
  });
  if (!passwordB.ok) {
    extensions["role_compare_hook"] = { ok: false, message: passwordB.message };
    return;
  }

  const roleA: RoleSessionLogin = {
    label: "role_a",
    login_url: input.login_a.login_url,
    target_url: input.target_url,
    username_field_name: input.login_a.username_field_name,
    username: input.login_a.username,
    password_field_name: input.login_a.password_field_name,
    password: passwordA.value,
    submit_action_name: input.login_a.submit_action_name,
  };
  const roleBSession: RoleSessionLogin = {
    label: readString(roleBObj["label"]) ?? "role_b",
    login_url: roleB.value.login_url,
    target_url: roleB.value.target_url,
    username_field_name: roleB.value.username_field_name,
    username: roleB.value.username,
    password_field_name: roleB.value.password_field_name,
    password: passwordB.value,
    submit_action_name: roleB.value.submit_action_name,
  };

  try {
    const compared = await discoverAndCompareRoleSurfaces(
      { discoverAfterLogin: input.discoverAfterLogin },
      {
        operation_id: input.operation_id,
        context: input.context,
        role_a: roleA,
        role_b: roleBSession,
      },
    );
    if (!compared.ok) {
      extensions["role_compare_hook"] = {
        ok: false,
        message: compared.failure.message,
        evidence: [...compared.failure.evidence],
      };
      return;
    }
    extensions["role_compare_hook"] = {
      ok: true,
      label_a: compared.value.label_a,
      label_b: compared.value.label_b,
      only_in_a: [...compared.value.diff.only_in_a],
      only_in_b: [...compared.value.diff.only_in_b],
      shared_count: compared.value.diff.shared.length,
      summary: compared.value.diff.summary,
      note: "Named-control diff only — Host interprets authz; not a permission model.",
    };
  } catch (error) {
    extensions["role_compare_hook"] = {
      ok: false,
      message: `role_compare failed: ${(error as Error).message}`,
    };
  }
}

async function attachJourneys(
  input: RunExpertHooksInput,
  extensions: Record<string, JsonValue>,
  extra: RegressionCase[],
): Promise<void> {
  if (input.raw_input["include_workflow_journeys"] !== true) return;
  if (input.discoverUiWorkflow === undefined) {
    extensions["journey_hook"] = {
      ok: false,
      message: "include_workflow_journeys requested but DiscoverUiWorkflow not configured.",
    };
    return;
  }

  try {
    const discovered = await input.discoverUiWorkflow.discover({
      operation_id: input.operation_id,
      context: input.context,
      url: input.target_url,
      max_pages: 3,
    });
    if (!discovered.ok) {
      extensions["journey_hook"] = { ok: false, message: discovered.failure.message };
      return;
    }
    const journeys = generateJourneyTestCases({
      workspace_id: input.workspace_id,
      start_url: input.target_url,
      pages: discovered.value.pages,
      edges: discovered.value.edges,
      requirement_ref: input.requirement_ref,
      max_hops: 3,
    });
    const assertionById = new Map(
      journeys.generated_assertions.map((assertion) => [assertion.test_case_id, assertion] as const),
    );
    let added = 0;
    for (const testCase of journeys.test_cases) {
      const assertion = assertionById.get(testCase.id);
      if (assertion === undefined) continue;
      extra.push({ kind: "browser", test_case: testCase, generated_assertion: assertion });
      added += 1;
    }
    extensions["journey_hook"] = {
      ok: true,
      page_count: discovered.value.pages.length,
      edge_count: discovered.value.edges.length,
      journey_cases_added: added,
      findings: [...journeys.findings],
      note: "Journey cases merged into auto-registered suite; not executed in this run_auto_qa pass — retest via run_regression_suite.",
    };
  } catch (error) {
    extensions["journey_hook"] = {
      ok: false,
      message: `journey_hook failed: ${(error as Error).message}`,
    };
  }
}

function parseRoleB(
  obj: JsonObject,
  defaultTarget: string,
):
  | Readonly<{
      ok: true;
      value: Readonly<{
        login_url: string;
        target_url: string;
        username_field_name: string;
        username: string;
        password_field_name: string;
        password?: string;
        password_secret_ref?: string;
        submit_action_name: string;
      }>;
    }>
  | Readonly<{ ok: false; message: string }> {
  const login_url = readString(obj["login_url"]);
  const target_url = readString(obj["target_url"]) ?? defaultTarget;
  const username_field_name = readString(obj["username_field_name"]);
  const username = readString(obj["username"]);
  const password_field_name = readString(obj["password_field_name"]);
  const submit_action_name = readString(obj["submit_action_name"]);
  const password = readString(obj["password"]);
  const password_secret_ref = readString(obj["password_secret_ref"]);
  if (
    login_url === undefined ||
    username_field_name === undefined ||
    username === undefined ||
    password_field_name === undefined ||
    submit_action_name === undefined
  ) {
    return {
      ok: false,
      message:
        "role_b requires login_url, username_field_name, username, password_field_name, submit_action_name, and password or password_secret_ref.",
    };
  }
  if ((password === undefined && password_secret_ref === undefined) || (password !== undefined && password_secret_ref !== undefined)) {
    return { ok: false, message: "role_b requires exactly one of password or password_secret_ref." };
  }
  return {
    ok: true,
    value: {
      login_url,
      target_url,
      username_field_name,
      username,
      password_field_name,
      submit_action_name,
      ...(password !== undefined ? { password } : {}),
      ...(password_secret_ref !== undefined ? { password_secret_ref } : {}),
    },
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
