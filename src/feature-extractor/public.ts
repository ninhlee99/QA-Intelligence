import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";
import type { SemanticObservation } from "../semantic-analyzer/public.js";

/**
 * SPEC-303 (Feature Extractor Architecture): "identifies semantic UI
 * features, actions, states, validations, navigation, permissions, and
 * workflow evidence from cleaned observations." Consumes
 * `SemanticAnalyzer` output (SPEC-301) directly — SPEC-303 depends_on both
 * SPEC-301 and SPEC-302, and this is the point where their outputs
 * actually compose into candidate Semantic UI entities (Page/Region/
 * Feature/Field/Action/State per the ontology's `semantic_ui` family).
 * It never approves Knowledge Objects or creates raw selectors as product
 * meaning (§2) — candidates remain candidates until a separate, governed
 * promotion decision accepts them.
 */
export type SemanticUiEntityType = "Page" | "Region" | "Feature" | "Field" | "Action" | "State";

/** SPEC-303 §3: "semantic type, proposed identity, name, purpose, containment, actions, states, permissions, evidence nodes, confidence, conflicts, and applicability." */
export type FeatureCandidate = Readonly<{
  candidate_id: string;
  entity_type: SemanticUiEntityType;
  proposed_identity: string;
  name: string;
  purpose: string;
  contained_in?: string;
  action_candidate_ids: readonly string[];
  state_candidate_ids: readonly string[];
  permissions: readonly string[];
  evidence_observation_ids: readonly string[];
  confidence: number;
  conflict_ids: readonly string[];
  applicability: JsonObject;
}>;

/** SPEC-303 §6: presentation-only, binding, semantic, permission, workflow, or unresolvable change relative to a prior feature map. */
export type FeatureChangeClass =
  | "presentation_only"
  | "binding"
  | "semantic"
  | "permission"
  | "workflow"
  | "unresolvable";

export type FeatureChange = Readonly<{
  change_class: FeatureChangeClass;
  candidate_id: string;
  prior_candidate_id?: string;
  description: string;
}>;

/** A prior extraction's candidates, supplied so this run can detect changes relative to them (SPEC-303 §4 "Compare Existing Feature Graph"). Omit for a first-ever extraction against empty history. */
export type PriorFeatureMap = readonly FeatureCandidate[];

export type FeatureExtractionRequest = Readonly<{
  extraction_id: string;
  context: WorkspaceContext;
  ontology_version: string;
  observations: readonly SemanticObservation[];
  prior_feature_map?: PriorFeatureMap;
}>;

export type FeatureExtractorFailureCode =
  | "invalid_cleaned_input"
  | "incompatible_ontology"
  | "missing_accessibility_semantics"
  | "identity_collision"
  | "contradictory_evidence"
  | "provider_failure"
  | "incomplete_extraction";

export type FeatureExtractorFailure = Readonly<{
  code: FeatureExtractorFailureCode;
  message: string;
}>;

export type FeatureExtractionValue = Readonly<{
  candidates: readonly FeatureCandidate[];
  changes: readonly FeatureChange[];
  extractor_version: string;
}>;

export type FeatureExtractionResult =
  | Readonly<{ ok: true; value: FeatureExtractionValue }>
  | Readonly<{ ok: false; failure: FeatureExtractorFailure }>;

/**
 * Provider-neutral Feature Extractor seam (SPEC-303 §4 pipeline). A
 * deterministic adapter applies only rule-based classification (SPEC-303
 * §2 "apply deterministic patterns and governed rules"); a production
 * adapter MAY add bounded AI resolution for ambiguous cases, but never as
 * the sole basis for an identity decision (§5 "Identity uncertainty SHALL
 * produce candidates rather than destructive merges").
 */
export interface FeatureExtractor {
  extract(request: FeatureExtractionRequest): Promise<FeatureExtractionResult>;
}
