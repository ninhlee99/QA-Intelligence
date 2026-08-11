/**
 * Shared accessible_name comparison for semantic locator matching
 * (Discovery field/action lookup, Execution target resolution) — ADR-022 §4
 * / ADR-003's semantic-locator-only interaction. Normalizes only trim +
 * case-fold; does not collapse internal whitespace — no evidence any
 * fixture needs it, and doing so risks conflating genuinely distinct
 * accessible names.
 */
export function accessibleNamesMatch(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();
  if (normalizedA.length === 0 || normalizedB.length === 0) return false;
  return normalizedA === normalizedB;
}
