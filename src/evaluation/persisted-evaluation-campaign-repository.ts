import { createHash } from "node:crypto";

import type {
  EvaluationCampaignRecordStore,
  EvaluationCampaignMutationKind,
  RetainEvaluationCampaignMutationRequest,
} from "./evaluation-campaign-record-store.js";
import type { EvaluationCampaignState } from "./campaign-lifecycle.js";
import type {
  CreateEvaluationCampaignRequest,
  EvaluationCampaignRecord,
  EvaluationCampaignRecoveryChecks,
  EvaluationCampaignRecovery,
  EvaluationCampaignReference,
  EvaluationCampaignRepository,
  EvaluationCampaignRepositoryClock,
  EvaluationCampaignRepositoryFailureCode,
  EvaluationCampaignRepositoryResult,
  EvaluationCampaignTrialSnapshot,
  EvaluationTrialState,
  RecordEvaluationTrialBoundaryRequest,
  RecoverEvaluationCampaignRequest,
  TransitionEvaluationCampaignRequest,
} from "./evaluation-campaign-repository.js";

export type PersistedEvaluationCampaignRepositoryDependencies = Readonly<{
  clock: EvaluationCampaignRepositoryClock;
  /**
   * Resolves the record store that owns a given Workspace's state. A
   * SQLite-backed deployment (ADR-017 §2) opens one file per Workspace, so
   * this is typically a lazily-opened, cached-per-Workspace factory; a
   * shared PostgreSQL deployment can return the same multi-tenant store for
   * every Workspace.
   */
  resolve_store(
    workspace_id: string,
  ): EvaluationCampaignRecordStore | Promise<EvaluationCampaignRecordStore>;
  producer_id: string;
  producer_version: string;
}>;

const MUTATION_EVENT_TYPES: Readonly<Record<EvaluationCampaignMutationKind, string>> =
  Object.freeze({
    create: "evaluation.campaign.created",
    transition: "evaluation.campaign.transitioned",
    trial_boundary: "evaluation.campaign.trial-boundary-recorded",
    recovery: "evaluation.campaign.recovered",
  });

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

const TRIAL_TRANSITIONS: Readonly<Record<string, readonly EvaluationTrialState[]>> =
  Object.freeze({
    pending: ["running", "blocked", "cancelled", "not_executed"],
    running: ["completed", "failed", "blocked", "cancelled"],
  });

/**
 * Backs the same EvaluationCampaignRepository contract as
 * InMemoryEvaluationCampaignRepository, but retains state through the
 * ADR-017 provider-neutral EvaluationCampaignRecordStore seam (SQLite or
 * PostgreSQL) instead of an in-process Map. State-machine and idempotency
 * decisions are computed here; the record store owns atomic retention,
 * optimistic-revision enforcement, and outbox intent.
 */
export class PersistedEvaluationCampaignRepository implements EvaluationCampaignRepository {
  readonly #clock: EvaluationCampaignRepositoryClock;
  readonly #resolveStore: PersistedEvaluationCampaignRepositoryDependencies["resolve_store"];
  readonly #producerId: string;
  readonly #producerVersion: string;
  readonly #stores = new Map<string, EvaluationCampaignRecordStore>();

  constructor(dependencies: PersistedEvaluationCampaignRepositoryDependencies) {
    this.#clock = dependencies.clock;
    this.#resolveStore = dependencies.resolve_store;
    this.#producerId = dependencies.producer_id;
    this.#producerVersion = dependencies.producer_version;
  }

