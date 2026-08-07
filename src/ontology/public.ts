/**
 * SPEC-408 (Ontology Repository Component): "versioned access to canonical
 * entity types, relationship types, constraints, enumerations, and
 * ontology migrations defined by SPEC-101." The canonical serialization
 * (SPEC-408 §9) is the YAML under `ontology/`, already accepted and
 * already validated by the Python governance tooling — this module is the
 * provider-neutral read contract a TypeScript component uses to resolve
 * that same data, never a second definition of ontology meaning.
 */
export type WorkspaceScope = "global" | "workspace" | "global_or_workspace";

export type OntologyEntity = Readonly<{
  id: string;
  family: string;
  workspace_scope: WorkspaceScope;
}>;

export type OntologyRelationship = Readonly<{
  id: string;
  source: string;
  target: string;
  inverse?: string;
  symmetric?: boolean;
}>;

export type OntologyEnumeration = Readonly<{
  name: string;
  values: readonly string[];
}>;

export type OntologyConstraint = Readonly<{
  id: string;
  rule: string;
}>;

/** One accepted ontology release (SPEC-408 §4: "accepted ontology releases are immutable"). */
export type OntologyRelease = Readonly<{
  version: string;
  entities: readonly OntologyEntity[];
  relationships: readonly OntologyRelationship[];
  enumerations: readonly OntologyEnumeration[];
  constraints: readonly OntologyConstraint[];
  /** sha256 over the release's own canonical content — SPEC-408 §3 "verify integrity and provenance." */
  integrity_digest: string;
}>;

export type OntologyFailureCode =
  | "unknown_version"
  | "unknown_term"
  | "invalid_extension"
  | "incompatible_release"
  | "integrity_failure"
  | "unavailable_source";

export type OntologyFailure = Readonly<{
  code: OntologyFailureCode;
  message: string;
}>;

export type OntologyResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: OntologyFailure }>;

/** SPEC-408 §3: an extension proposes new terms without weakening global constraints (SPEC-408 §6). */
export type OntologyExtension = Readonly<{
  workspace_id: string;
  entities?: readonly OntologyEntity[];
  relationships?: readonly OntologyRelationship[];
}>;

export type OntologyExtensionValidationFailureReason =
  | "duplicate_entity_id"
  | "duplicate_relationship_id"
  | "unknown_relationship_endpoint"
  | "weakens_global_constraint";

export type OntologyExtensionValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reasons: readonly OntologyExtensionValidationFailureReason[] }>;

export type OntologyReleaseComparison = Readonly<{
  added_entities: readonly string[];
  removed_entities: readonly string[];
  added_relationships: readonly string[];
  removed_relationships: readonly string[];
  /** SPEC-408 §4: "deprecated terms remain interpretable historically" — removed ids are reported, never silently dropped. */
  compatible: boolean;
}>;

/**
 * SPEC-408 §3 operations. Implementations SHALL treat every accepted
 * release as immutable (§4) and distinguish every failure code in §5 —
 * never collapse "unknown version" and "unavailable source" into one
 * generic error.
 */
export interface OntologyRepository {
  /** Resolves the current accepted release (SPEC-408 §2 "resolve exact and current accepted ontology versions"). */
  currentRelease(): Promise<OntologyResult<OntologyRelease>>;

  /** Resolves an exact, named release version; `unknown_version` if it was never accepted. */
  release(version: string): Promise<OntologyResult<OntologyRelease>>;

  /** Resolves one canonical entity or relationship definition by id, from a specific release; `unknown_term` if absent. */
  resolveTerm(
    version: string,
    termId: string,
  ): Promise<OntologyResult<OntologyEntity | OntologyRelationship>>;

  /** SPEC-408 §3 "validate an ontology extension" — SHALL NOT weaken global constraints (§6). */
  validateExtension(extension: OntologyExtension): Promise<OntologyExtensionValidationResult>;

  /** SPEC-408 §3 "compare releases." */
  compareReleases(
    fromVersion: string,
    toVersion: string,
  ): Promise<OntologyResult<OntologyReleaseComparison>>;
}
