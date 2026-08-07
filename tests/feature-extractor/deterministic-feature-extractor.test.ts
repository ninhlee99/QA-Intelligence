import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicDomCleaner } from "../../src/adapters/dom-cleaner/deterministic-dom-cleaner.js";
import { DeterministicFeatureExtractor } from "../../src/adapters/feature-extractor/deterministic-feature-extractor.js";
import { DeterministicSemanticAnalyzer } from "../../src/adapters/semantic-analyzer/deterministic-semantic-analyzer.js";
import type { DomCleanRequest, RawDomNode } from "../../src/dom-cleaner/public.js";
import type { FeatureCandidate, FeatureExtractionRequest } from "../../src/feature-extractor/public.js";
import type { SemanticObservation } from "../../src/semantic-analyzer/public.js";
import type { JsonObject, WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-feature-001",
    actor_id: "actor-feature-001",
    actor_type: "service",
    roles: ["ui-capture"],
    permissions: ["capture:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-feature-001",
    correlation_id: "correlation-feature-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function observation(overrides: Partial<SemanticObservation> = {}): SemanticObservation {
  return {
    observation_id: "observation-1",
    kind: "fact",
    concept_type: "Action",
    normalized_value: "Submit",
    source_spans: [{ source_ref: "capture://raw/001", path: ["children", "0"] }],
    relationships: [],
    confidence: 1,
    authority: "deterministic_rule",
    applicability: {},
    diagnostics: [],
    ...overrides,
  };
}

function extractionRequest(observations: readonly SemanticObservation[], overrides: Partial<FeatureExtractionRequest> = {}): FeatureExtractionRequest {
  return {
    extraction_id: "extraction-001",
    context: workspaceContext(),
    ontology_version: "1.0.0",
    observations,
    ...overrides,
  };
}

test("extracts an Action candidate from a fact observation with stable identity from its normalized_value", async () => {
  const extractor = new DeterministicFeatureExtractor();

  const result = await extractor.extract(extractionRequest([observation()]));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.candidates.length, 1);
  assert.equal(result.value.candidates[0]?.entity_type, "Action");
  assert.equal(result.value.candidates[0]?.proposed_identity, "Submit");
  assert.deepEqual(result.value.candidates[0]?.evidence_observation_ids, ["observation-1"]);
});

test("a new candidate with no prior feature map is reported as a change", async () => {
  const extractor = new DeterministicFeatureExtractor();

  const result = await extractor.extract(extractionRequest([observation()]));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.changes.length, 1);
  assert.equal(result.value.changes[0]?.change_class, "workflow");
});

test("an unchanged candidate against the prior feature map produces no change", async () => {
  const extractor = new DeterministicFeatureExtractor();
  const prior: FeatureCandidate = {
    candidate_id: "candidate-prior-1",
    entity_type: "Action",
    proposed_identity: "Submit",
    name: "Submit",
    purpose: "",
    action_candidate_ids: [],
    state_candidate_ids: [],
    permissions: [],
    evidence_observation_ids: ["observation-0"],
    confidence: 1,
    conflict_ids: [],
    applicability: {},
  };

  const result = await extractor.extract(extractionRequest([observation()], { prior_feature_map: [prior] }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.changes.length, 0);
});

test("a changed accessible name for the same identity is classified as a semantic change, not presentation_only (SPEC-303 §6)", async () => {
  const extractor = new DeterministicFeatureExtractor();
  const prior: FeatureCandidate = {
    candidate_id: "candidate-prior-1",
    entity_type: "Action",
    proposed_identity: "Submit",
    name: "Send",
    purpose: "",
    action_candidate_ids: [],
    state_candidate_ids: [],
    permissions: [],
    evidence_observation_ids: ["observation-0"],
    confidence: 1,
    conflict_ids: [],
    applicability: {},
  };

  const result = await extractor.extract(extractionRequest([observation({ normalized_value: "Submit" })], { prior_feature_map: [prior] }));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.changes.length, 1);
  assert.equal(result.value.changes[0]?.change_class, "semantic");
});

test("two distinct observations resolving to the same identity fail closed as identity_collision (SPEC-303 §5)", async () => {
  const extractor = new DeterministicFeatureExtractor();
  const observations = [
    observation({ observation_id: "observation-1", normalized_value: "Submit" }),
    observation({ observation_id: "observation-2", normalized_value: "Submit" }),
  ];

  const result = await extractor.extract(extractionRequest(observations));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "identity_collision");
});

test("fails closed with incomplete_extraction when there are no observations at all", async () => {
  const extractor = new DeterministicFeatureExtractor();

  const result = await extractor.extract(extractionRequest([]));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "incomplete_extraction");
});

test("fails closed with incompatible_ontology when ontology_version is missing", async () => {
  const extractor = new DeterministicFeatureExtractor();

  const result = await extractor.extract(extractionRequest([observation()], { ontology_version: "" }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "incompatible_ontology");
});

test("observations that resolve to no known entity type (e.g. Region) are skipped without error", async () => {
  const extractor = new DeterministicFeatureExtractor();
  const result = await extractor.extract(extractionRequest([observation({ concept_type: "Region" })]));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.candidates.length, 0);
});

test("end-to-end: DomCleaner -> SemanticAnalyzer -> FeatureExtractor, all real, no mocks (SPEC-303 depends_on SPEC-301+SPEC-302)", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw: RawDomNode = {
    tag: "form",
    attributes: {},
    children: [
      { tag: "button", attributes: {}, accessible_role: "button", accessible_name: "Log in", text: "Log in", children: [] },
      { tag: "script", attributes: {}, text: "trackEvent()", children: [] },
    ],
  };
  const cleanRequest: DomCleanRequest = {
    capture_id: "capture-pipeline-001",
    url_classification: "internal",
    context: workspaceContext(),
    actor_role: "qa-agent",
    environment: "test",
    captured_at: "2026-08-06T09:00:00.000Z",
    raw_content_ref: "capture://raw/pipeline-001",
    raw,
    redaction_policy: { rules: [], redact_text_matching: [] },
    limits: { max_bytes: 100_000, max_depth: 50, max_nodes: 1000, max_attribute_length: 500, max_text_length: 1000 },
    capture_authorized: true,
  };

  const cleaned = await cleaner.clean(cleanRequest);
  assert.equal(cleaned.ok, true, JSON.stringify(cleaned));
  if (!cleaned.ok) return;

  const analyzer = new DeterministicSemanticAnalyzer();
  const analyzed = await analyzer.analyze({
    analysis_id: "analysis-pipeline-001",
    context: workspaceContext(),
    source_kind: "cleaned_dom",
    source_ref: cleaned.value.capture_id,
    source_content: cleaned.value.sanitized_tree as unknown as JsonObject,
    ontology_version: "1.0.0",
    applicable_rule_ids: [],
    purpose: "discover login form actions",
  });
  assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
  if (!analyzed.ok) return;

  const extractor = new DeterministicFeatureExtractor();
  const extracted = await extractor.extract(
    extractionRequest(analyzed.value.observations, { extraction_id: "extraction-pipeline-001" }),
  );

  assert.equal(extracted.ok, true, JSON.stringify(extracted));
  if (!extracted.ok) return;
  assert.equal(extracted.value.candidates.length, 1);
  assert.equal(extracted.value.candidates[0]?.entity_type, "Action");
  assert.equal(extracted.value.candidates[0]?.name, "Log in");
});
