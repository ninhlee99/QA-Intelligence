import type { Lease, LeaseFailureReason, LeaseResult } from "./public.js";

export interface Clock {
  now(): Date;
}

type StoredLease = Readonly<{ lease: Lease; expires_at_ms: number }>;

/**
 * SPEC-603 §5: "Workers and environments SHALL use renewable bounded
 * leases. Expired leases enable safe recovery. Lease identity SHALL
 * prevent stale workers from finalizing current work." `fencing_token` is
 * a monotonic counter per lease, incremented on every renewal — a worker
 * holding a stale token (superseded by a later renewal, e.g. after the
 * scheduler considered the original holder lost and reissued) fails
 * `validate()`/`renew()` mechanically, not by convention.
 */
export class LeaseManager {
  readonly #clock: Clock;
  readonly #leases = new Map<string, StoredLease>();
  #nextLeaseId = 1;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  issue(resourceRef: string, workspaceId: string, durationSeconds: number): Lease {
    const now = this.#clock.now();
    const lease: Lease = {
      lease_id: `lease-${this.#nextLeaseId}`,
      resource_ref: resourceRef,
      workspace_id: workspaceId,
      fencing_token: 1,
      issued_at: now.toISOString(),
      expires_at: new Date(now.valueOf() + durationSeconds * 1000).toISOString(),
      renewed_count: 0,
    };
    this.#nextLeaseId += 1;
    this.#leases.set(lease.lease_id, { lease, expires_at_ms: now.valueOf() + durationSeconds * 1000 });
    return lease;
  }

  /** Renewal increments the fencing token — any holder of the prior token is now stale (SPEC-603 §5). */
  renew(leaseId: string, fencingToken: number, durationSeconds: number): LeaseResult<Lease> {
    const stored = this.#leases.get(leaseId);
    if (stored === undefined) return { ok: false, failure: "unknown_lease" };
    if (stored.expires_at_ms <= this.#clock.now().valueOf()) return { ok: false, failure: "expired" };
    if (stored.lease.fencing_token !== fencingToken) return { ok: false, failure: "fencing_mismatch" };

    const now = this.#clock.now();
    const renewed: Lease = {
      ...stored.lease,
      fencing_token: stored.lease.fencing_token + 1,
      expires_at: new Date(now.valueOf() + durationSeconds * 1000).toISOString(),
      renewed_count: stored.lease.renewed_count + 1,
    };
    this.#leases.set(leaseId, { lease: renewed, expires_at_ms: now.valueOf() + durationSeconds * 1000 });
    return { ok: true, value: renewed };
  }

  /** A worker calls this before finalizing work — an expired or fencing-mismatched lease means that completion SHALL NOT be accepted (§5). */
  validate(leaseId: string, fencingToken: number): LeaseResult<true> {
    const stored = this.#leases.get(leaseId);
    if (stored === undefined) return { ok: false, failure: "unknown_lease" };
    if (stored.expires_at_ms <= this.#clock.now().valueOf()) return { ok: false, failure: "expired" };
    if (stored.lease.fencing_token !== fencingToken) return { ok: false, failure: "fencing_mismatch" };
    return { ok: true, value: true };
  }

  /** SPEC-603 §9: "expired leases enable safe recovery" — sweeps every lease past its expiry, returning the freed resource_refs. */
  expireStale(): readonly string[] {
    const now = this.#clock.now().valueOf();
    const freed: string[] = [];
    for (const [leaseId, stored] of this.#leases) {
      if (stored.expires_at_ms <= now) {
        freed.push(stored.lease.resource_ref);
        this.#leases.delete(leaseId);
      }
    }
    return freed;
  }

  get(leaseId: string): Lease | undefined {
    return this.#leases.get(leaseId)?.lease;
  }
}
