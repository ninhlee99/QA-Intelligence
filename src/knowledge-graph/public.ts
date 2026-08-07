import type { KnowledgeAuthorityClass } from "../knowledge/public.js";
import type { JsonObject, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-307 (Knowledge Graph Builder Architecture): "materializes validated
 * ontology entities and relationships into navigable, version-aware,
 * Workspace-safe graph views" (§1) — "creates useful projections of
 * governed knowledge without becoming a second source of truth" (§8). This
 * is a read-side projection over `KnowledgeRepository` (SPEC-401) and
 * `CandidateRepository` (SPEC-403), validated against `OntologyRepository`
 * (SPEC-408) — it never mutates source knowledge, only builds and queries
 * a materialized view. `KnowledgeRepository.traverseRelationships` already
 * does single-layer BFS over accepted Knowledge Objects; this module adds
 * what that method doesn't have: layer distinction (§3), a versioned
 * checkpointed projection (§4/§5), and constraint detection (§2/§7).
 */
export type GraphLayer = "authoritative" | "candidate" | "runtime_evidence" | "derived";

/** SPEC-307 §2: "preserve identity, version, authority, provenance, and applicability." */
export type GraphNode = Readonly<{
  id: string;
  layer: GraphLayer;
  type: string;
  version: string;
  authority: KnowledgeAuthorityClass | null;
  provenance_refs: readonly string[];
  applicability: JsonObject;
  workspace_id: string | "global";
}>;

export type GraphEdge = Readonly<{
  id: string;
  layer: GraphLayer;
  from_node_id: string;
  to_node_id: string;
  relationship_type: string;
}>;

/** SPEC-307 §2/§7: the four violation kinds the builder SHALL detect. */
export type GraphConstraintViolationKind =
  | "dangling_reference"
  | "duplicate_node"
  | "conflicting_relationship"
  | "prohibited_relationship";

export type GraphConstraintViolation = Readonly<{
  kind: GraphConstraintViolationKind;
  message: string;
  node_or_edge_ref: string;
}>;

/** SPEC-307 §4's materialized pipeline output; §5: "query results SHALL expose projection version and freshness." */
export type GraphProjection = Readonly<{
  version: string;
  built_at: string;
  source_versions: Readonly<Record<string, string>>;
  freshness: "current" | "stale";
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  violations: readonly GraphConstraintViolation[];
}>;

/** An omitted `previous_projection` means a full rebuild (§5: "full rebuild SHALL produce semantically equivalent results"). */
export type BuildGraphProjectionRequest = Readonly<{
  context: WorkspaceContext;
  previous_projection?: GraphProjection;
}>;

export type GraphQueryFilter = Readonly<{
  context: WorkspaceContext;
  layers?: readonly GraphLayer[];
  node_type?: string;
  from_node_id?: string;
  relationship_type?: string;
  max_depth?: number;
}>;

/**
 * A dangling/duplicate/conflicting/prohibited relationship (§2/§7) is a
 * `GraphConstraintViolation` recorded inside a successfully-built
 * `GraphProjection` — it never fails the build itself (§4 step 4:
 * "detect... never silently drop"). Only a source read/write failure this
 * adapter can actually hit belongs in the build-failure list.
 */
export type KnowledgeGraphBuilderFailureCode =
  | "invalid_source"
  | "ontology_incompatibility"
  | "not_found";

export type KnowledgeGraphBuilderFailure = Readonly<{
  code: KnowledgeGraphBuilderFailureCode;
  message: string;
  retryable: boolean;
}>;

export type KnowledgeGraphBuilderResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: KnowledgeGraphBuilderFailure }>;

/** SPEC-307 §3's operations: build the §4 pipeline, retrieve the last published projection, and query it (layer-filterable, bounded traversal per §7). */
export interface KnowledgeGraphBuilder {
  build(request: BuildGraphProjectionRequest): Promise<KnowledgeGraphBuilderResult<GraphProjection>>;
  /** §7: "a failed incremental build SHALL not replace the last known-good projection" — this always returns that last-published one. */
  currentProjection(context: WorkspaceContext): Promise<KnowledgeGraphBuilderResult<GraphProjection>>;
  query(filter: GraphQueryFilter): Promise<KnowledgeGraphBuilderResult<readonly GraphNode[]>>;
}