  async #store(workspaceId: string): Promise<EvaluationCampaignRecordStore> {
    const cached = this.#stores.get(workspaceId);
    if (cached !== undefined) return cached;
    const resolved = await this.#resolveStore(workspaceId);
    this.#stores.set(workspaceId, resolved);
    return resolved;
  }

  async create(
    request: CreateEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);

    const priorCommand = await this.#peek(
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      "create",
      retainedRequest.idempotency_key,
      retainedRequest,
    );
    if (priorCommand !== undefined) return priorCommand;

    const invalid = validateCreate(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const now = this.#clock.now().toISOString();
    const state: EvaluationCampaignState = "draft";
    const record: EvaluationCampaignRecord = immutableCopy({
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

    return this.#retain("create", retainedRequest.idempotency_key, retainedRequest, record, null);
  }

  async load(
    reference: EvaluationCampaignReference,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const store = await this.#store(reference.workspace_id);
    const loaded = await store.load(reference);
    return loaded.ok
      ? succeeded(loaded.value)
      : failed(mapStoreFailure(loaded.failure.code), loaded.failure.message);
  }

  async transition(
    request: TransitionEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);

    const priorCommand = await this.#peek(
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      "transition",
      retainedRequest.idempotency_key,
      retainedRequest,
    );
    if (priorCommand !== undefined) return priorCommand;

    const invalid = validateTransition(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const available = await this.load(retainedRequest);
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
    const updated: EvaluationCampaignRecord = immutableCopy({
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

    return this.#retain(
      "transition",
      retainedRequest.idempotency_key,
      retainedRequest,
      updated,
      retainedRequest.expected_revision,
    );
  }

  async recordTrialBoundary(
    request: RecordEvaluationTrialBoundaryRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const retainedRequest = immutableCopy(request);

    const priorCommand = await this.#peek(
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      "trial_boundary",
      retainedRequest.idempotency_key,
      retainedRequest,
    );
    if (priorCommand !== undefined) return priorCommand;

    const invalid = validateTrialBoundary(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const available = await this.load(retainedRequest);
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
    const updated: EvaluationCampaignRecord = immutableCopy({
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

    return this.#retain(
      "trial_boundary",
      retainedRequest.idempotency_key,
      retainedRequest,
      updated,
      retainedRequest.expected_revision,
    );
  }

  async recover(
    request: RecoverEvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecovery>> {
    const retainedRequest = immutableCopy(request);

    const priorCommand = await this.#peek(
      retainedRequest.workspace_id,
      retainedRequest.campaign_id,
      "recovery",
      retainedRequest.idempotency_key,
      retainedRequest,
    );
    if (priorCommand !== undefined) {
      return priorCommand.ok
        ? succeeded(recoveryFromReplayedRecord(priorCommand.value, retainedRequest.checks))
        : priorCommand;
    }

    const invalid = validateRecovery(retainedRequest);
    if (invalid !== undefined) return failed("invalid_request", invalid);

    const available = await this.load(retainedRequest);
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
    const nextState: EvaluationCampaignState = blocked ? "blocked" : current.snapshot.state;
    const updated: EvaluationCampaignRecord = immutableCopy({
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

    const retained = await this.#retain(
      "recovery",
      retainedRequest.idempotency_key,
      retainedRequest,
      updated,
      retainedRequest.expected_revision,
    );
    if (!retained.ok) return retained;

    return succeeded(
      immutableCopy({
        decision: blocked ? ("blocked" as const) : ("resume" as const),
        record: retained.value,
        resume_trial_ids: blocked
          ? []
          : retained.value.snapshot.trials
              .filter((trial) => trial.state === "pending")
              .map((trial) => trial.trial_id),
        blocked_trial_ids: blockedTrialIds,
        blocking_reasons: blockingReasons,
      }),
    );
  }

  /**
   * Consults the record store's durable command history before any
   * revision/state validation is attempted, mirroring how
   * InMemoryEvaluationCampaignRepository checks its own #createKeys /
   * #commandKeys maps first. Without this, a retry of an already-applied
   * command would be evaluated against the post-mutation record (already at
   * a higher revision) and incorrectly rejected as stale instead of being
   * recognized as a replay.
   */
  async #peek(
    workspaceId: string,
    campaignId: string,
    kind: EvaluationCampaignMutationKind,
    idempotencyKey: string,
    requestForDigest: unknown,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord> | undefined> {
    const store = await this.#store(workspaceId);
    const priorCommand = await store.peekCommand({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      kind,
      idempotency_key: idempotencyKey,
    });
    if (priorCommand === undefined) return undefined;
    const digest = this.#digestOf(kind, requestForDigest);
    return priorCommand.request_digest === digest
      ? succeeded(priorCommand.record)
      : failed(
          "idempotency_conflict",
          `The campaign-${kind} idempotency key is bound to different input.`,
        );
  }

  #digestOf(kind: EvaluationCampaignMutationKind, requestForDigest: unknown): string {
    return `sha256:${createHash("sha256")
      .update(stableStringify({ kind, request: requestForDigest }))
      .digest("hex")}`;
  }

  async #retain(
    kind: EvaluationCampaignMutationKind,
    idempotencyKey: string,
    requestForDigest: unknown,
    record: EvaluationCampaignRecord,
    expectedRevision: number | null,
  ): Promise<EvaluationCampaignRepositoryResult<EvaluationCampaignRecord>> {
    const event = record.events.at(-1);
    if (event === undefined) {
      return failed("invalid_request", "A retained campaign record requires at least one event.");
    }
    // The digest must be stable across retries of the same logical command,
    // so it is derived from the caller's request (idempotency-relevant
    // fields only), never from the computed record — the record's
    // timestamps and, for non-create commands, its dependence on
    // previously-loaded state would otherwise make the digest vary between
    // an original call and its retry, breaking idempotent replay.
    const requestDigest = this.#digestOf(kind, requestForDigest);
    const mutationRequest: RetainEvaluationCampaignMutationRequest = {
      record,
      expected_revision: expectedRevision,
      command: {
        kind,
        idempotency_key: idempotencyKey,
        request_digest: requestDigest,
      },
      outbox: {
        event_id: `${record.snapshot.campaign_id}:${event.sequence}`,
        event_type: MUTATION_EVENT_TYPES[kind],
        schema_version: "1.0.0",
        producer_id: this.#producerId,
        producer_version: this.#producerVersion,
        correlation_id: record.snapshot.campaign_id,
        causation_id: idempotencyKey,
        classification: "internal",
      },
    };
    const store = await this.#store(record.snapshot.workspace_id);
    const retained = await store.retainMutation(mutationRequest);
    return retained.ok
      ? succeeded(retained.value)
      : failed(mapStoreFailure(retained.failure.code), retained.failure.message);
  }
}

function mapStoreFailure(
  code:
    | "invalid_request"
    | "not_found"
    | "workspace_denied"
    | "idempotency_conflict"
    | "stale_revision"
    | "persistence_corrupt"
    | "persistence_unavailable",
): EvaluationCampaignRepositoryFailureCode {
  switch (code) {
    case "persistence_corrupt":
    case "persistence_unavailable":
      return "invalid_request";
    default:
      return code;
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
  definition: EvaluationCampaignRecord["snapshot"]["definition"],
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

function validateTransition(request: TransitionEvaluationCampaignRequest): string | undefined {
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

function validateRecovery(request: RecoverEvaluationCampaignRequest): string | undefined {
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
  if (record.snapshot.trials.some((trial: EvaluationCampaignTrialSnapshot) => trial.state === "running")) {
    reasons.push("active-trial-requires-reconciliation");
  }
  return reasons;
}

/**
 * Reconstructs the EvaluationCampaignRecovery decision from a replayed
 * record. The record store only durably retains the record itself (not the
 * full recovery decision shape), so a replayed recovery command must
 * recompute resume/blocked trial ids and the decision from the record's
 * post-recovery state rather than from a separately cached decision.
 */
function recoveryFromReplayedRecord(
  record: EvaluationCampaignRecord,
  checks: EvaluationCampaignRecoveryChecks,
): EvaluationCampaignRecovery {
  const blocked = record.snapshot.state === "blocked";
  const checkFailureReasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => `recovery-check-failed:${check}`);
  const blockedTrialIds = record.snapshot.trials
    .filter((trial) => trial.state === "blocked")
    .map((trial) => trial.trial_id);
  return immutableCopy({
    decision: blocked ? ("blocked" as const) : ("resume" as const),
    record,
    resume_trial_ids: blocked
      ? []
      : record.snapshot.trials
          .filter((trial) => trial.state === "pending")
          .map((trial) => trial.trial_id),
    blocked_trial_ids: blockedTrialIds,
    blocking_reasons: blocked
      ? [
          ...checkFailureReasons,
          ...(blockedTrialIds.length > 0 ? ["active-trial-requires-reconciliation"] : []),
        ]
      : [],
  });
}

function canTransition(
  from: EvaluationCampaignState,
  to: EvaluationCampaignState,
): boolean {
  if (TERMINAL_STATES.has(from)) return false;
  if (to === "blocked" || to === "cancelled" || to === "failed") return true;
  return FORWARD_TRANSITIONS[from]?.includes(to) === true;
}

function canTransitionTrial(from: EvaluationTrialState, to: EvaluationTrialState): boolean {
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
  return immutableCopy({ ok: false as const, failure: { code, message, evidence } });
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
