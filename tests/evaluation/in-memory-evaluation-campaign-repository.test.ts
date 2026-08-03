import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryEvaluationCampaignRepository,
  type CreateEvaluationCampaignRequest,
} from "../../src/evaluation/evaluation-campaign-repository.js";

const NOW = "2026-08-03T14:00:00.000Z";

function createRequest(): CreateEvaluationCampaignRequest {
  return {
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    idempotency_key: "create-campaign-retained-001",
    definition: {
      subject: {
        type: "skill",
        id: "assess-requirement-quality",
        version: "0.1.0",
      },
      suite: { id: "requirement-quality-core", version: "0.1.0" },
      resolved_versions: {
        skill: "assess-requirement-quality@0.1.0",
        suite: "requirement-quality-core@0.1.0",
        adapter: "fixture-evaluation-adapter@1.0.0",
      },
      trials: [
        {
          case_id: "positive-rule-only",
          trial_id: "trial-001",
          attempt_id: "attempt-001",
        },
        {
          case_id: "positive-rule-only",
          trial_id: "trial-002",
          attempt_id: "attempt-002",
        },
      ],
    },
  };
}

test("creates and loads one immutable Workspace-bound campaign record", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const request = createRequest();

  const created = await repository.create(request);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.ok(created.ok);
  assert.equal(created.value.snapshot.state, "draft");
  assert.equal(created.value.snapshot.revision, 1);
  assert.equal(created.value.snapshot.workspace_id, request.workspace_id);
  assert.deepEqual(created.value.snapshot.trials, [
    {
      case_id: "positive-rule-only",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
      state: "pending",
      effect_state: "none",
      cleanup_completed: false,
    },
    {
      case_id: "positive-rule-only",
      trial_id: "trial-002",
      attempt_id: "attempt-002",
      state: "pending",
      effect_state: "none",
      cleanup_completed: false,
    },
  ]);
  assert.deepEqual(created.value.events, [
    {
      sequence: 1,
      revision: 1,
      kind: "campaign_created",
      from_state: null,
      to_state: "draft",
      trial_id: null,
      attempt_id: null,
      trial_from_state: null,
      trial_to_state: null,
      actor_id: "evaluation-runner-001",
      evidence: [],
      occurred_at: NOW,
    },
  ]);
  assert.equal(Object.isFrozen(created.value), true);
  assert.equal(Object.isFrozen(created.value.snapshot.trials), true);

  const retried = await repository.create(request);
  assert.deepEqual(retried, created);

  const loaded = await repository.load({
    workspace_id: request.workspace_id,
    campaign_id: request.campaign_id,
  });
  assert.deepEqual(loaded, created);
});

test("transitions canonically with optimistic revision and idempotent retry", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const created = await repository.create(createRequest());
  assert.ok(created.ok);
  const command = {
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "transition-validating-001",
    to_state: "validating" as const,
    reason: "definition validation started",
    evidence: ["evidence://definition/validation-started"],
  };

  const transitioned = await repository.transition(command);
  assert.equal(transitioned.ok, true, JSON.stringify(transitioned));
  assert.ok(transitioned.ok);
  assert.equal(transitioned.value.snapshot.state, "validating");
  assert.equal(transitioned.value.snapshot.revision, 2);
  assert.deepEqual(transitioned.value.events.at(-1), {
    sequence: 2,
    revision: 2,
    kind: "campaign_transitioned",
    from_state: "draft",
    to_state: "validating",
    trial_id: null,
    attempt_id: null,
    trial_from_state: null,
    trial_to_state: null,
    actor_id: "evaluation-runner-001",
    evidence: ["evidence://definition/validation-started"],
    occurred_at: NOW,
  });

  const retried = await repository.transition(command);
  assert.deepEqual(retried, transitioned);

  const stale = await repository.transition({
    ...command,
    idempotency_key: "transition-ready-stale-001",
    to_state: "ready",
  });
  assert.equal(stale.ok, false);
  assert.ok(!stale.ok);
  assert.equal(stale.failure.code, "stale_revision");
});

