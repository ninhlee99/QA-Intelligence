import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryKnowledgeGraphBuilder } from "../../src/adapters/memory/in-memory-knowledge-graph-builder.js";
import { InMemoryKnowledgeRepository } from "../../src/adapters/memory/in-memory-knowledge-repository.js";
import { InMemoryCandidateRepository } from "../../src/adapters/memory/in-memory-candidate-repository.js";
import type { KnowledgeObject } from "../../src/knowledge/public.js";
import type {
  OntologyRelease,
  OntologyRepository,
  OntologyResult,
} from "../../src/ontology/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

class FixedOntologyRepository implements OntologyRepository {
  async currentRelease(): Promise<OntologyResult<OntologyRelease>> {
    return {
      ok: true,
      value: {
        version: "1.0.0",
        entities: [{ id: "KnowledgeObject", family: "knowledge", workspace_scope: "global_or_workspace" }],
        relationships: [],
        enumerations: [],
        constraints: [],
        integrity_digest: "sha256:test",
      },
    };
  }
  async release(): Promise<OntologyResult<OntologyRelease>> {
    return this.currentRelease();
  }
  async resolveTerm(): Promise<OntologyResult<never>> {
    return { ok: false, failure: { code: "unknown_term", message: "not used in this test double" } };
  }
  async validateExtension() {
    return { valid: true as const };
  }
  async compareReleases() {
    return { ok: true as const, value: { added_entities: [], removed_entities: [], added_relationships: [], removed_relationships: [], compatible: true } };
  }
}

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-graph-001",
    actor_type: "service",
    roles: ["graph-builder"],
    permissions: ["knowledge:read", "candidate:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-graph-001",
    correlation_id: "correlation-graph-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T09:00:00.000Z",
    expires_at: "2026-08-08T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function draftInput(overrides: Partial<KnowledgeObject> = {}): Omit<KnowledgeObject, "status" | "version" | "reviewed_at"> & Readonly<{ version?: string }> {
  return {
    id: "KO-001",
    type: "test_pattern",
    workspace_id: "workspace-alpha",
    title: "Observable acceptance criteria",
    summary: "A testable requirement has observable acceptance criteria.",
    claims: [],
    provenance: [
      {
        source_type: "spec",
        source_id: "SPEC-203",
        source_version_or_captured_at: "1.0.0",
        acquired_by: "actor-graph-001",
        acquisition_method: "manual_review",
        transformation_history: [],
        workspace_scope: "workspace-alpha",
      },
    ],
    authority: "authoritative",
    confidence: 0.9,
    owner: "actor-graph-001",
    applicability: {},
    relationships: [],
    valid_from: "2026-08-08T09:00:00.000Z",
    valid_until: null,
    ...overrides,
  };
}

async function makeKnowledgeRepository(): Promise<InMemoryKnowledgeRepository> {
  return Promise.resolve(new InMemoryKnowledgeRepository({ now: () => new Date("2026-08-08T09:30:00.000Z") }));
}

function makeCandidateRepository(): InMemoryCandidateRepository {
  return new InMemoryCandidateRepository({ now: () => new Date("2026-08-08T09:30:00.000Z") });
}

function makeBuilder(
  knowledgeRepository: InMemoryKnowledgeRepository,
  candidateRepository: InMemoryCandidateRepository,
): InMemoryKnowledgeGraphBuilder {
  return new InMemoryKnowledgeGraphBuilder({
    clock: { now: () => new Date("2026-08-08T10:00:00.000Z") },
    knowledgeRepository,
    candidateRepository,
    ontologyRepository: new FixedOntologyRepository(),
  });
}

test("rebuild determinism: building twice from unchanged source state produces the same version", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-1" });
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  const first = await builder.build({ context: workspaceContext() });
  const second = await builder.build({ context: workspaceContext() });

  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.version, second.value.version);
  assert.deepEqual(first.value.nodes, second.value.nodes);
});

test("source provenance: every node carries its originating source ref", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-1" });
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  const result = await builder.build({ context: workspaceContext() });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;

  const node = result.value.nodes.find((candidate) => candidate.id === "KO-001");
  assert.notEqual(node, undefined);
  assert.deepEqual(node?.provenance_refs, ["spec:SPEC-203"]);
});

