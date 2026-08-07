import type {
  SemanticAnalysisRequest,
  SemanticAnalysisResult,
  SemanticAnalysisValue,
  SemanticAnalyzer,
  SemanticAnalyzerFailureCode,
  SemanticObservation,
  SourceSpan,
} from "../../semantic-analyzer/public.js";
import type { JsonObject } from "../../requirement-review/public.js";

/**
 * Deterministic reference `SemanticAnalyzer` (SPEC-301 §9's required
 * deterministic-fixture adapter): applies only rule-based, deterministic
 * concept resolution — "Apply Deterministic Extraction" and "Resolve
 * Ontology Concepts" (SPEC-301 §4) — and never performs the "Perform
 * Bounded AI Analysis" pipeline stage, matching how
 * `ScriptedReasoningProvider([])` deliberately reports `unavailable`
 * rather than fabricating a model call elsewhere in this codebase. It
 * currently accepts `cleaned_dom` source content shaped like a
 * `DomCleaner`'s `CleanedDomNode` (SPEC-302) and resolves interactive
 * elements (buttons, links, inputs) to `fact`-kind observations of
 * concept type `Action` or `Field` — the narrowest deterministic mapping
 * SPEC-303's Feature Extractor can build on, not a claim of full semantic
 * coverage.
 */
export class DeterministicSemanticAnalyzer implements SemanticAnalyzer {
  static readonly VERSION = "1.0.0";

  async analyze(request: SemanticAnalysisRequest): Promise<SemanticAnalysisResult> {
    if (request.ontology_version.trim().length === 0) {
      return failure("missing_ontology", "An ontology_version is required to resolve concepts.");
    }
    if (request.context.workspace_id.trim().length === 0) {
      return failure("ambiguous_workspace", "A Workspace context is required.");
    }
    if (request.source_kind !== "cleaned_dom") {
      return failure("unsupported_format", `This deterministic analyzer only supports "cleaned_dom" source content, got "${request.source_kind}".`);
    }

    const observations: SemanticObservation[] = [];
    const unresolvedSpans: string[] = [];
    let sequence = 0;

    const walk = (node: unknown, path: readonly string[]): void => {
      if (!isJsonObject(node)) return;
      const tag = typeof node["tag"] === "string" ? node["tag"] : undefined;
      const interactionHint = typeof node["interaction_hint"] === "string" ? node["interaction_hint"] : undefined;
      const accessibleName = typeof node["accessible_name"] === "string" ? node["accessible_name"] : undefined;

      if (interactionHint !== undefined && interactionHint !== "none") {
        sequence += 1;
        const conceptType = interactionHint === "editable" || interactionHint === "selectable" ? "Field" : "Action";
        const span: SourceSpan = { source_ref: request.source_ref, path };
        if (accessibleName === undefined) {
          unresolvedSpans.push(path.join("/"));
        }
        observations.push({
          observation_id: `observation-${sequence}`,
          kind: "fact",
          concept_type: conceptType,
          normalized_value: accessibleName ?? `unnamed-${tag ?? "element"}`,
          source_spans: [span],
          relationships: [],
          confidence: 1,
          authority: "deterministic_rule",
          applicability: {},
          diagnostics: accessibleName === undefined ? [`node at ${path.join("/")} has no accessible_name; used a synthesized value`] : [],
        });
      }

      const children = node["children"];
      if (Array.isArray(children)) {
        children.forEach((child, index) => walk(child, [...path, "children", String(index)]));
      }
    };

    walk(request.source_content, []);

    const value: SemanticAnalysisValue = {
      observations,
      conflicts: [],
      candidates: [],
      coverage: {
        deterministic_observations: observations.length,
        inferred_observations: 0,
        unresolved_spans: unresolvedSpans.length,
      },
      analyzer_version: DeterministicSemanticAnalyzer.VERSION,
    };
    return { ok: true, value };
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(code: SemanticAnalyzerFailureCode, message: string): SemanticAnalysisResult {
  return { ok: false, failure: { code, message } };
}
