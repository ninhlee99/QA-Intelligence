/**
 * SPEC-205 thin generate path: draft Risk stubs grounded in a Semantic UI
 * Map. Never invents likelihood scores or confirmed treatments — only
 * candidate risks a human can assess via `assess_risk_quality`.
 */
import type { SemanticUiElement } from "../discovery/public.js";
import type { Risk } from "./public.js";

export type GenerateRiskStubInput = Readonly<{
  elements: readonly SemanticUiElement[];
  source_url?: string;
  workspace_id: string;
  requirement_ref?: string;
  owner?: string;
}>;

export function generateRiskStubs(input: GenerateRiskStubInput): readonly Risk[] {
  const fields = input.elements.filter((el) => el.kind === "field");
  const editable = fields.filter((el) => el.interaction_hint === "editable");
  const actions = input.elements.filter((el) => el.kind === "action");
  const unlabeled = input.elements.filter((el) => !el.accessible_name?.trim());
  const risks: Risk[] = [];
  const owner = input.owner?.trim() || "QA Intelligence stub generator";
  const evidenceBase = [
    ...(input.source_url ? [`source-url:${input.source_url}`] : []),
    `workspace:${input.workspace_id}`,
    "generation:semantic-ui-map-risk-stub@0.1.0",
  ];

  if (editable.length > 0) {
    risks.push({
      id: `risk-stub:input-validation:${input.workspace_id}`,
      version: "0.1.0-draft",
      status: "draft",
      statement: {
        cause: "Editable fields observed without accompanying validation semantics in the UI map",
        event: "Invalid, empty, or adversarial input reaches the product",
        consequence: "Incorrect state, confusing errors, or security exposure",
      },
      category: "functional_quality",
      affected: {
        workspace_id: input.workspace_id,
        ...(input.requirement_ref ? { requirement_refs: [input.requirement_ref] } : {}),
      },
      likelihood_rationale: "Stub only — likelihood not measured; editable surface exists.",
      impact_rationale: "Stub only — impact depends on downstream handling not visible in the map.",
      evidence: [...evidenceBase, `editable-field-count:${editable.length}`],
      assumptions: ["UI map completeness at generation time.", "No server-side rules inferred."],
      owner,
      controls: ["Boundary/negative cases on editable fields", "API contract checks if endpoints exist"],
      residual_risk: "Unknown until validation behaviour is observed under adversarial input.",
      treatment: "reduce",
    });
  }

  if (actions.length > 0) {
    risks.push({
      id: `risk-stub:action-feedback:${input.workspace_id}`,
      version: "0.1.0-draft",
      status: "draft",
      statement: {
        cause: "Primary actions observed without guaranteed confirmation semantics in the map",
        event: "User triggers a state-changing action",
        consequence: "Silent success/failure or irreversible change without clear feedback",
      },
      category: "operability",
      affected: { workspace_id: input.workspace_id },
      likelihood_rationale: "Stub — action controls are present; feedback quality unknown.",
      impact_rationale: "Stub — depends on whether actions are destructive.",
      evidence: [...evidenceBase, `action-count:${actions.length}`],
      owner,
      controls: ["Exploratory session focused on action feedback", "Assert observable outcome after each primary action"],
      residual_risk: "Unknown without executing actions against a registered environment.",
      treatment: "monitor",
    });
  }

  if (unlabeled.length > 0) {
    risks.push({
      id: `risk-stub:a11y-naming:${input.workspace_id}`,
      version: "0.1.0-draft",
      status: "draft",
      statement: {
        cause: "Controls without accessible names in the Semantic UI Map",
        event: "Assistive tech or automation cannot reliably address the control",
        consequence: "Accessibility failure and brittle automation",
      },
      category: "compliance",
      affected: { workspace_id: input.workspace_id },
      likelihood_rationale: "Stub — unlabeled controls were observed.",
      impact_rationale: "Stub — severity depends on control criticality.",
      evidence: [...evidenceBase, `unlabeled-count:${unlabeled.length}`],
      owner,
      controls: ["assess_ui_accessibility_smoke", "Remediate labels before automation"],
      residual_risk: "Remains until accessible names are added.",
      treatment: "reduce",
    });
  }

  if (risks.length === 0) {
    risks.push({
      id: `risk-stub:sparse-surface:${input.workspace_id}`,
      version: "0.1.0-draft",
      status: "draft",
      statement: {
        cause: "Observed surface has few interactive elements",
        event: "Testers over-trust a thin map",
        consequence: "Missed workflows behind navigation not yet discovered",
      },
      category: "product_and_business",
      affected: { workspace_id: input.workspace_id },
      likelihood_rationale: "Stub — sparse map increases unknown-unknown risk.",
      impact_rationale: "Stub — depends on product criticality.",
      evidence: evidenceBase,
      owner,
      controls: ["Multi-page discovery (out of this stub)", "Exploratory charter with navigation focus"],
      residual_risk: "High uncertainty until more surfaces are mapped.",
      treatment: "monitor",
    });
  }

  return risks;
}
