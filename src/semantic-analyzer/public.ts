import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-301 (Semantic Analyzer Architecture): "converts governed source
 * material into typed semantic observations, mappings, conflicts, and
 * candidates aligned with SPEC-101." One accepted source type is a
 * `DomCleaner` output (SPEC-302), but the interface itself is
 * source-neutral — SPEC-301 §5 says the module "depends on source
 * adapters," not specifically DOM. This module never approves
 * requirements, promotes knowledge, or persists provider-specific output
 * as canonical meaning (§2) — it interprets evidence without turning
 * interpretation into authority (§10).
 */
export type SourceKind = "cleaned_dom" | "text_document" | "structured_data";

/** SPEC-301 §3: "Inputs are source references, Workspace context, ontology version, applicable rules, and analysis purpose." */
export type SemanticAnalysisRequest = Readonly<{
  analysis_id: string;
  context: WorkspaceContext;
  source_kind: SourceKind;
  source_ref: string;
  /** The already-cleaned/normalized payload this analysis reasons over (e.g. a DomCleaner CleanedDomNode serialized as JsonObject). */
  source_content: JsonObject;
  ontology_version: string;
  applicable_rule_ids: readonly string[];
  purpose: string;
}>;

/** SPEC-301 §3: fact, derived observation, or hypothesis are kept structurally distinct (§2 "distinguish facts, derived observations, and hypotheses"). */
export type SemanticObservationKind = "fact" | "derived_observation" | "hypothesis";

export type SourceSpan = Readonly<{
  source_ref: string;
  path: readonly string[];
}>;

/** SPEC-301 §3: "Outputs are semantic observations containing type, normalized value, source spans, relationships, confidence, authority, applicability, and diagnostics." */
export type SemanticObservation = Readonly<{
  observation_id: string;
  kind: SemanticObservationKind;
  /** Canonical ontology concept this observation resolves to (SPEC-101), e.g. "Feature", "Action". */
  concept_type: string;
  normalized_value: string;
  source_spans: readonly SourceSpan[];
  relationships: readonly Readonly<{ relationship: string; target_observation_id: string }>[];
  /** Only meaningful for `hypothesis`; a `fact`/`derived_observation` from deterministic rules carries confidence 1. */
  confidence: number;
  authority: "deterministic_rule" | "governed_source" | "bounded_inference";
  applicability: JsonObject;
  diagnostics: readonly string[];
}>;

export type SemanticConflict = Readonly<{
  conflict_id: string;
  observation_ids: readonly string[];
  description: string;
}>;

/** A proposal for new/updated knowledge this analysis surfaced but did not itself accept (SPEC-102 §8's Knowledge Candidate boundary — this module produces candidates, never accepted Knowledge Objects). */
export type SemanticCandidate = Readonly<{
  candidate_id: string;
  proposed_concept_type: string;
  proposed_value: string;
  rationale: string;
  source_spans: readonly SourceSpan[];
}>;

export type SemanticAnalyzerFailureCode =
  | "unsupported_format"
  | "missing_ontology"
  | "ambiguous_workspace"
  | "invalid_rule_set"
  | "provider_failure"
  | "unresolvable_meaning";

export type SemanticAnalyzerFailure = Readonly<{
  code: SemanticAnalyzerFailureCode;
  message: string;
}>;

export type SemanticAnalysisValue = Readonly<{
  observations: readonly SemanticObservation[];
  conflicts: readonly SemanticConflict[];
  candidates: readonly SemanticCandidate[];
  /** SPEC-301 §6: "Partial results SHALL expose coverage and uncertainty." */
  coverage: Readonly<{ deterministic_observations: number; inferred_observations: number; unresolved_spans: number }>;
  analyzer_version: string;
}>;

export type SemanticAnalysisResult =
  | Readonly<{ ok: true; value: SemanticAnalysisValue }>
  | Readonly<{ ok: false; failure: SemanticAnalyzerFailure }>;

/**
 * Provider-neutral Semantic Analyzer seam (SPEC-301 §4 pipeline, §9
 * "provider-neutral... replaceable by deterministic fixtures or replay
 * adapters"). A production adapter may call a bounded AI provider for the
 * "Perform Bounded AI Analysis" stage; a deterministic adapter applies
 * only rule-based extraction and never fabricates an inferred observation.
 */
export interface SemanticAnalyzer {
  analyze(request: SemanticAnalysisRequest): Promise<SemanticAnalysisResult>;
}