test("candidate separation: a layers:[authoritative] query never returns a candidate node", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-1" });
  const candidates = makeCandidateRepository();
  await candidates.createIdempotent({
    context: workspaceContext(),
    candidate: {
      id: "CANDIDATE-001",
      workspace_id: "workspace-alpha",
      proposed_claims: [],
      discovery_source: "execution-failure-pattern",
      rationale: "test",
      supporting_evidence_refs: ["execution:EXEC-1"],
      contradicting_evidence_refs: [],
      confidence: 0.5,
      uncertainty_reasons: [],
      affected_knowledge_refs: [],
      validation_plan: "test",
      owner: "actor-graph-001",
      expires_at: "2026-09-01T00:00:00.000Z",
    },
    idempotency_key: "idem-candidate-1",
  });
  const builder = makeBuilder(knowledge, candidates);

  const built = await builder.build({ context: workspaceContext() });
  assert.equal(built.ok, true, JSON.stringify(built));
  if (!built.ok) return;
  assert.equal(built.value.nodes.some((node) => node.layer === "candidate"), true);

  const authoritativeOnly = await builder.query({ context: workspaceContext(), layers: ["authoritative"] });
  assert.equal(authoritativeOnly.ok, true, JSON.stringify(authoritativeOnly));
  if (!authoritativeOnly.ok) return;
  assert.equal(authoritativeOnly.value.every((node) => node.layer === "authoritative"), true);
});

test("prohibited relationship: an edge from an authoritative node to a candidate node is flagged", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({
    context: workspaceContext(),
    draft: draftInput({ id: "KO-ROOT", relationships: ["derived_from:CANDIDATE-001"] }),
    idempotency_key: "idem-1",
  });
  const candidates = makeCandidateRepository();
  await candidates.createIdempotent({
    context: workspaceContext(),
    candidate: {
      id: "CANDIDATE-001",
      workspace_id: "workspace-alpha",
      proposed_claims: [],
      discovery_source: "execution-failure-pattern",
      rationale: "test",
      supporting_evidence_refs: [],
      contradicting_evidence_refs: [],
      confidence: 0.5,
      uncertainty_reasons: [],
      affected_knowledge_refs: [],
      validation_plan: "test",
      owner: "actor-graph-001",
      expires_at: "2026-09-01T00:00:00.000Z",
    },
    idempotency_key: "idem-candidate-1",
  });
  const builder = makeBuilder(knowledge, candidates);

  const result = await builder.build({ context: workspaceContext() });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(
    result.value.violations.some((violation) => violation.kind === "prohibited_relationship"),
    true,
  );
});

test("dangling reference: a relationship pointing to a nonexistent target is flagged, not a crash", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({
    context: workspaceContext(),
    draft: draftInput({ id: "KO-ROOT", relationships: ["derived_from:KO-NONEXISTENT"] }),
    idempotency_key: "idem-1",
  });
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  const result = await builder.build({ context: workspaceContext() });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(
    result.value.violations.some((violation) => violation.kind === "dangling_reference"),
    true,
  );
});

test("impact traversal: query with from_node_id finds downstream-connected nodes", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({ context: workspaceContext(), draft: draftInput({ id: "KO-LEAF" }), idempotency_key: "idem-leaf" });
  await knowledge.createDraft({
    context: workspaceContext(),
    draft: draftInput({ id: "KO-ROOT", relationships: ["derived_from:KO-LEAF"] }),
    idempotency_key: "idem-root",
  });
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  await builder.build({ context: workspaceContext() });
  const result = await builder.query({ context: workspaceContext(), from_node_id: "KO-ROOT" });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.some((node) => node.id === "KO-LEAF"), true);
});

test("cross-Workspace isolation: a Workspace-scoped node from another Workspace never appears", async () => {
  const knowledge = await makeKnowledgeRepository();
  await knowledge.createDraft({
    context: workspaceContext({ workspace_id: "workspace-beta" }),
    draft: draftInput({ id: "KO-BETA", workspace_id: "workspace-beta" }),
    idempotency_key: "idem-beta",
  });
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  const result = await builder.build({ context: workspaceContext({ workspace_id: "workspace-alpha" }) });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.nodes.some((node) => node.id === "KO-BETA"), false);
});

test("atomic publish: currentProjection reflects only a successfully published build", async () => {
  const knowledge = await makeKnowledgeRepository();
  const candidates = makeCandidateRepository();
  const builder = makeBuilder(knowledge, candidates);

  const before = await builder.currentProjection(workspaceContext());
  assert.equal(before.ok, false);

  await knowledge.createDraft({ context: workspaceContext(), draft: draftInput(), idempotency_key: "idem-1" });
  await builder.build({ context: workspaceContext() });

  const after = await builder.currentProjection(workspaceContext());
  assert.equal(after.ok, true, JSON.stringify(after));
  if (!after.ok) return;
  assert.equal(after.value.nodes.length, 1);
});
