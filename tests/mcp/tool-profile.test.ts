import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeToolDefinition } from "../../src/mcp/agent-runtime-tool-registry.js";
import { selectProductionTools } from "../../src/mcp/tool-profile.js";

function tool(name: string): AgentRuntimeToolDefinition {
  return {
    name, description: name, inputSchema: { type: "object" },
    agent: { id: `${name}-agent`, version: "1.0.0" }, purpose: name,
    consequence_class: "advisory", policy_version: "1.0.0", buildInput: () => ({}),
  };
}

const expertNames = [
  "run_expert_qa", "validate_expert_claim", "execute_generated_test_case", "register_regression_suite",
  "list_regression_suites", "run_regression_suite", "register_workspace_secret", "list_workspace_secrets",
  "register_workspace_environment", "list_workspace_environments", "manage_evidence_lifecycle",
  "draft_defects_from_qa_run", "export_defects_for_tracker", "list_failure_avoidance_hints",
];

test("expert production profile exposes only the daily workflow", () => {
  const selected = selectProductionTools([...expertNames.map(tool), tool("execute_browser_test")], "expert");
  assert.deepEqual(selected.map((item) => item.name), expertNames);
});

test("full production profile still excludes demos, stubs and evaluation tools", () => {
  const selected = selectProductionTools(
    [tool("run_expert_qa"), tool("execute_browser_test"), tool("generate_risk_stub"), tool("assess_risk_quality")],
    "full",
  );
  assert.deepEqual(selected.map((item) => item.name), ["run_expert_qa", "assess_risk_quality"]);
});
