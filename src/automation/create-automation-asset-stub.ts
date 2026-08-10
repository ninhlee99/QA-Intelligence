/**
 * SPEC-209 thin create path: draft an AutomationAsset from TestCase refs.
 * Does not emit executable scripts — governance object for
 * `assess_automation_asset_quality`.
 */
import type { AutomationAsset } from "./public.js";

export type CreateAutomationAssetStubInput = Readonly<{
  workspace_id: string;
  implemented_test_case_refs: readonly string[];
  owner?: string;
  environment_constraints?: readonly string[];
  execution_interface?: string;
  id?: string;
}>;

export type CreateAutomationAssetStubResult =
  | Readonly<{ ok: true; asset: AutomationAsset }>
  | Readonly<{ ok: false; code: "invalid_input"; message: string }>;

export function createAutomationAssetStub(input: CreateAutomationAssetStubInput): CreateAutomationAssetStubResult {
  if (input.workspace_id.trim().length === 0) {
    return { ok: false, code: "invalid_input", message: "workspace_id is required." };
  }
  const refs = input.implemented_test_case_refs.map((ref) => ref.trim()).filter((ref) => ref.length > 0);
  if (refs.length === 0) {
    return {
      ok: false,
      code: "invalid_input",
      message: "implemented_test_case_refs must contain at least one TestCase ref.",
    };
  }

  const id = input.id?.trim() || `automation-asset:${input.workspace_id}:${refs[0]}`;
  const asset: AutomationAsset = {
    id,
    version: "0.1.0-draft",
    status: "draft",
    implemented_test_case_refs: refs,
    execution_interface: input.execution_interface?.trim() || "playwright-semantic-steps@0.1.0",
    compatible_engine_refs: ["playwright-execution-engine@0.1.0"],
    environment_constraints:
      input.environment_constraints && input.environment_constraints.length > 0
        ? input.environment_constraints
        : ["Workspace environment allowlist", "No raw secrets on the wire"],
    owner: input.owner?.trim() || "QA Intelligence automation stub",
    evidence_mapping: ["execution-record.evidence", "screenshot-capture when configured"],
    assertion_map: refs.map((ref) => ({
      expected_result_ref: `${ref}#expected`,
      assertion_implementation: "semantic-dom-text-or-forbidden-text via PlaywrightExecutionPlan.assert",
    })),
    retry_policy: "no-silent-retry; infrastructure faults reported separately",
  };
  return { ok: true, asset };
}
