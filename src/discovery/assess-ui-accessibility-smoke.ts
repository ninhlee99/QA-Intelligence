/**
 * Deterministic accessibility smoke over a Semantic UI Map (not a full WCAG
 * audit — no axe dependency, no contrast/focus-order measurement). Catches
 * the high-signal naming gaps a Senior QA flags on first pass: missing
 * accessible names on interactive controls, duplicate names that confuse
 * AT/users, and unlabeled editable fields. Findings are advisory; never
 * invents a product pass/fail verdict beyond the naming checks themselves.
 */
import type { SemanticUiElement } from "./public.js";

export type AccessibilitySmokeSeverity = "critical" | "high" | "medium" | "low";

export type AccessibilitySmokeFinding = Readonly<{
  id: string;
  category:
    | "missing_accessible_name"
    | "duplicate_accessible_name"
    | "unlabeled_editable_field"
    | "empty_surface";
  severity: AccessibilitySmokeSeverity;
  message: string;
  evidence: readonly string[];
  element_ids: readonly string[];
}>;

export type AccessibilitySmokeReport = Readonly<{
  schema_version: "1.0.0";
  source_url?: string;
  element_count: number;
  findings: readonly AccessibilitySmokeFinding[];
  summary: Readonly<{
    critical: number;
    high: number;
    medium: number;
    low: number;
  }>;
  /** Explicit scope limit — this is smoke, not WCAG conformance. */
  limitations: readonly string[];
}>;

export type AccessibilitySmokeInput = Readonly<{
  elements: readonly SemanticUiElement[];
  source_url?: string;
}>;

const INTERACTIVE_KINDS = new Set(["field", "action"]);

export function assessUiAccessibilitySmoke(input: AccessibilitySmokeInput): AccessibilitySmokeReport {
  const findings: AccessibilitySmokeFinding[] = [];
  const interactive = input.elements.filter((el) => INTERACTIVE_KINDS.has(el.kind));

  if (input.elements.length === 0) {
    findings.push({
      id: "a11y-empty-surface",
      category: "empty_surface",
      severity: "high",
      message: "Discovery returned zero semantic elements — accessibility smoke cannot run; surface may be blank, blocked, or capture-limited.",
      evidence: input.source_url !== undefined ? [`source-url:${input.source_url}`] : [],
      element_ids: [],
    });
  }

  for (const element of interactive) {
    const name = element.accessible_name?.trim();
    if (name === undefined || name.length === 0) {
      const category =
        element.kind === "field" && element.interaction_hint === "editable"
          ? "unlabeled_editable_field"
          : "missing_accessible_name";
      findings.push({
        id: `a11y-missing:${element.id}`,
        category,
        severity: category === "unlabeled_editable_field" ? "critical" : "high",
        message:
          category === "unlabeled_editable_field"
            ? `Editable field "${element.id}" (role=${element.accessible_role ?? "unknown"}) has no accessible name — screen-reader users cannot identify it.`
            : `Interactive ${element.kind} "${element.id}" (role=${element.accessible_role ?? "unknown"}) has no accessible name.`,
        evidence: [`element:${element.id}`, `kind:${element.kind}`, `role:${element.accessible_role ?? "unknown"}`],
        element_ids: [element.id],
      });
    }
  }

  const byName = new Map<string, SemanticUiElement[]>();
  for (const element of interactive) {
    const name = element.accessible_name?.trim().toLowerCase();
    if (name === undefined || name.length === 0) continue;
    const bucket = byName.get(name) ?? [];
    bucket.push(element);
    byName.set(name, bucket);
  }
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    findings.push({
      id: `a11y-dup:${name}`,
      category: "duplicate_accessible_name",
      severity: "medium",
      message: `Accessible name "${group[0]!.accessible_name}" is shared by ${group.length} interactive elements — ambiguous for assistive tech and for semantic test targeting.`,
      evidence: group.map((el) => `element:${el.id}`),
      element_ids: group.map((el) => el.id),
    });
  }

  return {
    schema_version: "1.0.0",
    ...(input.source_url !== undefined ? { source_url: input.source_url } : {}),
    element_count: input.elements.length,
    findings,
    summary: summarize(findings),
    limitations: [
      "Smoke only: missing/duplicate accessible names on field/action elements.",
      "Does not measure color contrast, keyboard focus order, ARIA live regions, or WCAG success criteria beyond naming.",
      "Does not substitute for a full accessibility audit (axe/manual AT).",
    ],
  };
}

function summarize(findings: readonly AccessibilitySmokeFinding[]): AccessibilitySmokeReport["summary"] {
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const finding of findings) {
    if (finding.severity === "critical") critical++;
    else if (finding.severity === "high") high++;
    else if (finding.severity === "medium") medium++;
    else low++;
  }
  return { critical, high, medium, low };
}
