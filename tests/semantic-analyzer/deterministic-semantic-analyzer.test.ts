import assert from "node:assert/strict";
import test from "node:test";

import { DeterministicDomCleaner } from "../../src/adapters/dom-cleaner/deterministic-dom-cleaner.js";
import { DeterministicSemanticAnalyzer } from "../../src/adapters/semantic-analyzer/deterministic-semantic-analyzer.js";
import type { DomCleanRequest, RawDomNode } from "../../src/dom-cleaner/public.js";
import type { SemanticAnalysisRequest } from "../../src/semantic-analyzer/public.js";
import type { JsonObject, WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-semantic-001",
    actor_id: "actor-semantic-001",
    actor_type: "service",
    roles: ["ui-capture"],
    permissions: ["capture:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-semantic-001",
    correlation_id: "correlation-semantic-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T09:00:00.000Z",
    expires_at: "2026-08-06T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function node(tag: string, overrides: Partial<RawDomNode> = {}): RawDomNode {
  return { tag, attributes: {}, children: [], ...overrides };
}

function analysisRequest(sourceContent: JsonObject, overrides: Partial<SemanticAnalysisRequest> = {}): SemanticAnalysisRequest {
  return {
    analysis_id: "analysis-001",
    context: workspaceContext(),
    source_kind: "cleaned_dom",
    source_ref: "capture://raw/001",
    source_content: sourceContent,
    ontology_version: "1.0.0",
    applicable_rule_ids: [],
    purpose: "discover interactive elements",
    ...overrides,
  };
}

test("resolves an interactive element with an accessible name to a fact observation", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const cleanedDom: JsonObject = {
    node_id: "node-1",
    tag: "div",
    retained_attributes: {},
    children: [
      { node_id: "node-2", tag: "button", retained_attributes: {}, accessible_name: "Submit", interaction_hint: "clickable", children: [] },
    ],
  };

  const result = await analyzer.analyze(analysisRequest(cleanedDom));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.observations.length, 1);
  assert.equal(result.value.observations[0]?.concept_type, "Action");
  assert.equal(result.value.observations[0]?.normalized_value, "Submit");
  assert.equal(result.value.observations[0]?.authority, "deterministic_rule");
  assert.equal(result.value.observations[0]?.confidence, 1);
});

test("an interactive element with no accessible_name is still observed, but flagged unresolved", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const cleanedDom: JsonObject = {
    node_id: "node-1",
    tag: "input",
    retained_attributes: {},
    interaction_hint: "editable",
    children: [],
  };

  const result = await analyzer.analyze(analysisRequest(cleanedDom));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.observations.length, 1);
  assert.equal(result.value.observations[0]?.concept_type, "Field");
  assert.equal(result.value.coverage.unresolved_spans, 1);
  assert.ok(result.value.observations[0]?.diagnostics.length ?? 0 > 0);
});

test("non-interactive elements produce no observations, deterministically", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const cleanedDom: JsonObject = {
    node_id: "node-1",
    tag: "div",
    retained_attributes: {},
    children: [{ node_id: "node-2", tag: "p", retained_attributes: {}, text: "just text", children: [] }],
  };

  const result = await analyzer.analyze(analysisRequest(cleanedDom));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.observations.length, 0);
});

test("never fabricates an inferred observation — this analyzer performs no AI stage (SPEC-301 §2)", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const result = await analyzer.analyze(analysisRequest({ node_id: "n", tag: "div", retained_attributes: {}, children: [] }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.coverage.inferred_observations, 0);
  assert.ok(result.value.observations.every((observation) => observation.authority === "deterministic_rule"));
});

test("fails closed when ontology_version is missing", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const result = await analyzer.analyze(analysisRequest({ tag: "div", retained_attributes: {}, children: [] }, { ontology_version: "" }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "missing_ontology");
});

test("fails closed for an unsupported source_kind", async () => {
  const analyzer = new DeterministicSemanticAnalyzer();
  const result = await analyzer.analyze(analysisRequest({}, { source_kind: "text_document" }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_format");
});

test("end-to-end: a real DomCleaner output feeds a real SemanticAnalyzer analysis (SPEC-301 depends_on SPEC-302)", async () => {
  const cleaner = new DeterministicDomCleaner();
  const raw = node("form", {
    children: [
      node("button", { accessible_role: "button", accessible_name: "Log in", text: "Log in" }),
      node("input", { accessible_role: "textbox", attributes: { type: "text" } }),
      node("script", { text: "trackEvent()" }),
    ],
  });
  const cleanRequest: DomCleanRequest = {
    capture_id: "capture-e2e-001",
    url_classification: "internal",
    context: workspaceContext(),
    actor_role: "qa-agent",
    environment: "test",
    captured_at: "2026-08-06T09:00:00.000Z",
    raw_content_ref: "capture://raw/e2e-001",
    raw,
    redaction_policy: { rules: [], redact_text_matching: [] },
    limits: { max_bytes: 100_000, max_depth: 50, max_nodes: 1000, max_attribute_length: 500, max_text_length: 1000 },
    capture_authorized: true,
  };

  const cleaned = await cleaner.clean(cleanRequest);
  assert.equal(cleaned.ok, true, JSON.stringify(cleaned));
  if (!cleaned.ok) return;

  const analyzer = new DeterministicSemanticAnalyzer();
  const analyzed = await analyzer.analyze(
    analysisRequest(cleaned.value.sanitized_tree as unknown as JsonObject, { source_ref: cleaned.value.capture_id }),
  );

  assert.equal(analyzed.ok, true, JSON.stringify(analyzed));
  if (!analyzed.ok) return;
  // The button (clickable, named "Log in") and the input (editable, no
  // accessible_name) both survive real cleaning and real analysis; the
  // script tag never reaches the analyzer at all because DomCleaner
  // already removed it.
  assert.equal(analyzed.value.observations.length, 2);
  const button = analyzed.value.observations.find((observation) => observation.normalized_value === "Log in");
  assert.equal(button?.concept_type, "Action");
});
