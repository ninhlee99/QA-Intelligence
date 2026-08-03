import type {
  SubjectReference,
  SuiteReference,
} from "./evaluation-manager.js";
import type { EvaluationCampaignState } from "./campaign-lifecycle.js";

export interface EvaluationCampaignRepositoryClock {
  now(): Date;
}

export type EvaluationTrialState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "not_executed";

export type EvaluationTrialEffectState = "none" | "known" | "unknown";

export type EvaluationCampaignTrialDefinition = Readonly<{
  case_id: string;
  trial_id: string;
  attempt_id: string;
}>;

export type EvaluationCampaignDefinition = Readonly<{
  subject: SubjectReference;
  suite: SuiteReference;
  resolved_versions: Readonly<Record<string, string>>;
  trials: readonly EvaluationCampaignTrialDefinition[];
}>;

export type CreateEvaluationCampaignRequest = Readonly<{
  workspace_id: string;
  campaign_id: string;
  actor_id: string;
  idempotency_key: string;
  definition: EvaluationCampaignDefinition;
}>;

export type EvaluationCampaignReference = Readonly<{
  workspace_id: string;
  campaign_id: string;
}>;

export type TransitionEvaluationCampaignRequest = EvaluationCampaignReference & Readonly<{
  actor_id: string;
  expected_revision: number;
  idempotency_key: string;
  to_state: EvaluationCampaignState;
  reason: string;
  evidence: readonly string[];
}>;

export type RecordEvaluationTrialBoundaryRequest = EvaluationCampaignReference & Readonly<{
  actor_id: string;
  expected_revision: number;
  idempotency_key: string;
  trial_id: string;
  attempt_id: string;
  to_state: EvaluationTrialState;
  effect_state: EvaluationTrialEffectState;
  cleanup_completed: boolean;
  evidence: readonly string[];
}>;

export type EvaluationCampaignRecoveryChecks = Readonly<{
  resolved_versions_valid: boolean;
  evaluator_healthy: boolean;
  leases_reconciled: boolean;
  isolation_verified: boolean;
  cleanup_verified: boolean;
}>;

export type RecoverEvaluationCampaignRequest = EvaluationCampaignReference & Readonly<{
  actor_id: string;
  expected_revision: number;
  idempotency_key: string;
  checks: EvaluationCampaignRecoveryChecks;
  evidence: readonly string[];
}>;

export type EvaluationCampaignRecovery = Readonly<{
  decision: "resume" | "blocked";
  record: EvaluationCampaignRecord;
  resume_trial_ids: readonly string[];
  blocked_trial_ids: readonly string[];
  blocking_reasons: readonly string[];
}>;

export type EvaluationCampaignTrialSnapshot = EvaluationCampaignTrialDefinition & Readonly<{
  state: EvaluationTrialState;
  effect_state: EvaluationTrialEffectState;
  cleanup_completed: boolean;
}>;

export type EvaluationCampaignSnapshot = Readonly<{
  schema_version: "1.0.0";
  workspace_id: string;
  campaign_id: string;
  definition: EvaluationCampaignDefinition;
  state: EvaluationCampaignState;
  revision: number;
  trials: readonly EvaluationCampaignTrialSnapshot[];
  created_at: string;
  updated_at: string;
}>;

export type EvaluationCampaignEvent = Readonly<{
  sequence: number;
  revision: number;
  kind: "campaign_created" | "campaign_transitioned" | "trial_boundary_recorded" | "campaign_recovered";
  from_state: EvaluationCampaignState | null;
  to_state: EvaluationCampaignState;
  trial_id: string | null;
  attempt_id: string | null;
  trial_from_state: EvaluationTrialState | null;
  trial_to_state: EvaluationTrialState | null;
  actor_id: string;
  evidence: readonly string[];
  occurred_at: string;
}>;

export type EvaluationCampaignRecord = Readonly<{
  snapshot: EvaluationCampaignSnapshot;
  events: readonly EvaluationCampaignEvent[];
}>;

export type EvaluationCampaignRepositoryFailureCode =
  | "invalid_request"
  | "not_found"
  | "workspace_denied"
  | "idempotency_conflict"
  | "stale_revision"
  | "invalid_transition";

export type EvaluationCampaignRepositoryFailure = Readonly<{
  code: EvaluationCampaignRepositoryFailureCode;
  message: string;
  evidence: readonly string[];
}>;

export type EvaluationCampaignRepositoryResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; failure: EvaluationCampaignRepositoryFailure }>;

