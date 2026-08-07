import { createHash } from "node:crypto";

import type {
  RecordRuleLifecycleTransitionRequest,
  ResolveApplicableRuleSetRequest,
  Rule,
  RuleLifecycleEvent,
  RuleRepository,
  RuleRepositoryFailureCode,
  RuleRepositoryResult,
  RuleStatus,
  SaveDraftRuleRequest,
  ValidateRulePackageIntegrityRequest,
} from "../../rule-repository/public.js";
import { stableStringify } from "../../shared/stable-stringify.js";
import type { WorkspaceContext } from "../../requirement-review/public.js";

export interface Clock {
  now(): Date;
}

type StoredRecord = Readonly<{ rule: Rule; revision: number }>;

/** SPEC-104 §13: draft → in_review → accepted → deprecated → superseded | archived — same shape as Knowledge Object's lifecycle table. */
const ALLOWED_TRANSITIONS: Readonly<Record<RuleStatus, readonly RuleStatus[]>> = {
  draft: ["in_review"],
  in_review: ["draft", "accepted"],
  accepted: ["deprecated", "superseded"],
  deprecated: ["archived"],
  superseded: ["archived"],
  archived: [],
};

/**
 * SPEC-402's required reference adapter: an in-process, deterministic
 * `RuleRepository` proving revision-checked writes, lifecycle legality,
 * accepted-version immutability, effective-time/Workspace-scoped
 * resolution, and package integrity — the same "deterministic reference
 * adapter" pattern `InMemoryKnowledgeRepository` established for SPEC-401.
 * Durable SQLite/PostgreSQL adapters are separate, larger scope, not
 * attempted here.
 */
export class InMemoryRuleRepository implements RuleRepository {
  readonly #clock: Clock;
  readonly #rules = new Map<string, StoredRecord>();
  readonly #history = new Map<string, Rule[]>();
  readonly #idempotency = new Map<string, Rule>();
  readonly #events: RuleLifecycleEvent[] = [];

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async saveDraft(request: SaveDraftRuleRequest): Promise<RuleRepositoryResult<Rule>> {
    const existingByKey = this.#idempotency.get(request.idempotency_key);
    if (existingByKey !== undefined) return { ok: true, value: existingByKey };

    const key = ruleKey(request.draft.id, request.draft.version);
    if (this.#rules.has(key)) {
      return failure("conflict", `Rule "${key}" already exists.`, false);
    }
    if (request.draft.workspace_scope !== "global" && request.draft.workspace_scope !== request.context.workspace_id) {
      return failure("unauthorized_override", "Draft Workspace scope does not match the trusted Workspace context.", false);
    }
    if (
      request.draft.effective_until !== null &&
      request.draft.effective_until <= request.draft.effective_from
    ) {
      return failure("conflicting_effective_range", "effective_until must be after effective_from.", false);
    }

    const rule: Rule = { ...request.draft, status: "draft" };
    this.#rules.set(key, { rule, revision: 1 });
    this.#appendHistory(rule);
    this.#idempotency.set(request.idempotency_key, rule);
    this.#recordEvent(key, "rule", 1, null, "draft", request.context.actor_id, "created", request.context.policy_version, []);
    return { ok: true, value: rule };
  }

  async getExactVersion(context: WorkspaceContext, id: string, version: string): Promise<RuleRepositoryResult<Rule>> {
    const history = this.#history.get(id) ?? [];
    const match = history.find((candidate) => candidate.version === version);
    if (match === undefined || !isWorkspaceVisible(match, context)) {
      return failure("unknown_package", `No version "${version}" of Rule "${id}".`, false);
    }
    return { ok: true, value: match };
  }

