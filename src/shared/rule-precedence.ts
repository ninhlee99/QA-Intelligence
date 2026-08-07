/**
 * SPEC-104 §9 (Precedence and Conflicts): "Precedence SHALL be explicit by:
 * authority class, specificity, Workspace applicability, version and
 * effective period, declared priority. Conflicting rules with equal
 * precedence SHALL produce `indeterminate` and a conflict record unless a
 * governed resolution rule exists."
 *
 * Nothing in the 11 existing `DeterministicRuleEngine` implementations
 * exercises this — each is a single-rule-set, field-completeness checker
 * with no actual competing-rule scenario. This module is the one,
 * domain-independent place a rule engine maps its own candidate rules into
 * to get §9's ordering, rather than every domain reimplementing precedence
 * ranking on its own (mirrors `rule-engine-support.ts`'s "mechanical
 * primitives shared across domains" role for SPEC-502).
 */

export type RuleAuthorityClass = "governance" | "product" | "workspace_extension";

/** `"global"` applies to every Workspace; anything else is that Workspace's own ID (SPEC-104 §12). */
export type RuleWorkspaceScope = "global" | string;

export type RuleCandidate<Outcome> = Readonly<{
  id: string;
  version: string;
  authority_class: RuleAuthorityClass;
  /** Higher specificity outranks lower at equal authority class — an integer, larger wins. */
  specificity: number;
  workspace_scope: RuleWorkspaceScope;
  effective_from: string;
  /** `null` means no expiry. */
  effective_until: string | null;
  priority: number;
  outcome: Outcome;
}>;

export type PrecedenceResolution<Outcome> =
  | Readonly<{ outcome: "resolved"; winner: RuleCandidate<Outcome> }>
  | Readonly<{ outcome: "no_applicable_rule" }>
  | Readonly<{ outcome: "conflict"; tied: readonly RuleCandidate<Outcome>[] }>;

const AUTHORITY_RANK: Readonly<Record<RuleAuthorityClass, number>> = {
  governance: 2,
  product: 1,
  workspace_extension: 0,
};

/**
 * SPEC-104 §9's ordering, applied left to right until one candidate strictly
 * outranks the rest; a tie surviving every tier is a conflict, not a silent
 * pick (§9's "unless a governed resolution rule exists" — no such rule
 * exists in this reference resolver, so every unresolved tie is reported).
 */
export function resolveRulePrecedence<Outcome>(
  candidates: readonly RuleCandidate<Outcome>[],
  effectiveAt: string,
  workspaceId: string,
): PrecedenceResolution<Outcome> {
  const applicable = candidates.filter(
    (candidate) => isEffective(candidate, effectiveAt) && isApplicableToWorkspace(candidate, workspaceId),
  );
  if (applicable.length === 0) return { outcome: "no_applicable_rule" };
  if (applicable.length === 1) return { outcome: "resolved", winner: applicable[0] as RuleCandidate<Outcome> };

  let remaining = applicable;
  for (const rank of PRECEDENCE_TIERS) {
    const best = Math.max(...remaining.map(rank));
    const next = remaining.filter((candidate) => rank(candidate) === best);
    if (next.length === 1) return { outcome: "resolved", winner: next[0] as RuleCandidate<Outcome> };
    remaining = next;
  }
  return { outcome: "conflict", tied: remaining };
}

function isEffective(candidate: RuleCandidate<unknown>, effectiveAt: string): boolean {
  if (candidate.effective_from > effectiveAt) return false;
  if (candidate.effective_until !== null && candidate.effective_until <= effectiveAt) return false;
  return true;
}

function isApplicableToWorkspace(candidate: RuleCandidate<unknown>, workspaceId: string): boolean {
  return candidate.workspace_scope === "global" || candidate.workspace_scope === workspaceId;
}

/** Each tier returns a number to maximize; a strict single maximum wins that tier, otherwise fall through to the next. */
const PRECEDENCE_TIERS: readonly ((candidate: RuleCandidate<unknown>) => number)[] = [
  (candidate) => AUTHORITY_RANK[candidate.authority_class],
  (candidate) => candidate.specificity,
  // Workspace-specific outranks global at equal authority/specificity (SPEC-104 §12: extensions refine within permitted points, never weaken).
  (candidate) => (candidate.workspace_scope === "global" ? 0 : 1),
  (candidate) => versionRank(candidate.version),
  (candidate) => candidate.priority,
];

/** Compares `x.y.z[-pre]` versions into a single comparable number; malformed versions rank lowest. */
function versionRank(version: string): number {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(version);
  if (match === null) return -1;
  const [, major, minor, patch] = match;
  return Number(major) * 1_000_000 + Number(minor) * 1_000 + Number(patch);
}
