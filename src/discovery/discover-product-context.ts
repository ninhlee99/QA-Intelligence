import type {
  KnowledgeSearch,
  KnowledgeSearchHit,
  WorkspaceAuthorizer,
} from "../requirement-review/public.js";
import type {
  ClarificationQuestion,
  ConflictRegisterEntry,
  DiscoveryConfiguration,
  DiscoveryFinding,
  DiscoveryReport,
  DiscoveryRequest,
  DiscoveryResult,
  KnownUnknownRegisterEntry,
} from "./public.js";

export interface IdFactory {
  next(scope: "finding" | "question"): string;
}

type Dependencies = Readonly<{
  authorizer: WorkspaceAuthorizer;
  knowledge: KnowledgeSearch;
  ids: IdFactory;
  configuration: DiscoveryConfiguration;
}>;

/**
 * Deep module for the Discovery capability (SPEC-201), scoped to this
 * slice's actual adapters: Knowledge Store search only. SPEC-201 §8
 * (Semantic UI Discovery) requires a browser/DOM Platform Plugin (SPEC-503,
 * ADR-003/ADR-004) that does not exist yet — this module SHALL NOT invent
 * that surface; it discovers only what "Search Existing Knowledge" and
 * "Inspect Authoritative Sources" (SPEC-201 §6) can produce from an already
 * governed Knowledge Store.
 */
export class DiscoverProductContext {
  readonly #dependencies: Dependencies;

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryResult> {
    if (request.scope.knowledge_scopes.length === 0) {
      return {
        ok: false,
        failure: {
          class: "configuration",
          code: "empty_scope",
          message: "Discovery requires at least one Knowledge Store scope to search.",
          retryable: false,
          evidence: ["configuration:empty-knowledge-scopes"],
        },
      };
    }

    const authorization = await this.#dependencies.authorizer.authorize({
      operation_id: request.operation_id,
      context: request.context,
      purpose: "discover product context",
      consequence_class: "advisory",
      required_permissions: ["knowledge:read"],
      resource_refs: [
        `workspace:${request.scope.workspace_id}`,
        ...(request.scope.capability_id ? [`capability:${request.scope.capability_id}`] : []),
      ],
    });
    if (!authorization.ok) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: authorization.failure.code,
          message: authorization.failure.message,
          retryable: authorization.failure.retryable,
          evidence: [...authorization.failure.evidence],
        },
      };
    }
    if (request.scope.workspace_id !== request.context.workspace_id) {
      return {
        ok: false,
        failure: {
          class: "authorization",
          code: "workspace_scope_mismatch",
          message: "The requested Discovery scope does not match the trusted Workspace context.",
          retryable: false,
          evidence: [
            ...authorization.value.decision_evidence,
            `context-workspace:${request.context.workspace_id}`,
            `requested-workspace:${request.scope.workspace_id}`,
          ],
        },
      };
    }

    // SPEC-201 §7: repository/Knowledge Store discovery precedes any
    // question, and every scope is searched independently so a failure in
    // one scope doesn't hide coverage in another (§10 partial discovery).
    const findings: DiscoveryFinding[] = [];
    const registerByTopic = new Map<string, KnownUnknownRegisterEntry>();
    const limitations: string[] = [];
    const coverage: string[] = [];

    for (const scope of request.scope.knowledge_scopes) {
      const searched = await this.#dependencies.knowledge.search({
        operation_id: `${request.operation_id}:${scope}`,
        context: request.context,
        query: request.objective,
        scopes: [scope],
        authority_statuses: ["accepted"],
        applicability: request.scope.capability_id
          ? { capability_id: request.scope.capability_id }
          : {},
        limit: this.#dependencies.configuration.limits.hits_per_scope,
        knowledge_snapshot: request.knowledge_snapshot,
      });

      if (!searched.ok) {
        // SPEC-201 §10: distinguish unavailable/unauthorized source from
        // an absent feature — an unreachable scope is a limitation, not a
        // finding that nothing exists there.
        limitations.push(`${scope}:${searched.failure.code}`);
        registerByTopic.set(scope, { topic: scope, status: "unknown", finding_ids: [] });
        continue;
      }

      coverage.push(scope);
      if (searched.value.hits.length === 0) {
        registerByTopic.set(scope, { topic: scope, status: "unknown", finding_ids: [] });
        continue;
      }

      const scopeFindingIds: string[] = [];
      for (const hit of searched.value.hits) {
        const finding = toFinding(this.#dependencies.ids, hit);
        findings.push(finding);
        scopeFindingIds.push(finding.id);
      }
      registerByTopic.set(scope, {
        topic: scope,
        status: "known",
        finding_ids: Object.freeze(scopeFindingIds),
      });
    }

    // SPEC-201 §9: a clarification question is warranted only for a topic
    // discovery could not resolve from any authorized, reachable source.
    const questions: ClarificationQuestion[] = [...registerByTopic.values()]
      .filter((entry) => entry.status === "unknown")
      .map((entry) => ({
        id: this.#dependencies.ids.next("question"),
        question: `What is the authoritative source for "${entry.topic}" in this Workspace?`,
        reason: `No accepted Knowledge Object was found for scope "${entry.topic}"; an unsupported assumption here would be unsafe.`,
        blocking: false,
      }));

    // This slice has no cross-hit semantic contradiction detection yet
    // (that requires comparing claims, not just presence/absence) — the
    // conflict register exists in the contract (SPEC-201 §5) but is always
    // empty until a real conflict-detection rule exists. It SHALL NOT be
    // fabricated.
    const conflicts: readonly ConflictRegisterEntry[] = [];

    const report: DiscoveryReport = {
      schema_version: "1.0.0",
      workspace_id: request.scope.workspace_id,
      scope: request.scope,
      objective: request.objective,
      findings: Object.freeze(findings),
      known_unknown_register: Object.freeze([...registerByTopic.values()]),
      conflict_register: conflicts,
      clarification_questions: Object.freeze(questions),
      knowledge_snapshot: request.knowledge_snapshot,
      coverage: Object.freeze(coverage),
      limitations: Object.freeze(limitations),
    };
    return { ok: true, value: report };
  }
}

function toFinding(ids: IdFactory, hit: KnowledgeSearchHit): DiscoveryFinding {
  return {
    id: ids.next("finding"),
    // A hit from the governed, accepted Knowledge Store is a fact, not an
    // inference — SPEC-201 §66 requires this distinction to be explicit,
    // not left to the reader.
    basis: "fact",
    statement: hit.excerpt,
    evidence: [hit.knowledge_ref, ...hit.evidence, ...hit.provenance],
    authority_status: hit.authority_status,
    relevance: hit.relevance,
  };
}
