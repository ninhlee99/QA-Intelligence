import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicWorkspaceAuthorizer,
  canonicalWorkspaceIntegrityClaims,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
import { buildDevFixture } from "../../src/mcp/dev-fixture.js";
import { compactMcpInput } from "../../src/mcp/mcp-input.js";

const WORKSPACE_ID = "workspace-catalog-001";
const POLICY_VERSION = "test-policy@0.1.0";
const ISSUER = "identity-test";
const AUDIENCE = "qa-intelligence-test";

function fixtureProof(canonicalClaims: string): string {
  return createHash("sha256").update(`fixture:${canonicalClaims}`).digest("hex");
}

function authorizer() {
  const clock = { now: (): Date => new Date("2026-08-10T08:00:00.000Z") };
  const permissions = [
    "agent:execute",
    "agent:read",
    "requirement:read",
    "requirement:create",
    "knowledge:read",
    "assessment:create",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
    "discovery:observe",
    "test-case:create",
    "defect:read",
    "workflow:read",
    "risk:read",
    "test_strategy:read",
    "test_case:read",
    "test_dataset:read",
    "automation_asset:read",
    "report:read",
    "execution_record:read",
    "credential:register",
    "credential:read",
    "environment:register",
    "environment:read",
    "test_dataset:create",
    "automation_asset:create",
  ];
  return new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: ISSUER,
    expected_audience: AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: POLICY_VERSION, permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });
}

const EXPECTED_TOOLS = [
  "assess_requirement_quality",
  "execute_browser_test",
  "discover_ui_surface",
  "discover_ui_surface_after_login",
  "generate_test_cases",
  "execute_generated_test_case",
  "run_auto_qa",
  "bootstrap_domain_pack",
  "run_expert_qa",
  "validate_expert_claim",
  "assess_ui_accessibility_smoke",
  "generate_exploratory_charter",
  "execute_exploratory_session",
  "assess_defect_quality",
  "register_workspace_secret",
  "list_workspace_secrets",
  "assess_business_analysis_quality",
  "assess_risk_quality",
  "assess_test_strategy_quality",
  "assess_test_case_quality",
  "assess_test_dataset_quality",
  "assess_automation_asset_quality",
  "assess_report_quality",
  "execute_api_smoke",
  "run_depth_smokes",
  "list_failure_avoidance_hints",
  "discover_product_context",
  "assess_execution_record_quality",
  "draft_defects_from_qa_run",
  "register_workspace_environment",
  "list_workspace_environments",
  "generate_business_analysis_stub",
  "generate_risk_stub",
  "generate_test_strategy_stub",
  "register_test_dataset",
  "list_test_datasets",
  "resolve_test_dataset_fields",
  "create_automation_asset",
  "evaluate_test_case_quality_skill",
  "raise_mistake_recurrence_candidate",
  "list_learning_candidates",
  "capture_ui_baseline",
  "compare_ui_baseline",
  "register_ui_surface_baseline",
  "compare_ui_surface_to_baseline",
  "register_requirement",
  "list_requirements",
  "discover_ui_workflow",
  "register_regression_suite",
  "list_regression_suites",
  "run_regression_suite",
  "generate_api_smoke_from_openapi",
  "export_defects_for_tracker",
  "file_defects_to_tracker",
  "register_knowledge_record",
  "compare_ui_surfaces",
  "discover_and_compare_role_ui_surfaces",
  "generate_journey_test_cases",
  "set_user_preference",
  "get_user_preference",
] as const;

test("dev fixture registers the full MCP catalog without duplicates", () => {
  const clock = { now: (): Date => new Date("2026-08-10T08:00:00.000Z") };
  const { tools } = buildDevFixture({
    workspaceId: WORKSPACE_ID,
    policyVersion: POLICY_VERSION,
    authorizer: authorizer(),
    clock,
    sessionMemory: new SessionMemory(clock),
  });

  const names = tools.map((tool) => tool.name);
  assert.equal(names.length, new Set(names).size, "duplicate tool names");
  for (const expected of EXPECTED_TOOLS) {
    assert.equal(names.includes(expected), true, `missing tool ${expected}`);
  }

  for (const tool of tools) {
    assert.ok(tool.agent.id.length > 0, `${tool.name} missing agent`);
    assert.ok((tool.allowed_skills?.length ?? 0) > 0, `${tool.name} missing allowed_skills`);
    assert.ok(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name} missing inputSchema`);
    assert.equal(typeof tool.buildInput, "function", `${tool.name} missing buildInput`);
    // Every tool must survive an empty args object without throwing.
    assert.doesNotThrow(() => tool.buildInput({}), `${tool.name} buildInput threw on {}`);
  }
});

test("compactMcpInput drops empty placeholders", () => {
  assert.deepEqual(
    compactMcpInput({
      url: "https://example.test",
      browser: "",
      stages: [],
      timeout_ms: 0,
      headers: {},
      flag: false,
    }),
    { url: "https://example.test", flag: false },
  );
});