test("a delayed create retry returns the original retained operation result", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const request = createRequest();
  const created = await repository.create(request);
  assert.ok(created.ok);
  const transitioned = await repository.transition({
    workspace_id: request.workspace_id,
    campaign_id: request.campaign_id,
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "transition-after-create-001",
    to_state: "validating",
    reason: "definition validation started",
    evidence: ["evidence://definition/validation-started"],
  });
  assert.ok(transitioned.ok);

  const retried = await repository.create(request);
  assert.deepEqual(retried, created);
  assert.ok(retried.ok);
  assert.equal(retried.value.snapshot.state, "draft");
  assert.equal(retried.value.snapshot.revision, 1);
});

test("records an attributable trial boundary without changing campaign state", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await advanceToRunning(repository);

  const recorded = await repository.recordTrialBoundary({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-worker-001",
    expected_revision: 4,
    idempotency_key: "trial-001-running-001",
    trial_id: "trial-001",
    attempt_id: "attempt-001",
    to_state: "running",
    effect_state: "unknown",
    cleanup_completed: false,
    evidence: ["evidence://trial-001/dispatched"],
  });

  assert.equal(recorded.ok, true, JSON.stringify(recorded));
  assert.ok(recorded.ok);
  assert.equal(recorded.value.snapshot.state, "running");
  assert.equal(recorded.value.snapshot.revision, 5);
  assert.deepEqual(recorded.value.snapshot.trials[0], {
    case_id: "positive-rule-only",
    trial_id: "trial-001",
    attempt_id: "attempt-001",
    state: "running",
    effect_state: "unknown",
    cleanup_completed: false,
  });
  assert.deepEqual(recorded.value.events.at(-1), {
    sequence: 5,
    revision: 5,
    kind: "trial_boundary_recorded",
    from_state: "running",
    to_state: "running",
    trial_id: "trial-001",
    attempt_id: "attempt-001",
    trial_from_state: "pending",
    trial_to_state: "running",
    actor_id: "evaluation-worker-001",
    evidence: ["evidence://trial-001/dispatched"],
    occurred_at: NOW,
  });
});

test("recovers only from retained safe trial boundaries", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await advanceToRunning(repository);
  const command = {
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "recovery-controller-001",
    expected_revision: 4,
    idempotency_key: "recover-campaign-001",
    checks: {
      resolved_versions_valid: true,
      evaluator_healthy: true,
      leases_reconciled: true,
      isolation_verified: true,
      cleanup_verified: true,
    },
    evidence: ["evidence://recovery/checks-001"],
  };

  const recovered = await repository.recover(command);

  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.ok(recovered.ok);
  assert.equal(recovered.value.decision, "resume");
  assert.deepEqual(recovered.value.resume_trial_ids, ["trial-001", "trial-002"]);
  assert.deepEqual(recovered.value.blocked_trial_ids, []);
  assert.deepEqual(recovered.value.blocking_reasons, []);
  assert.equal(recovered.value.record.snapshot.state, "running");
  assert.equal(recovered.value.record.snapshot.revision, 5);
  assert.deepEqual(recovered.value.record.events.at(-1), {
    sequence: 5,
    revision: 5,
    kind: "campaign_recovered",
    from_state: "running",
    to_state: "running",
    trial_id: null,
    attempt_id: null,
    trial_from_state: null,
    trial_to_state: null,
    actor_id: "recovery-controller-001",
    evidence: ["evidence://recovery/checks-001"],
    occurred_at: NOW,
  });

  const retried = await repository.recover(command);
  assert.deepEqual(retried, recovered);
});

