import type { AgentRuntimeToolDefinition } from "./agent-runtime-tool-registry.js";

export const PRODUCTION_TOOL_PROFILES = ["expert", "full"] as const;
export type ProductionToolProfile = (typeof PRODUCTION_TOOL_PROFILES)[number];

const NON_PRODUCTION_TOOL_NAMES = new Set([
  "execute_browser_test",
  "generate_business_analysis_stub",
  "generate_risk_stub",
  "generate_test_strategy_stub",
  "evaluate_test_case_quality_skill",
]);

/** hosts/README.md's full MCP Tool Catalog minus NON_PRODUCTION_TOOL_NAMES (Demo only / Stub generators). */
const EXPERT_TOOL_NAMES = new Set([
  "assess_automation_asset_quality",
  "assess_business_analysis_quality",
  "assess_continuous_qa",
  "assess_deep_testing",
  "assess_defect_quality",
  "assess_execution_record_quality",
  "assess_report_quality",
  "assess_requirement_quality",
  "assess_risk_quality",
  "assess_test_case_quality",
  "assess_test_dataset_quality",
  "assess_test_strategy_quality",
  "assess_ui_accessibility_smoke",
  "bootstrap_domain_pack",
  "capture_ui_baseline",
  "compare_ui_baseline",
  "compare_ui_surface_to_baseline",
  "compare_ui_surfaces",
  "create_automation_asset",
  "discover_and_compare_role_ui_surfaces",
  "discover_product_context",
  "discover_ui_surface",
  "discover_ui_surface_after_login",
  "discover_ui_workflow",
  "draft_defects_from_qa_run",
  "execute_api_smoke",
  "execute_exploratory_session",
  "execute_generated_test_case",
  "export_defects_for_tracker",
  "file_defects_to_tracker",
  "generate_api_smoke_from_openapi",
  "generate_exploratory_charter",
  "generate_journey_test_cases",
  "generate_test_cases",
  "get_user_preference",
  "list_failure_avoidance_hints",
  "list_learning_candidates",
  "list_regression_suites",
  "list_requirements",
  "list_test_datasets",
  "list_workspace_environments",
  "list_workspace_secrets",
  "manage_evidence_lifecycle",
  "raise_mistake_recurrence_candidate",
  "register_knowledge_record",
  "register_regression_suite",
  "register_requirement",
  "register_test_dataset",
  "register_ui_surface_baseline",
  "register_workspace_environment",
  "register_workspace_secret",
  "resolve_test_dataset_fields",
  "run_auto_qa",
  "run_depth_smokes",
  "run_expert_qa",
  "run_regression_suite",
  "set_user_preference",
  "validate_expert_claim",
]);

/** Keep production discovery compact by default and never expose demo/stub/eval tools. */
export function selectProductionTools(
  tools: readonly AgentRuntimeToolDefinition[],
  profile: ProductionToolProfile,
): readonly AgentRuntimeToolDefinition[] {
  const selected = tools.filter((tool) =>
    profile === "expert" ? EXPERT_TOOL_NAMES.has(tool.name) : !NON_PRODUCTION_TOOL_NAMES.has(tool.name),
  );
  const expected = profile === "expert" ? EXPERT_TOOL_NAMES.size : undefined;
  if (expected !== undefined && selected.length !== expected) {
    const selectedNames = new Set(selected.map((tool) => tool.name));
    const missing = [...EXPERT_TOOL_NAMES].filter((name) => !selectedNames.has(name));
    throw new Error(`Production tool profile is incomplete: ${missing.join(", ")}`);
  }
  return selected;
}

export function productionToolFilter(profile: ProductionToolProfile): (name: string) => boolean {
  return profile === "expert"
    ? (name) => EXPERT_TOOL_NAMES.has(name)
    : (name) => !NON_PRODUCTION_TOOL_NAMES.has(name) && name !== "run_auto_qa";
}
