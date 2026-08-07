import { createHash } from "node:crypto";

import { stableStringify } from "../shared/stable-stringify.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from "../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

/**
 * SPEC-108 §4.1 Working Memory / AP-064 (Context and Cost Efficiency):
 * reuses an already-retrieved Knowledge Store result within the lifetime of
 * a single Agent run when the underlying durable references — query, scope,
 * applicability, and Knowledge Store snapshot — are unchanged, instead of
 * re-querying on every reasoning iteration.
 *
 * This is a decorator over KnowledgeSearch, not a replacement for it: a
 * cache miss (or a request whose durable references changed) always falls
 * through to the wrapped search. Working Memory holds no state beyond the
 * caller-supplied run scope and is discarded when that scope is dropped
 * (SPEC-108 §4.1 "discarded when the run terminates").
 */
export class WorkingMemoryKnowledgeSearch implements KnowledgeSearch {
  readonly #inner: KnowledgeSearch;
  readonly #entries = new Map<string, KnowledgeSearchResult>();
  #hits = 0;
  #misses = 0;

  constructor(inner: KnowledgeSearch) {
    this.#inner = inner;
  }

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    const digest = requestDigest(request);
    const cached = this.#entries.get(digest);
    if (cached !== undefined) {
      this.#hits += 1;
      return cached;
    }
    this.#misses += 1;
    const result = await this.#inner.search(request);
    this.#entries.set(digest, result);
    return result;
  }

  /** SPEC-108 §11 observability: cache/reuse hit rate within a run. */
  reuseStats(): Readonly<{ hits: number; misses: number }> {
    return { hits: this.#hits, misses: this.#misses };
  }

  /** Explicit invalidation when a caller knows an underlying reference changed. */
  clear(): void {
    this.#entries.clear();
  }
}

/**
 * A change to any durable reference (workspace, query text, scope,
 * applicability, authority filter, limit, or Knowledge Store snapshot)
 * invalidates reuse, per SPEC-309 §4: "A change to an underlying reference
 * invalidates reuse and forces re-resolution."
 */
function requestDigest(request: KnowledgeSearchRequest): string {
  const canonical = {
    workspace_id: request.context.workspace_id,
    query: request.query,
    scopes: [...request.scopes].sort(),
    authority_statuses: [...request.authority_statuses].sort(),
    applicability: request.applicability,
    limit: request.limit,
    knowledge_snapshot: request.knowledge_snapshot,
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

