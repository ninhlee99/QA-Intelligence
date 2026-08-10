/**
 * SPEC-206 thin generate path: draft a Test Strategy from a Semantic UI Map
 * (+ optional objective). Complements exploratory charter — this is the
 * document contract `assess_test_strategy_quality` reviews, not a time-box
 * charter.
 */
import type { SemanticUiElement } from "../discovery/public.js";
import type { TestStrategy } from "./public.js";

export type GenerateTestStrategyStubInput = Readonly<{
  elements: readonly SemanticUiElement[];
  source_url?: string;
  workspace_id: string;
  objective?: string;
  requirement_ref?: string;
  owner?: string;
  environment_name?: string;
}>;

export function generateTestStrategyStub(input: GenerateTestStrategyStubInput): TestStrategy {
  const fields = input.elements.filter((el) => el.kind === "field");
  const editable = fields.filter((el) => el.interaction_hint === "editable");
  const actions = input.elements.filter((el) => el.kind === "action");
  const owner = input.owner?.trim() || "QA Intelligence stub generator";
  const scope = input.source_url
    ? `Observed UI surface at ${input.source_url} (Semantic UI Map stub).`
    : "Caller-supplied Semantic UI Map surface (URL not provided).";

  const objectives = [
    input.objective?.trim() || "Establish a minimal, risk-aware test approach for the observed surface.",
    "Prefer semantic accessible-name interactions over implementation selectors.",
    "Separate infrastructure faults from product failures in reporting.",
  ];

  const techniques = [
    "Semantic UI discovery",
    "Generated positive/negative/boundary cases from the map",
    ...(editable.length > 0 ? ["Input validation probing"] : []),
    ...(actions.length > 0 ? ["Primary-action feedback checks"] : []),
    "Accessibility naming smoke",
    "Time-boxed exploratory session",
  ];

  const envName = input.environment_name?.trim() || "registered-or-loopback-target";

  return {
    id: `test-strategy-stub:${input.workspace_id}`,
    version: "0.1.0-draft",
    status: "draft",
    scope,
    objectives,
    ...(input.requirement_ref ? { governing_requirement_refs: [input.requirement_ref] } : {}),
    quality_characteristics: ["functional_correctness", "operability", "accessibility_basics"],
    test_levels: ["system", "end_to_end", "acceptance"],
    techniques,
    coverage_model:
      "Control coverage from the Semantic UI Map (fields/actions observed); not multi-page workflow coverage.",
    environments: [
      {
        name: envName,
        representativeness: "Dev/staging target registered in Workspace environment allowlist (or loopback fixture).",
        controlled_differences: ["Production traffic and real customer data are out of scope for this stub."],
        reset_and_recovery: "Prefer ephemeral fixtures; no destructive cleanup invented by this stub.",
      },
    ],
    test_data_approach:
      "Synthetic / registry-backed datasets only; no production data without classification controls (SPEC-208).",
    automation_approach:
      "Generate TestCases from the map; execute via Playwright semantic steps; draft AutomationAsset stubs for review (SPEC-209).",
    entry_criteria: [
      "Target URL is allowlisted or is a documented dev escape (data:/loopback).",
      "Semantic UI Map captured for the surface under test.",
    ],
    exit_criteria: [
      "Critical generated cases executed with evidenced outcomes.",
      "Open defects drafted for failed acceptance-linked cases.",
      "Residual risks from sparse discovery explicitly listed.",
    ],
    evidence_and_reporting:
      "Use run_auto_qa / execution records; professional analysis must not invent pass rates.",
    exclusions: [
      "Full WCAG axe campaigns",
      "Pen-test / load testing",
      "Multi-page Region/Workflow crawl (SPEC-201 remainder)",
    ],
    assumptions: [
      "UI map is current at strategy-draft time.",
      "Business rules beyond visible controls are unknown.",
    ],
    residual_risk: "Undiscovered pages and server-side rules remain unknown.",
    owner,
  };
}