test("blocks recovery instead of rerunning an active trial with unknown effects", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await advanceToRunning(repository);
  const boundary = await repository.recordTrialBoundary({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-worker-001",
    expected_revision: 4,
    idempotency_key: "trial-001-unknown-effect-001",
    trial_id: "trial-001",
    attempt_id: "attempt-001",
    to_state: "running",
    effect_state: "unknown",
    cleanup_completed: false,
    evidence: ["evidence://trial-001/dispatch-uncertain"],
  });
  assert.ok(boundary.ok);

  const recovered = await repository.recover({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "recovery-controller-001",
    expected_revision: 5,
    idempotency_key: "recover-unknown-effect-001",
    checks: {
      resolved_versions_valid: true,
      evaluator_healthy: true,
      leases_reconciled: true,
      isolation_verified: true,
      cleanup_verified: true,
    },
    evidence: ["evidence://recovery/active-trial-detected"],
  });

  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.ok(recovered.ok);
  assert.equal(recovered.value.decision, "blocked");
  assert.deepEqual(recovered.value.resume_trial_ids, []);
  assert.deepEqual(recovered.value.blocked_trial_ids, ["trial-001"]);
  assert.deepEqual(recovered.value.blocking_reasons, [
    "active-trial-requires-reconciliation",
  ]);
  assert.equal(recovered.value.record.snapshot.state, "blocked");
  assert.equal(recovered.value.record.snapshot.revision, 6);
  assert.deepEqual(
    recovered.value.record.snapshot.trials.map((trial) => [trial.trial_id, trial.state]),
    [
      ["trial-001", "blocked"],
      ["trial-002", "not_executed"],
    ],
  );
  assert.deepEqual(recovered.value.record.events.at(-1), {
    sequence: 6,
    revision: 6,
    kind: "campaign_recovered",
    from_state: "running",
    to_state: "blocked",
    trial_id: null,
    attempt_id: null,
    trial_from_state: null,
    trial_to_state: null,
    actor_id: "recovery-controller-001",
    evidence: ["evidence://recovery/active-trial-detected"],
    occurred_at: NOW,
  });
});

test("the same campaign identity remains isolated across Workspaces", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const first = createRequest();
  const second = {
    ...first,
    workspace_id: "workspace-evaluation-002",
    actor_id: "evaluation-runner-002",
    idempotency_key: "create-campaign-retained-002",
  };

  const firstCreated = await repository.create(first);
  const secondCreated = await repository.create(second);
  assert.ok(firstCreated.ok);
  assert.ok(secondCreated.ok);

  const firstLoaded = await repository.load({
    workspace_id: first.workspace_id,
    campaign_id: first.campaign_id,
  });
  const secondLoaded = await repository.load({
    workspace_id: second.workspace_id,
    campaign_id: second.campaign_id,
  });
  assert.ok(firstLoaded.ok);
  assert.ok(secondLoaded.ok);
  assert.equal(firstLoaded.value.snapshot.workspace_id, first.workspace_id);
  assert.equal(secondLoaded.value.snapshot.workspace_id, second.workspace_id);

  const denied = await repository.load({
    workspace_id: "workspace-evaluation-003",
    campaign_id: first.campaign_id,
  });
  assert.equal(denied.ok, false);
  assert.ok(!denied.ok);
  assert.equal(denied.failure.code, "workspace_denied");
});

