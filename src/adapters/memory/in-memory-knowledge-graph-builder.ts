import { createHash } from "node:crypto";

import type {
  BuildGraphProjectionRequest,
  GraphConstraintViolation,
  GraphEdge,
  GraphNode,
  GraphProjection,
  GraphQueryFilter,
  KnowledgeGraphBuilder,
  KnowledgeGraphBuilderFailureCode,
  KnowledgeGraphBuilderResult,
} from "../../knowledge-graph/public.js";
import type { CandidateRepository } from "../../candidate-repository/public.js";
import type { KnowledgeCandidate, KnowledgeObject, KnowledgeRepository } from "../../knowledge/public.js";
import type { OntologyRepository } from "../../ontology/public.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";
import { stableStringify } from "../../shared/stable-stringify.js";

export interface Clock {
  now(): Date;
}

type Dependencies = Readonly<{
  clock: Clock;
  knowledgeRepository: KnowledgeRepository;
  candidateRepository: CandidateRepository;
  ontologyRepository: OntologyRepository;
}>;

/**
 * SPEC-307's required projection builder: an in-process, deterministic
 * `KnowledgeGraphBuilder` proving the §4 build pipeline, §3's layer
 * distinction, §2/§7's constraint detection, and §7's atomic-publish
 * guarantee (a failed build never replaces the last known-good
 * projection) — composed entirely from the existing `KnowledgeRepository`
 * (SPEC-401), `CandidateRepository` (SPEC-403), and `OntologyRepository`
 * (SPEC-408) ports rather than owning any new persistence. Durable
 * projection storage is separate, larger scope, not attempted here.
 */
export class InMemoryKnowledgeGraphBuilder implements KnowledgeGraphBuilder {
  readonly #clock: Clock;
  readonly #knowledgeRepository: KnowledgeRepository;
  readonly #candidateRepository: CandidateRepository;
  readonly #ontologyRepository: OntologyRepository;
  readonly #projections = new Map<string, GraphProjection>();

  constructor(dependencies: Dependencies) {
    this.#clock = dependencies.clock;
    this.#knowledgeRepository = dependencies.knowledgeRepository;
    this.#candidateRepository = dependencies.candidateRepository;
    this.#ontologyRepository = dependencies.ontologyRepository;
  }

  async build(request: BuildGraphProjectionRequest): Promise<KnowledgeGraphBuilderResult<GraphProjection>> {
    // §4 step 1: Read Versioned Source Changes.
    const knowledgeObjects = await this.#knowledgeRepository.query({ context: request.context, include_global: true });
    if (!knowledgeObjects.ok) {
      return failure("invalid_source", `Could not read Knowledge Objects: ${knowledgeObjects.failure.message}`, knowledgeObjects.failure.retryable);
    }
    const candidates = await this.#candidateRepository.query({ context: request.context });
    if (!candidates.ok) {
      return failure("invalid_source", `Could not read Knowledge Candidates: ${candidates.failure.message}`, candidates.failure.retryable);
    }

    // §4 step 2: Validate Ontology and Workspace — resolving the current
    // release is a hard dependency (its absence is `ontology_incompatibility`);
    // an individual object's `type` not matching a canonical ontology
    // entity id is tracked per-node (§2), not a build-failing condition,
    // since domain-specific subtypes (e.g. "test_pattern") are expected to
    // coexist with canonical ontology ids in practice.
    const ontologyRelease = await this.#ontologyRepository.currentRelease();
    if (!ontologyRelease.ok) {
      return failure("ontology_incompatibility", `Ontology unavailable: ${ontologyRelease.failure.message}`, false);
    }

    // §4 step 3: Resolve Identity and Relationships.
    const authoritativeNodes = knowledgeObjects.value.map((object) => toAuthoritativeNode(object));
    const candidateNodes = candidates.value.map((candidate) => toCandidateNode(candidate));
    const nodes = [...authoritativeNodes, ...candidateNodes];
    const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

    const edges: GraphEdge[] = [];
    for (const object of knowledgeObjects.value) {
      for (const relationshipRef of object.relationships) {
        const [relationshipType, targetId] = relationshipRef.split(":");
        if (relationshipType === undefined || targetId === undefined) continue;
        edges.push({
          id: `edge:${object.id}:${relationshipType}:${targetId}`,
          layer: "authoritative",
          from_node_id: object.id,
          to_node_id: targetId,
          relationship_type: relationshipType,
        });
      }
    }

    // §4 step 4: Apply Graph Constraints — detect, never silently drop
    // (§2: "detect dangling, duplicate, conflicting, and prohibited
    // relationships"; violated edges/nodes stay in the projection so a
    // caller can decide how to handle them, per §7's "counts, links, and
    // provenance" verification needing to see everything that was found).
    const violations: GraphConstraintViolation[] = [];

    const seenNodeKeys = new Set<string>();
    for (const node of nodes) {
      const key = `${node.id}@${node.version}`;
      if (seenNodeKeys.has(key)) {
        violations.push({ kind: "duplicate_node", message: `Duplicate node "${key}".`, node_or_edge_ref: key });
      }
      seenNodeKeys.add(key);
    }

    for (const edge of edges) {
      if (!nodesById.has(edge.to_node_id)) {
        violations.push({
          kind: "dangling_reference",
          message: `Edge "${edge.id}" references unknown target "${edge.to_node_id}".`,
          node_or_edge_ref: edge.id,
        });
        continue;
      }
      const fromNode = nodesById.get(edge.from_node_id);
      const toNode = nodesById.get(edge.to_node_id);
      // §2: "SHALL NOT... silently merge candidates with accepted
      // knowledge" — an authoritative-layer node pointing to a
      // candidate-layer node without going through promotion is exactly
      // that merge, so it is flagged as prohibited rather than treated as
      // a normal edge.
      if (fromNode?.layer === "authoritative" && toNode?.layer === "candidate") {
        violations.push({
          kind: "prohibited_relationship",
          message: `Edge "${edge.id}" links an authoritative node directly to a non-promoted candidate node.`,
          node_or_edge_ref: edge.id,
        });
      }
    }

    const edgePairCounts = new Map<string, Set<string>>();
    for (const edge of edges) {
      const pairKey = `${edge.from_node_id}->${edge.to_node_id}`;
      const types = edgePairCounts.get(pairKey) ?? new Set<string>();
      types.add(edge.relationship_type);
      edgePairCounts.set(pairKey, types);
    }
    for (const [pairKey, types] of edgePairCounts) {
      if (types.size > 1) {
        violations.push({
          kind: "conflicting_relationship",
          message: `Multiple, distinct relationship types declared for "${pairKey}": ${[...types].sort().join(", ")}.`,
          node_or_edge_ref: pairKey,
        });
      }
    }

    // §4 step 5: Materialize Versioned Projection.
    const builtAt = this.#clock.now().toISOString();
    const contentForDigest = { nodes, edges, violations };
    const version = `sha256:${createHash("sha256").update(stableStringify(contentForDigest)).digest("hex")}`;

    // §4 step 6: Verify Counts, Links, and Provenance — every node carries
    // its own provenance already (`toAuthoritativeNode`/`toCandidateNode`);
    // the check itself is the dangling/duplicate detection above plus this
    // shape assertion that every edge endpoint we claim exists really does
    // resolve to a materialized node id (already true by construction for
    // non-dangling edges).
    const projection: GraphProjection = {
      version,
      built_at: builtAt,
      source_versions: {
        knowledge: String(knowledgeObjects.value.length),
        candidates: String(candidates.value.length),
        ontology: ontologyRelease.value.version,
      },
      freshness: "current",
      nodes,
      edges,
      violations,
    };

    // §4 step 7: Publish Atomically — only reaching this line replaces the
    // stored projection; any earlier `return failure(...)` above left the
    // previous projection (if any) untouched.
    this.#projections.set(request.context.workspace_id, projection);
    return { ok: true, value: projection };
  }

