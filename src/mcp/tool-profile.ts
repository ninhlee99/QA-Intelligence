import type { AgentRuntimeToolDefinition } from "./agent-runtime-tool-registry.js";

export const PRODUCTION_TOOL_PROFILES = ["expert", "full"] as const;
export type ProductionToolProfile = (typeof PRODUCTION_TOOL_PROFILES)[number];

const EXPERT_TOOL_NAMES = new Set([
  "run_expert_qa",
  "validate_expert_claim",
  "execute_generated_test_case",
  "register_regression_suite",
  "list_regression_suites",
  "run_regression_suite",
  "register_workspace_secret",
  "list_workspace_secrets",
  "register_workspace_environment",
  "list_workspace_environments",
  "manage_evidence_lifecycle",
  "draft_defects_from_qa_run",
  "export_defects_for_tracker",
  "list_failure_avoidance_hints",
]);

const NON_PRODUCTION_TOOL_NAMES = new Set([
  "execute_browser_test",
  "generate_business_analysis_stub",
  "generate_risk_stub",
  "generate_test_strategy_stub",
  "evaluate_test_case_quality_skill",
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
