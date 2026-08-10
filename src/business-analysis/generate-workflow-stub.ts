/**
 * SPEC-204 thin generate path: draft a Workflow stub from a Semantic UI Map.
 * Deterministic / grounded in observed controls — never invents business
 * rules, owners, or target-state gaps. Status is always `current` draft
 * material for `assess_business_analysis_quality`, not accepted BA.
 */
import type { SemanticUiElement } from "../discovery/public.js";
import type { Workflow } from "./public.js";

export type GenerateWorkflowStubInput = Readonly<{
  elements: readonly SemanticUiElement[];
  source_url?: string;
  workspace_id: string;
  requirement_ref?: string;
  id?: string;
}>;

export function generateWorkflowStub(input: GenerateWorkflowStubInput): Workflow {
  const fields = input.elements.filter((el) => el.kind === "field");
  const actions = input.elements.filter((el) => el.kind === "action");
  const namedFields = fields.map((el) => el.accessible_name).filter((n): n is string => !!n?.trim());
  const namedActions = actions.map((el) => el.accessible_name).filter((n): n is string => !!n?.trim());

  const trigger =
    namedActions[0] !== undefined
      ? `User activates "${namedActions[0]}" on the observed surface.`
      : "User opens the observed surface.";

  const activities = [
    {
      step: "observe-surface",
      description: input.source_url
        ? `Land on ${input.source_url} and observe interactive controls.`
        : "Land on the observed surface and inventory interactive controls.",
    },
    ...namedFields.slice(0, 8).map((name, index) => ({
      step: `provide-${index + 1}`,
      description: `Provide a value for field "${name}".`,
    })),
    ...namedActions.slice(0, 5).map((name, index) => ({
      step: `act-${index + 1}`,
      description: `Invoke action "${name}".`,
    })),
  ];

  const id = input.id?.trim() || `workflow-stub:${hashSeed(input)}`;

  return {
    id,
    version: "0.1.0-draft",
    name: input.source_url ? `Observed flow @ ${input.source_url}` : "Observed UI workflow stub",
    state: "current",
    trigger,
    preconditions: [
      "Caller-supplied Semantic UI Map accurately reflects the live surface at generation time.",
      ...(input.requirement_ref ? [`Traces to requirement ${input.requirement_ref} (caller-declared).`] : []),
    ],
    actors: [
      {
        actor: "end_user",
        permissions: ["interact:observed-controls"],
      },
    ],
    activities,
    decisions: namedActions.length > 1
      ? [
          {
            description: `Which primary action among ${namedActions.slice(0, 3).join(", ")} the user chooses.`,
            open_question: "Business rules selecting among these actions are not observed in the UI map.",
          },
        ]
      : [],
    data_consumed: namedFields.length > 0 ? namedFields.slice(0, 12) : ["(no named fields observed)"],
    data_produced: ["UI feedback / navigation outcome (not observed as structured data)"],
    transitions: [
      {
        from_state: "surface_ready",
        to_state: "interaction_complete",
        trigger: namedActions[0] ?? "user_leaves_or_submits",
      },
    ],
    alternate_paths: ["User abandons without completing required fields."],
    failure_paths: ["Validation or auth error feedback (content not asserted by this stub)."],
    outcome: "User completes or abandons interaction on the observed surface.",
    evidence: [
      ...(input.source_url ? [`source-url:${input.source_url}`] : []),
      `workspace:${input.workspace_id}`,
      `field-count:${fields.length}`,
      `action-count:${actions.length}`,
      "generation:semantic-ui-map-stub@0.1.0",
    ],
    traces_to: input.requirement_ref ? [input.requirement_ref] : [],
  };
}

function hashSeed(input: GenerateWorkflowStubInput): string {
  const names = input.elements
    .map((el) => el.accessible_name ?? el.id)
    .filter(Boolean)
    .slice(0, 6)
    .join("|");
  const raw = `${input.workspace_id}|${input.source_url ?? ""}|${names}`;
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}
