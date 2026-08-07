import type { VersionReference, WorkspaceContext } from "../requirement-review/public.js";

/**
 * SPEC-402 (Rule Repository Component): "stores immutable accepted rule
 * versions, rule sets, authority links, effective periods, tests, and
 * lifecycle history... It does not evaluate rules or approve them" (§1/§2).
 * Mirrors `src/knowledge/public.ts` (SPEC-401)'s command/query port shape —
 * same revision-checked writes, idempotency-key dedupe, lifecycle-event
 * log, and Workspace-visibility filtering — applied to SPEC-104 §4's rule
 * contract instead of a Knowledge Object. `resolveApplicableRuleSet`
 * returns candidates for a caller to rank through
 * `resolveRulePrecedence` (`src/shared/rule-precedence.ts`, SPEC-104 §9);
 * this repository never ranks or decides, per §2.
 */
export type RuleStatus = "draft" | "in_review" | "accepted" | "deprecated" | "superseded" | "archived";

/** SPEC-104 §4's rule contract. `applies_when`/`decision` are stored expressions, never executed here (§16). */
export type Rule = Readonly<{
  id: string;
  version: string;
  status: RuleStatus;
  title: string;
  authority: readonly string[];
  owner: string;
  workspace_scope: "global" | string;
  applies_when: string;
  inputs: readonly string[];
  decision: string;
  outputs: readonly string[];
  priority: number;
  effective_from: string;
  effective_until: string | null;
  explanation_template: string;
  tests: readonly string[];
}>;

/** SPEC-104 §11: a rule set groups exact rule versions with ordering/conflict strategy and its own effective period. */
export type RuleSet = Readonly<{
  id: string;
  version: string;
  scope: "global" | string;
  included_rule_refs: readonly string[];
  ordering_and_conflict_strategy: string;
  compatibility: readonly VersionReference[];
  effective_from: string;
  effective_until: string | null;
  owner: string;
  approved_by: readonly string[];
}>;

export type RuleLifecycleEvent = Readonly<{
  event_id: string;
  aggregate_id: string;
  aggregate_type: "rule" | "rule_set";
  revision: number;
  from_status: string | null;
  to_status: string;
  actor_id: string;
  reason: string;
  evidence_refs: readonly string[];
  policy_version: string;
  occurred_at: string;
}>;

export type RuleRepositoryFailureCode =
  | "unknown_package"
  | "incompatible_version"
  | "invalid_signature"
  | "conflicting_effective_range"
  | "unauthorized_override"
  | "storage_failure"
  | "stale_cache"
  | "conflict"
  | "not_found"
  | "validation_failure"
  | "unsupported_transition";

export type RuleRepositoryFailure = Readonly<{
  code: RuleRepositoryFailureCode;
  message: string;
  retryable: boolean;
}>;

export type RuleRepositoryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: RuleRepositoryFailure }>;

export type SaveDraftRuleRequest = Readonly<{
  context: WorkspaceContext;
  draft: Omit<Rule, "status">;
  idempotency_key: string;
}>;

export type ResolveApplicableRuleSetRequest = Readonly<{
  context: WorkspaceContext;
  rule_set_id: string;
  effective_at: string;
}>;

export type RecordRuleLifecycleTransitionRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  expected_revision: number;
  to_status: RuleStatus;
  actor_id: string;
  reason: string;
  policy_version: string;
  evidence_refs?: readonly string[];
}>;

export type ValidateRulePackageIntegrityRequest = Readonly<{
  context: WorkspaceContext;
  id: string;
  version: string;
  expected_digest: string;
}>;

/** SPEC-402 §3's 6 core operations. Writes carry `WorkspaceContext` + `expected_revision`, matching `KnowledgeRepository`'s convention. */
export interface RuleRepository {
  saveDraft(request: SaveDraftRuleRequest): Promise<RuleRepositoryResult<Rule>>;
  getExactVersion(context: WorkspaceContext, id: string, version: string): Promise<RuleRepositoryResult<Rule>>;
  /** Returns every effective, Workspace-applicable candidate rule for the caller to rank — this repository does not evaluate or select a winner (§2). */
  resolveApplicableRuleSet(request: ResolveApplicableRuleSetRequest): Promise<RuleRepositoryResult<readonly Rule[]>>;
  listHistory(context: WorkspaceContext, id: string): Promise<RuleRepositoryResult<readonly Rule[]>>;
  recordLifecycleTransition(request: RecordRuleLifecycleTransitionRequest): Promise<RuleRepositoryResult<Rule>>;
  validatePackageIntegrity(request: ValidateRulePackageIntegrityRequest): Promise<RuleRepositoryResult<Readonly<{ matches: boolean; computed_digest: string }>>>;
  appendLifecycleEvent(event: RuleLifecycleEvent): Promise<RuleRepositoryResult<RuleLifecycleEvent>>;
}
