import type {
  FeatureCandidate,
  FeatureChange,
  FeatureExtractionRequest,
  FeatureExtractionResult,
  FeatureExtractionValue,
  FeatureExtractor,
  FeatureExtractorFailureCode,
  SemanticUiEntityType,
} from "../../feature-extractor/public.js";
import type { SemanticObservation } from "../../semantic-analyzer/public.js";

const CONCEPT_TO_ENTITY: Readonly<Record<string, SemanticUiEntityType>> = {
  Action: "Action",
  Field: "Field",
};

/**
 * Deterministic reference `FeatureExtractor` (SPEC-303 §2 "apply
 * deterministic patterns and governed rules"; no AI resolution stage,
 * matching the same deterministic-only pattern
 * `DeterministicSemanticAnalyzer` and `ScriptedReasoningProvider([])`
 * already use elsewhere). Maps each `Action`/`Field` `SemanticObservation`
 * (SPEC-301) one-to-one into a `FeatureCandidate` — identity is the
 * observation's own `normalized_value`, per SPEC-303 §5 "semantic anchors
 * and historical correspondence, not fragile DOM position." When a prior
 * feature map is supplied, this run classifies each candidate against it
 * (SPEC-303 §6): unchanged, semantically changed (name changed for the
 * same identity), or new.
 */
export class DeterministicFeatureExtractor implements FeatureExtractor {
  static readonly VERSION = "1.0.0";

  async extract(request: FeatureExtractionRequest): Promise<FeatureExtractionResult> {
    if (request.ontology_version.trim().length === 0) {
      return failure("incompatible_ontology", "An ontology_version is required to classify candidates.");
    }
    if (request.observations.length === 0) {
      return failure("incomplete_extraction", "No observations were supplied to extract features from.");
    }

    const identitySeen = new Map<string, SemanticObservation>();
    const candidates: FeatureCandidate[] = [];
    let sequence = 0;

    for (const observation of request.observations) {
      const entityType = CONCEPT_TO_ENTITY[observation.concept_type];
      if (entityType === undefined) continue;

      const identity = observation.normalized_value;
      const existing = identitySeen.get(identity);
      if (existing !== undefined && existing.observation_id !== observation.observation_id) {
        return failure(
          "identity_collision",
          `Two distinct observations ("${existing.observation_id}", "${observation.observation_id}") both resolved to identity "${identity}".`,
        );
      }
      identitySeen.set(identity, observation);

      sequence += 1;
      candidates.push({
        candidate_id: `candidate-${sequence}`,
        entity_type: entityType,
        proposed_identity: identity,
        name: observation.normalized_value,
        purpose: observation.diagnostics.length > 0 ? "unresolved-purpose" : "",
        action_candidate_ids: [],
        state_candidate_ids: [],
        permissions: [],
        evidence_observation_ids: [observation.observation_id],
        confidence: observation.confidence,
        conflict_ids: [],
        applicability: observation.applicability,
      });
    }

    const changes = classifyChanges(candidates, request.prior_feature_map ?? []);

    const value: FeatureExtractionValue = {
      candidates,
      changes,
      extractor_version: DeterministicFeatureExtractor.VERSION,
    };
    return { ok: true, value };
  }
}

function classifyChanges(candidates: readonly FeatureCandidate[], priorMap: readonly FeatureCandidate[]): FeatureChange[] {
  const priorByIdentity = new Map(priorMap.map((candidate) => [candidate.proposed_identity, candidate]));
  const changes: FeatureChange[] = [];

  for (const candidate of candidates) {
    const prior = priorByIdentity.get(candidate.proposed_identity);
    if (prior === undefined) {
      changes.push({ change_class: "workflow", candidate_id: candidate.candidate_id, description: `New ${candidate.entity_type} candidate "${candidate.proposed_identity}".` });
      continue;
    }
    if (prior.entity_type !== candidate.entity_type) {
      changes.push({
        change_class: "semantic",
        candidate_id: candidate.candidate_id,
        prior_candidate_id: prior.candidate_id,
        description: `Entity type changed from "${prior.entity_type}" to "${candidate.entity_type}" for identity "${candidate.proposed_identity}".`,
      });
      continue;
    }
    if (prior.name !== candidate.name) {
      // The candidate's `name` is its resolved accessible name (SPEC-301's
      // normalized_value), not decorative styling — a change here is a
      // semantic change (the element now means something different to an
      // assistive technology or a test asserting on it), never merely
      // presentation_only, which SPEC-303 §6 reserves for styling-only
      // change this deterministic extractor has no signal for at all.
      changes.push({
        change_class: "semantic",
        candidate_id: candidate.candidate_id,
        prior_candidate_id: prior.candidate_id,
        description: `Accessible name changed from "${prior.name}" to "${candidate.name}" for identity "${candidate.proposed_identity}".`,
      });
    }
  }

  return changes;
}

function failure(code: FeatureExtractorFailureCode, message: string): FeatureExtractionResult {
  return { ok: false, failure: { code, message } };
}
