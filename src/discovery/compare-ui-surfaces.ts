/**
 * Thin permission/role surface compare: diff two Semantic UI Maps (e.g.
 * admin vs viewer session captures). Does not authenticate — Host supplies
 * both maps from prior discovery.
 */
import type { SemanticUiElement } from "../discovery/public.js";

export type UiSurfaceCompareInput = Readonly<{
  label_a: string;
  label_b: string;
  elements_a: readonly SemanticUiElement[];
  elements_b: readonly SemanticUiElement[];
}>;

export type UiSurfaceCompareResult = Readonly<{
  only_in_a: readonly string[];
  only_in_b: readonly string[];
  shared: readonly string[];
  summary: string;
}>;

export function compareUiSurfaces(input: UiSurfaceCompareInput): UiSurfaceCompareResult {
  const keysA = new Set(input.elements_a.map(elementKey).filter((k) => k.length > 0));
  const keysB = new Set(input.elements_b.map(elementKey).filter((k) => k.length > 0));

  const only_in_a = [...keysA].filter((key) => !keysB.has(key)).sort();
  const only_in_b = [...keysB].filter((key) => !keysA.has(key)).sort();
  const shared = [...keysA].filter((key) => keysB.has(key)).sort();

  return {
    only_in_a,
    only_in_b,
    shared,
    summary: `${input.label_a} vs ${input.label_b}: ${only_in_a.length} only-A, ${only_in_b.length} only-B, ${shared.length} shared named controls.`,
  };
}

function elementKey(element: SemanticUiElement): string {
  const name = element.accessible_name?.trim();
  if (!name) return "";
  const role = element.accessible_role?.trim() || element.kind;
  return `${element.kind}|${role}|${name}`;
}
