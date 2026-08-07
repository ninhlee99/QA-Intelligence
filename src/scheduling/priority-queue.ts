import type { AdmissionRequest, SchedulingPriorityClass } from "./public.js";

export interface Clock {
  now(): Date;
}

const PRIORITY_RANK: Readonly<Record<SchedulingPriorityClass, number>> = {
  critical_governance: 3,
  high: 2,
  normal: 1,
  low: 0,
};

type QueuedEntry = Readonly<{ request: AdmissionRequest; enqueued_at: string }>;

/**
 * SPEC-603 §3: "no Workspace may starve others through uncontrolled load"
 * and "critical governance and recovery work may use reserved capacity."
 * A small in-memory priority/fairness queue — critical-governance requests
 * dequeue ahead of everything else; among any other priority tier,
 * dequeue rotates fairly across Workspaces round-robin rather than
 * draining one Workspace's backlog before ever looking at another's.
 */
export class SchedulingQueue {
  readonly #clock: Clock;
  readonly #byWorkspace = new Map<string, QueuedEntry[]>();
  readonly #workspaceOrder: string[] = [];
  #rotationIndex = 0;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  enqueue(request: AdmissionRequest): number {
    const entries = this.#byWorkspace.get(request.workspace_id) ?? [];
    if (entries.length === 0) this.#workspaceOrder.push(request.workspace_id);
    entries.push({ request, enqueued_at: this.#clock.now().toISOString() });
    this.#byWorkspace.set(request.workspace_id, entries);
    return this.depth();
  }

  /** Critical-governance requests bypass fairness rotation entirely (SPEC-603 §3). */
  dequeueNext(): AdmissionRequest | undefined {
    const critical = this.#dequeueMatching((request) => request.priority === "critical_governance");
    if (critical !== undefined) return critical;
    return this.#dequeueFair();
  }

  depth(workspaceId?: string): number {
    if (workspaceId !== undefined) return (this.#byWorkspace.get(workspaceId) ?? []).length;
    let total = 0;
    for (const entries of this.#byWorkspace.values()) total += entries.length;
    return total;
  }

  /** SPEC-603 §7 observability: age in seconds of the oldest queued entry for a Workspace (or overall). */
  oldestAgeSeconds(workspaceId?: string): number | undefined {
    const now = this.#clock.now().valueOf();
    let oldest: string | undefined;
    for (const [candidateWorkspace, entries] of this.#byWorkspace) {
      if (workspaceId !== undefined && candidateWorkspace !== workspaceId) continue;
      for (const entry of entries) {
        if (oldest === undefined || entry.enqueued_at < oldest) oldest = entry.enqueued_at;
      }
    }
    if (oldest === undefined) return undefined;
    return (now - Date.parse(oldest)) / 1000;
  }

  #dequeueMatching(predicate: (request: AdmissionRequest) => boolean): AdmissionRequest | undefined {
    for (const workspaceId of this.#workspaceOrder) {
      const entries = this.#byWorkspace.get(workspaceId);
      if (entries === undefined || entries.length === 0) continue;
      const index = entries.findIndex((entry) => predicate(entry.request));
      if (index === -1) continue;
      const [removed] = entries.splice(index, 1);
      this.#pruneEmptyWorkspace(workspaceId, entries);
      return removed?.request;
    }
    return undefined;
  }

  #dequeueFair(): AdmissionRequest | undefined {
    const nonEmptyWorkspaces = this.#workspaceOrder.filter((id) => (this.#byWorkspace.get(id) ?? []).length > 0);
    if (nonEmptyWorkspaces.length === 0) return undefined;

    for (let attempt = 0; attempt < nonEmptyWorkspaces.length; attempt += 1) {
      const workspaceId = nonEmptyWorkspaces[this.#rotationIndex % nonEmptyWorkspaces.length];
      this.#rotationIndex += 1;
      if (workspaceId === undefined) continue;
      const entries = this.#byWorkspace.get(workspaceId);
      if (entries === undefined || entries.length === 0) continue;
      const best = highestPriorityIndex(entries);
      const [removed] = entries.splice(best, 1);
      this.#pruneEmptyWorkspace(workspaceId, entries);
      return removed?.request;
    }
    return undefined;
  }

  #pruneEmptyWorkspace(workspaceId: string, entries: QueuedEntry[]): void {
    if (entries.length > 0) {
      this.#byWorkspace.set(workspaceId, entries);
      return;
    }
    this.#byWorkspace.delete(workspaceId);
    const index = this.#workspaceOrder.indexOf(workspaceId);
    if (index !== -1) this.#workspaceOrder.splice(index, 1);
  }
}

function highestPriorityIndex(entries: readonly QueuedEntry[]): number {
  let bestIndex = 0;
  let bestRank = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const rank = PRIORITY_RANK[entries[index]?.request.priority ?? "low"];
    if (rank > bestRank) {
      bestRank = rank;
      bestIndex = index;
    }
  }
  return bestIndex;
}