export type InMemoryEvaluationCampaignRepositoryDependencies = Readonly<{
  clock: EvaluationCampaignRepositoryClock;
}>;

/** Provider-neutral retained-state seam for campaign persistence adapters. */
export interface EvaluationCampaignRepository {
  create(
    request: CreateEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>>;
  load(
    reference: EvaluationCampaignReference,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>>;
  transition(
    request: TransitionEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>>;
  recordTrialBoundary(
    request: RecordEvaluationTrialBoundaryRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>>;
  recover(
    request: RecoverEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecovery>>;
}

/** Development adapter and conformance baseline for retained campaign state. */
export class InMemoryEvaluationCampaignRepository implements EvaluationCampaignRepository {
  readonly #clock: EvaluationCampaignRepositoryClock;
  readonly #records = new Map<string, EvaluationCampaignRecord>();
  readonly #campaignWorkspaces = new Map<string, Set<string>>();
  readonly #createKeys = new Map<
    string,
    Readonly<{ digest: string; record: EvaluationCampaignRecord }>
  >();
  readonly #commandKeys = new Map<
    string,
    Readonly<{ digest: string; record: EvaluationCampaignRecord }>
  >();
  readonly #recoveryKeys = new Map<
    string,
    Readonly<{ digest: string; recovery: EvaluationCampaignRecovery }>
  >();

  constructor(dependencies: InMemoryEvaluationCampaignRepositoryDependencies) {
    this.#clock = dependencies.clock;
  }

  async create(
    request: CreateEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);
    const digest = stableStringify(retainedRequest);
    const idempotencyScope = scopedKey(
      retainedRequest.workspace_id,
      retainedRequest.idempotency_key,
    );
    const retainedKey = this.#createKeys.get(idempotencyScope);
    if (retainedKey !== undefined) {
      if (retainedKey.digest !== digest) {
        return failed(
          "idempotency_conflict",
          "The campaign-create idempotency key is bound to different input.",
        );
      }
      return succeeded(retainedKey.record);
    }

    const invalid = validateCreate(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const recordKey = scopedKey(retainedRequest.workspace_id, retainedRequest.campaign_id);
    if (this.#records.has(recordKey)) {
      return failed("invalid_request", "The campaign identity already exists.");
    }
    const now = this.#clock.now().toISOString();
    const state: EvaluationCampaignState = "draft";
    const record = immutableCopy({
      snapshot: {
        schema_version: "1.0.0" as const,
        workspace_id: retainedRequest.workspace_id,
        campaign_id: retainedRequest.campaign_id,
        definition: retainedRequest.definition,
        state,
        revision: 1,
        trials: retainedRequest.definition.trials.map((trial) => ({
          ...trial,
          state: "pending" as const,
          effect_state: "none" as const,
          cleanup_completed: false,
        })),
        created_at: now,
        updated_at: now,
      },
      events: [
        {
          sequence: 1,
          revision: 1,
          kind: "campaign_created" as const,
          from_state: null,
          to_state: state,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: retainedRequest.actor_id,
          evidence: [],
          occurred_at: now,
        },
      ],
    });
    this.#records.set(recordKey, record);
    const campaignLocations = this.#campaignWorkspaces.get(retainedRequest.campaign_id) ??
      new Set<string>();
    campaignLocations.add(retainedRequest.workspace_id);
    this.#campaignWorkspaces.set(retainedRequest.campaign_id, campaignLocations);
    this.#createKeys.set(idempotencyScope, { digest, record });
    return succeeded(record);
  }

  async load(
    reference: EvaluationCampaignReference,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    return this.#find(reference);
  }

  async transition(
    request: TransitionEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);
    const digest = stableStringify(retainedRequest);
    const idempotencyScope = commandKey(
      "transition",
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      retainedRequest.idempotency_key,
    );
    const retainedCommand = this.#commandKeys.get(idempotencyScope);
    if (retainedCommand !== undefined) {
      return retainedCommand.digest === digest
        ? succeeded(retainedCommand.record)
        : failed(
            "idempotency_conflict",
            "The campaign-transition idempotency key is bound to different input.",
          );
    }
    const invalid = validateTransition(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const available = this.#find(retainedRequest);
    if (!available.ok) return available;
    const current = available.value;
    if (retainedRequest.expected_revision !== current.snapshot.revision) {
      return failed(
        "stale_revision",
        `Expected revision ${retainedRequest.expected_revision}; current revision is ${current.snapshot.revision}.`,
      );
    }
    if (!canTransition(current.snapshot.state, retainedRequest.to_state)) {
      return failed(
        "invalid_transition",
        `Campaign cannot transition from ${current.snapshot.state} to ${retainedRequest.to_state}.`,
      );
    }
    if (retainedRequest.to_state === "ready") {
      const readinessFailures = definitionReadinessFailures(current.snapshot.definition);
      if (readinessFailures.length > 0) {
        return failed(
          "invalid_transition",
          "Campaign definition is not ready for execution.",
          readinessFailures,
        );
      }
    }
    const now = this.#clock.now().toISOString();
    const revision = current.snapshot.revision + 1;
    const updated = immutableCopy({
      snapshot: {
        ...current.snapshot,
        state: retainedRequest.to_state,
        revision,
        updated_at: now,
      },
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          revision,
          kind: "campaign_transitioned" as const,
          from_state: current.snapshot.state,
          to_state: retainedRequest.to_state,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: retainedRequest.actor_id,
          evidence: retainedRequest.evidence,
          occurred_at: now,
        },
      ],
    });
    this.#records.set(
      scopedKey(retainedRequest.workspace_id, retainedRequest.campaign_id),
      updated,
    );
    this.#commandKeys.set(idempotencyScope, { digest, record: updated });
    return succeeded(updated);
  }

  async recordTrialBoundary(
    request: RecordEvaluationTrialBoundaryRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);
    const digest = stableStringify(retainedRequest);
    const idempotencyScope = commandKey(
      "trial-boundary",
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      retainedRequest.idempotency_key,
    );
    const retainedCommand = this.#commandKeys.get(idempotencyScope);
    if (retainedCommand !== undefined) {
      return retainedCommand.digest === digest
        ? succeeded(retainedCommand.record)
        : failed(
            "idempotency_conflict",
            "The trial-boundary idempotency key is bound to different input.",
          );
    }
    const invalid = validateTrialBoundary(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const available = this.#find(retainedRequest);
    if (!available.ok) return available;
    const current = available.value;
    if (retainedRequest.expected_revision !== current.snapshot.revision) {
      return failed(
        "stale_revision",
        `Expected revision ${retainedRequest.expected_revision}; current revision is ${current.snapshot.revision}.`,
      );
    }
    if (current.snapshot.state !== "running") {
      return failed(
        "invalid_transition",
        "Trial boundaries can be recorded only while the campaign is running.",
      );
    }
    const trial = current.snapshot.trials.find(
      (candidate) => candidate.trial_id === retainedRequest.trial_id,
    );
    if (trial === undefined || trial.attempt_id !== retainedRequest.attempt_id) {
      return failed("invalid_request", "The trial and attempt identity are not declared.");
    }
    if (!canTransitionTrial(trial.state, retainedRequest.to_state)) {
      return failed(
        "invalid_transition",
        `Trial cannot transition from ${trial.state} to ${retainedRequest.to_state}.`,
      );
    }
    const now = this.#clock.now().toISOString();
    const revision = current.snapshot.revision + 1;
    const updated = immutableCopy({
      snapshot: {
        ...current.snapshot,
        revision,
        trials: current.snapshot.trials.map((candidate) =>
          candidate.trial_id === retainedRequest.trial_id
            ? {
                ...candidate,
                state: retainedRequest.to_state,
                effect_state: retainedRequest.effect_state,
                cleanup_completed: retainedRequest.cleanup_completed,
              }
            : candidate,
        ),
        updated_at: now,
      },
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          revision,
          kind: "trial_boundary_recorded" as const,
          from_state: current.snapshot.state,
          to_state: current.snapshot.state,
          trial_id: trial.trial_id,
          attempt_id: trial.attempt_id,
          trial_from_state: trial.state,
          trial_to_state: retainedRequest.to_state,
          actor_id: retainedRequest.actor_id,
          evidence: retainedRequest.evidence,
          occurred_at: now,
        },
      ],
    });
    this.#records.set(
      scopedKey(retainedRequest.workspace_id, retainedRequest.campaign_id),
      updated,
    );
    this.#commandKeys.set(idempotencyScope, { digest, record: updated });
    return succeeded(updated);
  }

  async recover(
    request: RecoverEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecovery>> {
    const retainedRequest = immutableCopy(request);
    const digest = stableStringify(retainedRequest);
    const idempotencyScope = commandKey(
      "recover",
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      retainedRequest.idempotency_key,
    );
    const retainedRecovery = this.#recoveryKeys.get(idempotencyScope);
    if (retainedRecovery !== undefined) {
      return retainedRecovery.digest === digest
        ? succeeded(retainedRecovery.recovery)
        : failed(
            "idempotency_conflict",
            "The recovery idempotency key is bound to different input.",
          );
    }
    const invalid = validateRecovery(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);
    const available = this.#find(retainedRequest);
    if (!available.ok) return available;
    const current = available.value;
    if (retainedRequest.expected_revision !== current.snapshot.revision) {
      return failed(
        "stale_revision",
        `Expected revision ${retainedRequest.expected_revision}; current revision is ${current.snapshot.revision}.`,
      );
    }
    if (current.snapshot.state !== "running") {
      return failed(
        "invalid_transition",
        "Recovery can resume work only from a retained running campaign.",
      );
    }
    const blockingReasons = recoveryBlockingReasons(current, retainedRequest.checks);
    const blocked = blockingReasons.length > 0;
    const blockedTrialIds = current.snapshot.trials
      .filter((trial) => trial.state === "running")
      .map((trial) => trial.trial_id);
    const now = this.#clock.now().toISOString();
    const revision = current.snapshot.revision + 1;
    const nextState: EvaluationCampaignState = blocked
      ? "blocked"
      : current.snapshot.state;
    const updated = immutableCopy({
      snapshot: {
        ...current.snapshot,
        state: nextState,
        revision,
        trials: blocked
          ? current.snapshot.trials.map((trial) => ({
              ...trial,
              state: trial.state === "running"
                ? "blocked" as const
                : trial.state === "pending"
                  ? "not_executed" as const
                  : trial.state,
            }))
          : current.snapshot.trials,
        updated_at: now,
      },
      events: [
        ...current.events,
        {
          sequence: current.events.length + 1,
          revision,
          kind: "campaign_recovered" as const,
          from_state: current.snapshot.state,
          to_state: nextState,
          trial_id: null,
          attempt_id: null,
          trial_from_state: null,
          trial_to_state: null,
          actor_id: retainedRequest.actor_id,
          evidence: retainedRequest.evidence,
          occurred_at: now,
        },
      ],
    });
    this.#records.set(
      scopedKey(retainedRequest.workspace_id, retainedRequest.campaign_id),
      updated,
    );
    const recovery = immutableCopy({
      decision: blocked ? "blocked" as const : "resume" as const,
      record: updated,
      resume_trial_ids: blocked
        ? []
        : updated.snapshot.trials
            .filter((trial) => trial.state === "pending")
            .map((trial) => trial.trial_id),
      blocked_trial_ids: blockedTrialIds,
      blocking_reasons: blockingReasons,
    });
    this.#recoveryKeys.set(idempotencyScope, { digest, recovery });
    return succeeded(recovery);
  }

  #find(
    reference: EvaluationCampaignReference,
  ): EvaluationCampaignRepositoryResult<EvaluationCampaignRecord> {
    const record = this.#records.get(scopedKey(reference.workspace_id, reference.campaign_id));
    if (record !== undefined) return succeeded(record);
    const locations = this.#campaignWorkspaces.get(reference.campaign_id);
    return locations !== undefined && locations.size > 0
      ? failed("workspace_denied", "The campaign is outside the active Workspace.")
      : failed("not_found", "The campaign record was not found.");
  }
}

