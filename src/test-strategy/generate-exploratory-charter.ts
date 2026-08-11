/**
 * SPEC-206 exploratory testing support: turn a Semantic UI Map into a
 * time-boxed exploratory charter a human (or host agent) can run. Pure /
 * deterministic — suggests areas and oracles from what Discovery actually
 * observed; never invents business rules or expected results not grounded
 * in the map or the caller-supplied objective.
 */
import type { SemanticUiElement } from "../discovery/public.js";

export type ExploratoryCharter = Readonly<{
  schema_version: "1.0.0";
  title: string;
  objective: string;
  source_url?: string;
  /** Suggested time box in minutes — proportional to interactive surface size. */
  time_box_minutes: number;
  focus_areas: readonly string[];
  oracles: readonly string[];
  risks_to_probe: readonly string[];
  out_of_scope: readonly string[];
  notes_for_tester: readonly string[];
}>;

export type GenerateExploratoryCharterInput = Readonly<{
  elements: readonly SemanticUiElement[];
  source_url?: string;
  /** Caller objective — never invented when absent. */
  objective?: string;
  requirement_ref?: string;
}>;

export function generateExploratoryCharter(input: GenerateExploratoryCharterInput): ExploratoryCharter {
  const fields = input.elements.filter((el) => el.kind === "field");
  const actions = input.elements.filter((el) => el.kind === "action");
  const editable = fields.filter((el) => el.interaction_hint === "editable");
  const namedFields = fields.map((el) => el.accessible_name).filter((n): n is string => !!n?.trim());
  const namedActions = actions.map((el) => el.accessible_name).filter((n): n is string => !!n?.trim());

  const interactiveCount = editable.length + actions.length;
  const time_box_minutes = interactiveCount <= 3 ? 15 : interactiveCount <= 8 ? 30 : 45;

  const objective =
    input.objective?.trim() ||
    (input.source_url !== undefined
      ? `Explore the live surface at ${input.source_url} for functional surprises, validation gaps, and unclear feedback.`
      : "Explore the discovered surface for functional surprises, validation gaps, and unclear feedback.");

  const focus_areas: string[] = [];
  if (editable.length > 0) {
    focus_areas.push(
      `Editable fields (${editable.length}): try empty, whitespace, oversized, unicode, and format-invalid values on ${namedFields.slice(0, 5).join(", ") || "unnamed fields"}.`,
    );
  }
  if (namedActions.length > 0) {
    focus_areas.push(`Primary actions: exercise ${namedActions.slice(0, 5).join(", ")} including rapid double-submit and cancel/back paths if present.`);
  }
  if (fields.some((el) => !el.accessible_name?.trim())) {
    focus_areas.push("Unlabeled controls: note any field/action without an accessible name — potential a11y and automation risk.");
  }
  if (focus_areas.length === 0) {
    focus_areas.push("Surface has few interactive elements — probe navigation, empty states, and error messaging around the page chrome.");
  }

  const oracles = [
    "No stack traces, raw exception text, or 'internal server error' leaked to the UI.",
    "Every submit/action produces observable feedback (success, validation, or error) within a few seconds.",
    "Destructive or state-changing actions are reversible or clearly confirmed when the UI implies permanence.",
    "Accessible names (if present) remain stable and match visible labels.",
  ];

  const risks_to_probe = [
    ...(editable.length > 0
      ? ["Input validation bypass or inconsistent error copy across fields.", "Encoding/XSS reflection on echoed input."]
      : []),
    ...(namedActions.length > 0 ? ["Actions that succeed silently with no confirmation."] : []),
    "Session/auth edge: reload, back-button, and expired-session behaviour if credentials were used to reach this surface.",
  ];

  return {
    schema_version: "1.0.0",
    title:
      input.source_url !== undefined
        ? `Exploratory charter — ${input.source_url}`
        : "Exploratory charter — discovered surface",
    objective,
    ...(input.source_url !== undefined ? { source_url: input.source_url } : {}),
    time_box_minutes,
    focus_areas,
    oracles,
    risks_to_probe,
    out_of_scope: [
      "Full WCAG / axe audit (use assess_ui_accessibility_smoke for naming smoke only).",
      "API contract, performance, or load testing.",
      "Multi-page crawl beyond the discovered URL unless the tester expands scope explicitly.",
      ...(input.requirement_ref !== undefined
        ? [`Acceptance criteria owned by ${input.requirement_ref} — cover those via generate_test_cases / run_auto_qa, not free exploration alone.`]
        : []),
    ],
    notes_for_tester: [
      "Record notes with timestamp + oracle hit/miss; file defects with evidence (screenshot/DOM), not memory.",
      "Stop at the time box; residual risk from unexplored areas stays explicit.",
      `Discovery saw ${fields.length} field(s) and ${actions.length} action(s) on this capture.`,
    ],
  };
}