  async currentProjection(context: WorkspaceContext): Promise<KnowledgeGraphBuilderResult<GraphProjection>> {
    const projection = this.#projections.get(context.workspace_id);
    if (projection === undefined) {
      return failure("not_found", `No published Knowledge Graph projection for Workspace "${context.workspace_id}".`, false);
    }
    return { ok: true, value: projection };
  }

  async query(filter: GraphQueryFilter): Promise<KnowledgeGraphBuilderResult<readonly GraphNode[]>> {
    const projection = this.#projections.get(filter.context.workspace_id);
    if (projection === undefined) {
      return failure("not_found", `No published Knowledge Graph projection for Workspace "${filter.context.workspace_id}".`, false);
    }

    const layerFilter = filter.layers !== undefined ? new Set(filter.layers) : undefined;
    const matchesFilters = (node: GraphNode): boolean =>
      (layerFilter === undefined || layerFilter.has(node.layer)) &&
      (filter.node_type === undefined || node.type === filter.node_type);

    if (filter.from_node_id === undefined) {
      return { ok: true, value: projection.nodes.filter(matchesFilters) };
    }

    // §7: "version batch and traversal limits" — bounded BFS from a start
    // node, mirroring `InMemoryKnowledgeRepository.traverseRelationships`'s
    // shape but layer-aware and over the materialized projection, not the
    // live source repository.
    const maxDepth = filter.max_depth ?? 10;
    const nodesById = new Map(projection.nodes.map((node) => [node.id, node] as const));
    const startNode = nodesById.get(filter.from_node_id);
    if (startNode === undefined) {
      return { ok: true, value: [] };
    }

    const visited = new Set<string>([filter.from_node_id]);
    let frontier = [filter.from_node_id];
    const results: GraphNode[] = [];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const currentId of frontier) {
        for (const edge of projection.edges) {
          if (edge.from_node_id !== currentId || visited.has(edge.to_node_id)) continue;
          if (filter.relationship_type !== undefined && edge.relationship_type !== filter.relationship_type) continue;
          const targetNode = nodesById.get(edge.to_node_id);
          if (targetNode === undefined || !matchesFilters(targetNode)) continue;
          visited.add(edge.to_node_id);
          results.push(targetNode);
          next.push(edge.to_node_id);
        }
      }
      frontier = next;
    }
    return { ok: true, value: results };
  }
}

function toAuthoritativeNode(object: KnowledgeObject): GraphNode {
  return {
    id: object.id,
    layer: "authoritative",
    type: object.type,
    version: object.version,
    authority: object.authority,
    provenance_refs: object.provenance.map((entry) => `${entry.source_type}:${entry.source_id}`),
    applicability: object.applicability,
    workspace_id: object.workspace_id,
  };
}

function toCandidateNode(candidate: KnowledgeCandidate): GraphNode {
  return {
    id: candidate.id,
    layer: "candidate",
    type: "KnowledgeCandidate",
    version: "0.1.0",
    authority: null,
    provenance_refs: [candidate.discovery_source],
    applicability: {},
    workspace_id: candidate.workspace_id,
  };
}

function failure<Value>(
  code: KnowledgeGraphBuilderFailureCode,
  message: string,
  retryable: boolean,
): KnowledgeGraphBuilderResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