function validateCreate(request: CreateEvaluationCampaignRequest): string | undefined {
  const required = [
    request.workspace_id,
    request.campaign_id,
    request.actor_id,
    request.idempotency_key,
    request.definition.subject.id,
    request.definition.suite.id,
  ];
  if (required.some((value) => value.trim().length === 0)) {
    return "Campaign identity, actor, idempotency key, subject and suite are required.";
  }
  if (request.definition.trials.length === 0) return "At least one trial is required.";
  const trialIds = request.definition.trials.map((trial) => trial.trial_id);
  if (new Set(trialIds).size !== trialIds.length) return "Trial identities must be unique.";
  const attemptIds = request.definition.trials.map((trial) => trial.attempt_id);
  if (new Set(attemptIds).size !== attemptIds.length) return "Attempt identities must be unique.";
  if (
    request.definition.trials.some((trial) =>
      trial.case_id.trim().length === 0 ||
      trial.trial_id.trim().length === 0 ||
      trial.attempt_id.trim().length === 0
    )
  ) return "Case, trial and attempt identities must be non-empty.";
  return undefined;
}

function definitionReadinessFailures(
  definition: EvaluationCampaignDefinition,
): string[] {
  const failures: string[] = [];
  if (!isSemanticVersion(definition.subject.version)) {
    failures.push("unresolved-version:subject");
  }
  if (!isSemanticVersion(definition.suite.version)) {
    failures.push("unresolved-version:suite");
  }
  for (const [key, version] of Object.entries(definition.resolved_versions).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!isExactVersionPin(version)) failures.push(`unresolved-version:${key}`);
  }
  if (Object.keys(definition.resolved_versions).length === 0) {
    failures.push("unresolved-version:configuration");
  }
  return failures;
}

