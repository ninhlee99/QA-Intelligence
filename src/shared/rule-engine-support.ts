import type { JsonObject, JsonValue, VersionReference } from "../requirement-review/public.js";

/**
 * Common fact-reading and version-validation helpers shared by every
 * `DeterministicRuleEngine` in this repository (requirement-review,
 * requirement-intelligence, risk-analysis, test-design, test-strategy,
 * test-data, automation, execution, bug-analysis, reporting). Each rule
 * engine's own facts and findings are still domain-specific (a Risk's
 * `treatment_governance` finding is not a TestCase's `authority` finding);
 * only the mechanical read/parse/validate primitives below are identical
 * across all of them and belong in one place — SPEC-502 (Rule Engine
 * Interface) is the accepted spec this module narrows toward without yet
 * implementing its full scope.
 */

export function readObject(object: JsonObject, key: string): JsonObject | undefined {
  const value = object[key];
  return isJsonObject(value) ? value : undefined;
}

export function readString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readStrings(object: JsonObject, key: string): string[] {
  const value = object[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

export function readEnum<const Value extends string>(
  object: JsonObject,
  key: string,
  values: readonly Value[],
): Value | undefined {
  const value = object[key];
  return typeof value === "string" && values.some((candidate) => candidate === value)
    ? (value as Value)
    : undefined;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const SEMANTIC_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

/** `id@x.y.z` → `{ id, version }`. Uses `lastIndexOf` rather than `split` so an id containing `@` (not expected in practice, but not forbidden either) doesn't silently misparse. */
export function parseVersionReference(value: string): VersionReference {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) {
    return { id: value, version: "unresolved" };
  }
  return { id: value.slice(0, separator), version: value.slice(separator + 1) };
}

export function isExactVersionReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}

export function isSemanticVersion(value: string): boolean {
  return SEMANTIC_VERSION_PATTERN.test(value);
}

/**
 * The `resolved_versions` shape every Skill's configuration carries is
 * structurally the same core 7 fields (`agent`/`skill`/`rule_set`/
 * `knowledge_snapshot`/`policy`/`input_schema`/`output_schema`); `prompt`
 * is optional in most Skills' types and checked separately by callers that
 * require it (only `AssessRequirementQuality` does, since it may invoke a
 * Reasoning Provider).
 */
export type CoreResolvedVersions = Readonly<{
  agent: string;
  skill: string;
  rule_set: string;
  knowledge_snapshot: string;
  policy: string;
  input_schema: string;
  output_schema: string;
}>;

export function hasExactResolvedVersions(versions: CoreResolvedVersions): boolean {
  return (
    isExactVersionReference(versions.agent) &&
    isExactVersionReference(versions.skill) &&
    isExactVersionReference(versions.rule_set) &&
    isSemanticVersion(versions.knowledge_snapshot) &&
    isExactVersionReference(versions.policy) &&
    isExactVersionReference(versions.input_schema) &&
    isExactVersionReference(versions.output_schema)
  );
}