test("cannot become ready while any governed version remains unresolved", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  const request = createRequest();
  const created = await repository.create({
    ...request,
    definition: {
      ...request.definition,
      resolved_versions: {
        ...request.definition.resolved_versions,
        adapter: "latest",
      },
    },
  });
  assert.ok(created.ok);
  const validating = await repository.transition({
    workspace_id: request.workspace_id,
    campaign_id: request.campaign_id,
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "transition-validating-unresolved-001",
    to_state: "validating",
    reason: "validate unresolved definition",
    evidence: ["evidence://definition/unresolved"],
  });
  assert.ok(validating.ok);

  const ready = await repository.transition({
    workspace_id: request.workspace_id,
    campaign_id: request.campaign_id,
    actor_id: "evaluation-runner-001",
    expected_revision: 2,
    idempotency_key: "transition-ready-unresolved-001",
    to_state: "ready",
    reason: "attempt readiness",
    evidence: ["evidence://definition/unresolved"],
  });

  assert.equal(ready.ok, false);
  assert.ok(!ready.ok);
  assert.equal(ready.failure.code, "invalid_transition");
  assert.deepEqual(ready.failure.evidence, ["unresolved-version:adapter"]);
  const retained = await repository.load({
    workspace_id: request.workspace_id,
    campaign_id: request.campaign_id,
  });
  assert.ok(retained.ok);
  assert.equal(retained.value.snapshot.state, "validating");
  assert.equal(retained.value.snapshot.revision, 2);
});

test("rejects campaign and trial state changes without attributable evidence", async () => {
  const transitionRepository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await transitionRepository.create(createRequest());

  const transition = await transitionRepository.transition({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "transition-without-evidence-001",
    to_state: "validating",
    reason: "definition validation started",
    evidence: [],
  });
  assert.equal(transition.ok, false);
  assert.ok(!transition.ok);
  assert.equal(transition.failure.code, "invalid_request");

  const boundaryRepository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await advanceToRunning(boundaryRepository);
  const boundary = await boundaryRepository.recordTrialBoundary({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-worker-001",
    expected_revision: 4,
    idempotency_key: "trial-boundary-without-evidence-001",
    trial_id: "trial-001",
    attempt_id: "attempt-001",
    to_state: "running",
    effect_state: "unknown",
    cleanup_completed: false,
    evidence: [],
  });
  assert.equal(boundary.ok, false);
  assert.ok(!boundary.ok);
  assert.equal(boundary.failure.code, "invalid_request");
});

test("binds command idempotency input and never reopens a terminal campaign", async () => {
  const repository = new InMemoryEvaluationCampaignRepository({
    clock: { now: () => new Date(NOW) },
  });
  await repository.create(createRequest());
  const blocked = await repository.transition({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "terminal-command-001",
    to_state: "blocked",
    reason: "blocking invariant observed",
    evidence: ["evidence://campaign/blocking-invariant"],
  });
  assert.ok(blocked.ok);

  const conflictingRetry = await repository.transition({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 1,
    idempotency_key: "terminal-command-001",
    to_state: "cancelled",
    reason: "different command input",
    evidence: ["evidence://campaign/cancelled"],
  });
  assert.equal(conflictingRetry.ok, false);
  assert.ok(!conflictingRetry.ok);
  assert.equal(conflictingRetry.failure.code, "idempotency_conflict");

  const reopened = await repository.transition({
    workspace_id: "workspace-evaluation-001",
    campaign_id: "campaign-retained-001",
    actor_id: "evaluation-runner-001",
    expected_revision: 2,
    idempotency_key: "reopen-terminal-001",
    to_state: "validating",
    reason: "attempt to reopen",
    evidence: ["evidence://campaign/reopen-attempt"],
  });
  assert.equal(reopened.ok, false);
  assert.ok(!reopened.ok);
  assert.equal(reopened.failure.code, "invalid_transition");
});

async function advanceToRunning(
  repository: InMemoryEvaluationCampaignRepository,
): Promise<void> {
  const created = await repository.create(createRequest());
  assert.ok(created.ok);
  let revision = 1;
  for (const state of ["validating", "ready", "running"] as const) {
    const transitioned = await repository.transition({
      workspace_id: "workspace-evaluation-001",
      campaign_id: "campaign-retained-001",
      actor_id: "evaluation-runner-001",
      expected_revision: revision,
      idempotency_key: `transition-${state}-001`,
      to_state: state,
      reason: `transition to ${state}`,
      evidence: [`evidence://campaign/${state}`],
    });
    assert.equal(transitioned.ok, true, JSON.stringify(transitioned));
    revision += 1;
  }
}