function isSemanticVersion(value: string): boolean {
  return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isExactVersionPin(value: string): boolean {
  return (
    isSemanticVersion(value) ||
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function validateTransition(
  request: TransitionEvaluationCampaignRequest,
): string | undefined {
  if (
    request.actor_id.trim().length === 0 ||
    request.idempotency_key.trim().length === 0 ||
    request.reason.trim().length === 0 ||
    !Number.isInteger(request.expected_revision) ||
    request.expected_revision < 1 ||
    request.evidence.length === 0
  ) {
    return "Transition actor, idempotency key, reason, evidence and positive expected revision are required.";
  }
  return undefined;
}

function validateTrialBoundary(
  request: RecordEvaluationTrialBoundaryRequest,
): string | undefined {
  if (
    request.actor_id.trim().length === 0 ||
    request.idempotency_key.trim().length === 0 ||
    request.trial_id.trim().length === 0 ||
    request.attempt_id.trim().length === 0 ||
    !Number.isInteger(request.expected_revision) ||
    request.expected_revision < 1 ||
    request.evidence.length === 0
  ) {
    return "Trial identity, actor, idempotency key, evidence and positive expected revision are required.";
  }
  return undefined;
}

function validateRecovery(
  request: RecoverEvaluationCampaignRequest,
): string | undefined {
  if (
    request.actor_id.trim().length === 0 ||
    request.idempotency_key.trim().length === 0 ||
    !Number.isInteger(request.expected_revision) ||
    request.expected_revision < 1 ||
    request.evidence.length === 0
  ) {
    return "Recovery actor, idempotency key, evidence and positive expected revision are required.";
  }
  return undefined;
}

function recoveryBlockingReasons(
  record: EvaluationCampaignRecord,
  checks: EvaluationCampaignRecoveryChecks,
): string[] {
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => `recovery-check-failed:${check}`);
  if (record.snapshot.trials.some((trial) => trial.state === "running")) {
    reasons.push("active-trial-requires-reconciliation");
  }
  return reasons;
}

const FORWARD_TRANSITIONS: Readonly<Record<string, readonly EvaluationCampaignState[]>> =
  Object.freeze({
    draft: ["validating"],
    validating: ["ready"],
    ready: ["running"],
    running: ["analyzing"],
    analyzing: ["awaiting_review"],
    awaiting_review: [
      "approved",
      "conditionally_approved",
      "rejected",
      "indeterminate",
    ],
  });

const TERMINAL_STATES = new Set<EvaluationCampaignState>([
  "approved",
  "conditionally_approved",
  "rejected",
  "indeterminate",
  "blocked",
  "cancelled",
  "failed",
]);

function canTransition(
  from: EvaluationCampaignState,
  to: EvaluationCampaignState,
): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  if (to === "blocked" || to === "cancelled" || to === "failed") return true;
  return FORWARD_TRANSITIONS[from]?.includes(to) === true;
}

const TRIAL_TRANSITIONS: Readonly<Record<string, readonly EvaluationTrialState[]>> =
  Object.freeze({
    pending: ["running", "blocked", "cancelled", "not_executed"],
    running: ["completed", "failed", "blocked", "cancelled"],
  });

function canTransitionTrial(
  from: EvaluationTrialState,
  to: EvaluationTrialState,
): boolean {
  return TRIAL_TRANSITIONS[from]?.includes(to) === true;
}

function succeeded<Value>(value: Value): EvaluationCampaignRepositoryResult<Value> {
  return immutableCopy({ ok: true as const, value });
}

function failed(
  code: EvaluationCampaignRepositoryFailureCode,
  message: string,
  evidence: readonly string[] = [],
): EvaluationCampaignRepositoryResult<never> {
  return immutableCopy({
    ok: false as const,
    failure: { code, message, evidence },
  });
}

function scopedKey(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

function commandKey(
  kind: string,
  workspaceId: string,
  campaignId: string,
  idempotencyKey: string,
): string {
  return [kind, workspaceId, campaignId, idempotencyKey].join("\u0000");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function immutableCopy<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableCopy(entry))) as Value;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)]),
      ),
    ) as Value;
  }
  return value;
}