  async resolveApplicableRuleSet(request: ResolveApplicableRuleSetRequest): Promise<RuleRepositoryResult<readonly Rule[]>> {
    // §2: this repository resolves candidates only — ranking/conflict
    // resolution is SPEC-104 §9's job (`resolveRulePrecedence`), not this
    // seam's. "rule_set_id" scopes to rules sharing that id family; a real
    // rule-set-to-included-rules join is deferred until a domain needs it.
    const candidates = [...this.#rules.values()]
      .map((stored) => stored.rule)
      .filter((rule) => rule.status === "accepted")
      .filter((rule) => isWorkspaceVisible(rule, request.context))
      .filter((rule) => rule.id === request.rule_set_id || rule.id.startsWith(`${request.rule_set_id}:`))
      .filter((rule) => isEffectiveAt(rule, request.effective_at));
    return { ok: true, value: candidates };
  }

  async listHistory(context: WorkspaceContext, id: string): Promise<RuleRepositoryResult<readonly Rule[]>> {
    const history = (this.#history.get(id) ?? []).filter((rule) => isWorkspaceVisible(rule, context));
    return { ok: true, value: history };
  }

  async recordLifecycleTransition(request: RecordRuleLifecycleTransitionRequest): Promise<RuleRepositoryResult<Rule>> {
    const found = this.#requireOwned(request.id, request.context);
    if (!found.ok) return found;
    const { rule, revision } = found.value;

    if (revision !== request.expected_revision) {
      return failure("conflict", `Expected revision ${request.expected_revision} but found ${revision}.`, false);
    }
    if (!ALLOWED_TRANSITIONS[rule.status].includes(request.to_status)) {
      return failure(
        "unsupported_transition",
        `Cannot transition Rule "${request.id}" from "${rule.status}" to "${request.to_status}".`,
        false,
      );
    }

    // SPEC-402 §4: accepted versions are immutable — a further change to an
    // already-accepted rule goes through supersession (a new version), not
    // mutation of this record. Deprecation/archival are still status-only
    // transitions and remain allowed.
    const key = ruleKey(request.id, rule.version);
    const transitioned: Rule = { ...rule, status: request.to_status };
    this.#rules.set(key, { rule: transitioned, revision: revision + 1 });
    this.#replaceLatestHistory(transitioned);
    this.#recordEvent(
      key,
      "rule",
      revision + 1,
      rule.status,
      request.to_status,
      request.actor_id,
      request.reason,
      request.policy_version,
      request.evidence_refs ?? [],
    );
    return { ok: true, value: transitioned };
  }

  async validatePackageIntegrity(
    request: ValidateRulePackageIntegrityRequest,
  ): Promise<RuleRepositoryResult<Readonly<{ matches: boolean; computed_digest: string }>>> {
    const key = ruleKey(request.id, request.version);
    const stored = this.#rules.get(key);
    if (stored === undefined || !isWorkspaceVisible(stored.rule, request.context)) {
      return failure("unknown_package", `No Rule "${key}" to validate.`, false);
    }
    const digest = `sha256:${createHash("sha256").update(stableStringify(stored.rule)).digest("hex")}`;
    if (digest !== request.expected_digest) {
      return failure("invalid_signature", `Rule "${key}" integrity digest does not match the expected digest.`, false);
    }
    return { ok: true, value: { matches: true, computed_digest: digest } };
  }

  async appendLifecycleEvent(event: RuleLifecycleEvent): Promise<RuleRepositoryResult<RuleLifecycleEvent>> {
    this.#events.push(event);
    return { ok: true, value: event };
  }

  /** Test/observability accessor — lifecycle events are otherwise write-only from a caller's perspective. */
  eventsFor(aggregateId: string): readonly RuleLifecycleEvent[] {
    return this.#events.filter((event) => event.aggregate_id === aggregateId);
  }

  #requireOwned(id: string, context: WorkspaceContext): RuleRepositoryResult<StoredRecord> {
    const history = this.#history.get(id) ?? [];
    const latest = history[history.length - 1];
    if (latest === undefined) return failure("not_found", `Rule "${id}" not found.`, false);
    const stored = this.#rules.get(ruleKey(id, latest.version));
    if (stored === undefined || !isWorkspaceVisible(stored.rule, context)) {
      return failure("not_found", `Rule "${id}" not found.`, false);
    }
    return { ok: true, value: stored };
  }

  #appendHistory(rule: Rule): void {
    const list = this.#history.get(rule.id) ?? [];
    list.push(rule);
    this.#history.set(rule.id, list);
  }

  #replaceLatestHistory(rule: Rule): void {
    const list = this.#history.get(rule.id) ?? [];
    if (list.length > 0) list[list.length - 1] = rule;
    else list.push(rule);
    this.#history.set(rule.id, list);
  }

  #recordEvent(
    aggregateId: string,
    aggregateType: "rule" | "rule_set",
    revision: number,
    fromStatus: string | null,
    toStatus: string,
    actorId: string,
    reason: string,
    policyVersion: string,
    evidenceRefs: readonly string[],
  ): void {
    this.#events.push({
      event_id: `event-${this.#events.length + 1}`,
      aggregate_id: aggregateId,
      aggregate_type: aggregateType,
      revision,
      from_status: fromStatus,
      to_status: toStatus,
      actor_id: actorId,
      reason,
      evidence_refs: evidenceRefs,
      policy_version: policyVersion,
      occurred_at: this.#clock.now().toISOString(),
    });
  }
}

function ruleKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function isEffectiveAt(rule: Rule, effectiveAt: string): boolean {
  if (rule.effective_from > effectiveAt) return false;
  if (rule.effective_until !== null && rule.effective_until <= effectiveAt) return false;
  return true;
}

function isWorkspaceVisible(rule: Rule, context: WorkspaceContext): boolean {
  return rule.workspace_scope === "global" || rule.workspace_scope === context.workspace_id;
}

function failure<Value>(code: RuleRepositoryFailureCode, message: string, retryable: boolean): RuleRepositoryResult<Value> {
  return { ok: false, failure: { code, message, retryable } };
}
