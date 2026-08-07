import type { WorkingMemoryKnowledgeSearch } from "./working-memory.js";
import type { SessionMemory } from "./session-memory.js";

/**
 * SPEC-108 §11: the single observability surface for both Memory tiers.
 * Aggregates counters already tracked by Working Memory (cache/reuse hit
 * rate within a run) and Session Memory (promotion, expiry, and rejection
 * rates) instead of requiring each consumer to read scattered getters.
 */
export type MemoryObservabilityReport = Readonly<{
  working_memory: Readonly<{
    hits: number;
    misses: number;
    hit_rate: number;
  }>;
  session_memory: Readonly<{
    promotions: number;
    expiries: number;
    async_rejections: number;
    declines_by_reason: Readonly<Record<string, number>>;
    live_entry_count: number;
  }>;
}>;

export function reportMemoryObservability(
  workspaceId: string,
  workingMemory: WorkingMemoryKnowledgeSearch,
  sessionMemory: SessionMemory,
): MemoryObservabilityReport {
  const { hits, misses } = workingMemory.reuseStats();
  const total = hits + misses;
  const sessionStats = sessionMemory.stats();

  return {
    working_memory: {
      hits,
      misses,
      hit_rate: total === 0 ? 0 : hits / total,
    },
    session_memory: {
      promotions: sessionStats.promotions,
      expiries: sessionStats.expiries,
      async_rejections: sessionStats.async_rejections,
      declines_by_reason: sessionStats.declines_by_reason,
      live_entry_count: sessionMemory.entryCount(workspaceId),
    },
  };
}
