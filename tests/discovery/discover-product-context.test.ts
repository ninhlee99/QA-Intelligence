import assert from "node:assert/strict";
import test from "node:test";

import { DiscoverProductContext, type IdFactory } from "../../src/discovery/discover-product-context.js";
import type { DiscoveryRequest } from "../../src/discovery/public.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

const WORKSPACE_ID = "workspace-discovery-001";

class SequenceIds implements IdFactory {
  #next = 0;
  next(scope: "finding" | "question"): string {
    this.#next += 1;
    return `${scope}-${this.#next}`;
  }
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  readonly requests: WorkspaceAuthorizationRequest[] = [];
  authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    this.requests.push(request);
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["policy:allow-discovery"],
      },
    });
  }
}

class DenyingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: false,
      failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: ["policy:deny"] },
    });
  }
}

/** Returns hits only for scopes listed in `knownScopes`; other scopes return empty. Fails closed for `failingScopes`. */
class ScopedKnowledgeStub implements KnowledgeSearch {
  readonly requests: KnowledgeSearchRequest[] = [];
  constructor(
    private readonly knownScopes: ReadonlySet<string>,
    private readonly failingScopes: ReadonlySet<string> = new Set(),
  ) {}

  search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    this.requests.push(request);
    const scope = request.scopes[0] ?? "";
    if (this.failingScopes.has(scope)) {
      return Promise.resolve({
        ok: false,
        failure: { code: "unavailable", message: "source unreachable", retryable: true, evidence: [] },
      });
    }
    if (!this.knownScopes.has(scope)) {
      return Promise.resolve({
        ok: true,
        value: { hits: [], knowledge_snapshot: "1.0.0", projection_freshness: "current", warnings: [] },
      });
    }
    return Promise.resolve({
      ok: true,
      value: {
        hits: [
          {
            knowledge_ref: `KO-${scope}@1.0.0`,
            title: `${scope} finding`,
            excerpt: `Accepted knowledge for ${scope}.`,
            authority_status: "accepted",
            provenance: [`SPEC-${scope}`],
            evidence: [`knowledge-evidence:KO-${scope}@1.0.0`],
            relevance: 0.9,
          },
        ],
        knowledge_snapshot: "1.0.0",
        projection_freshness: "current",
        warnings: [],
      },
    });
  }
}

function context(workspaceId: string = WORKSPACE_ID): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    actor_id: "discoverer-001",
    actor_type: "human",
    roles: ["discovery-operator"],
    permissions: ["knowledge:read"],
    policy_version: "policy@1.0.0",
    request_id: "request-discovery-001",
    correlation_id: "correlation-discovery-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-05T07:00:00.000Z",
    expires_at: "2026-08-05T09:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function request(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return {
    operation_id: "discovery-op-1",
    context: context(),
    scope: { workspace_id: WORKSPACE_ID, knowledge_scopes: ["requirements", "architecture"] },
    objective: "understand the audit reporting capability",
    knowledge_snapshot: "1.0.0",
    ...overrides,
  };
}

test("produces a fact finding for a scope with accepted Knowledge Store hits", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]));
  const discovery = new DiscoverProductContext({
    authorizer: new AllowingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  const requirementsFinding = result.value.findings.find((finding) => finding.evidence[0]?.startsWith("KO-requirements"));
  assert.ok(requirementsFinding, "expected a finding sourced from the requirements scope");
  assert.equal(requirementsFinding.basis, "fact");
});

test("marks an empty scope as unknown and raises a clarification question, never fabricating a finding", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]));
  const discovery = new DiscoverProductContext({
    authorizer: new AllowingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  const architectureEntry = result.value.known_unknown_register.find((entry) => entry.topic === "architecture");
  assert.equal(architectureEntry?.status, "unknown");
  assert.equal(
    result.value.clarification_questions.some((question) => question.question.includes("architecture")),
    true,
  );
  assert.equal(result.value.findings.some((finding) => finding.statement.includes("architecture")), false);
});

test("an unreachable scope becomes a limitation, not evidence the feature is absent (SPEC-201 §10)", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]), new Set(["architecture"]));
  const discovery = new DiscoverProductContext({
    authorizer: new AllowingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.value.limitations.some((limitation) => limitation.startsWith("architecture:unavailable")), true);
  assert.equal(result.value.coverage.includes("architecture"), false);
  assert.equal(result.value.coverage.includes("requirements"), true);
});

test("blocks discovery before any Knowledge Store query when authorization is denied", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]));
  const discovery = new DiscoverProductContext({
    authorizer: new DenyingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request());

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.class, "authorization");
  assert.equal(knowledge.requests.length, 0, "no Knowledge Store query should happen before authorization");
});

test("rejects a scope whose workspace_id does not match the trusted context", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]));
  const discovery = new DiscoverProductContext({
    authorizer: new AllowingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(
    request({ scope: { workspace_id: "workspace-other-999", knowledge_scopes: ["requirements"] } }),
  );

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "workspace_scope_mismatch");
  assert.equal(knowledge.requests.length, 0);
});

test("rejects an empty knowledge_scopes list before any authorization or query", async () => {
  const authorizer = new AllowingAuthorizer();
  const knowledge = new ScopedKnowledgeStub(new Set());
  const discovery = new DiscoverProductContext({
    authorizer,
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request({ scope: { workspace_id: WORKSPACE_ID, knowledge_scopes: [] } }));

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "empty_scope");
  assert.equal(authorizer.requests.length, 0);
});

test("every scope is searched independently: one failing scope does not suppress another scope's findings", async () => {
  const knowledge = new ScopedKnowledgeStub(new Set(["requirements"]), new Set(["architecture"]));
  const discovery = new DiscoverProductContext({
    authorizer: new AllowingAuthorizer(),
    knowledge,
    ids: new SequenceIds(),
    configuration: { resolved_versions: {}, limits: { hits_per_scope: 5 } },
  });

  const result = await discovery.discover(request());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.value.findings.length, 1);
  assert.equal(result.value.limitations.length, 1);
});
