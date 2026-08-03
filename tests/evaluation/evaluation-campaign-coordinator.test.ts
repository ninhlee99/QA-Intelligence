import assert from "node:assert/strict";
import test from "node:test";

import {
  EvaluationCampaignCoordinator,
  type MultiTrialEvaluationCampaignRequest,
  type EvaluationTrialRunner,
} from "../../src/evaluation/evaluation-campaign-coordinator.js";
import type {
  EvaluationCampaignRequest,
  EvaluationCampaignRunResult,
  EvaluationTrialPlan,
} from "../../src/evaluation/evaluation-campaign-runner.js";
import type { EvaluationAdapterResult } from "../../src/evaluation/adapter.js";
import {
  EvaluationManager,
  StaticEvaluationSuitePolicyRegistry,
} from "../../src/evaluation/evaluation-manager.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

const NOW = "2026-08-03T13:00:00.000Z";

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-evaluation-001",
    actor_id: "evaluation-runner-001",
    actor_type: "service",
    roles: ["evaluation-runner"],
    permissions: ["evaluation:read", "evaluation:execute", "evaluation:cleanup"],
    policy_version: "evaluation-policy-1.0.0",
    request_id: "request-campaign-multi-001",
    correlation_id: "campaign-multi-001",
    audience: ["qa-intelligence-evaluation"],
    environment: "test",
    issued_at: "2026-08-03T12:00:00.000Z",
    expires_at: "2026-08-03T14:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "fixture-proof",
  };
}

function trial(trialId: string, attemptId: string): EvaluationTrialPlan {
  return {
    identity: {
      campaign_id: "campaign-multi-001",
      case_id: "positive-rule-only",
      trial_id: trialId,
      attempt_id: attemptId,
    },
    prepare: {
      subject_ref: "skill://assess-requirement-quality@0.1.0",
      fixture_refs: ["fixture://positive-rule-only@0.1.0"],
      dataset_ref: "dataset://requirement-quality-core@0.1.0",
      policy_ref: "evaluation-policy@1.0.0",
      network_policy_ref: "network-policy://offline@1.0.0",
      tool_policy_ref: "tool-policy://requirement-review@1.0.0",
      credential_refs: [],
      isolation_requirements: { strength: "process" },
      budget: { max_seconds: 30 },
      evidence_requirements: ["assertion-observations", "cleanup"],
    },
    execute: {
      execution_plan_ref: "plan://positive-rule-only@0.1.0",
      authorized_input_refs: ["requirement://REQ-001@1.0.0"],
    },
    evidence_manifest_ref: `manifest://${trialId}@1.0.0`,
    cleanup: {
      resource_refs: [`sandbox://${trialId}`],
      cleanup_policy_ref: "cleanup-policy@1.0.0",
    },
    assertions: [
      { id: "contract-valid", critical: true },
      { id: "no-provider", critical: true },
    ],
  };
}

function request(): MultiTrialEvaluationCampaignRequest {
  return {
    run_id: "campaign-multi-001",
    workspace: context(),
    subject: { type: "skill", id: "assess-requirement-quality", version: "0.1.0" },
    suite: { id: "requirement-quality-core", version: "0.1.0" },
    resolved_versions: {
      skill: "assess-requirement-quality@0.1.0",
      suite: "requirement-quality-core@0.1.0",
      adapter: "fixture-evaluation-adapter@1.0.0",
    },
    deadline: { at: "2026-08-03T13:05:00.000Z", time_standard: "UTC" },
    trials: [trial("trial-001", "attempt-001"), trial("trial-002", "attempt-002")],
    max_parallel_trials: 2,
  };
}

function manager(): EvaluationManager {
  return new EvaluationManager(
    { now: () => new Date(NOW) },
    new StaticEvaluationSuitePolicyRegistry([
      {
        suite: { id: "requirement-quality-core", version: "0.1.0" },
        required_case_ids: ["positive-rule-only"],
        critical_invariant_ids: ["contract-valid", "no-provider"],
        minimum_trials_per_case: 2,
      },
    ]),
    { verify: () => true },
  );
}

class PassingTrialRunner implements EvaluationTrialRunner {
  active = 0;
  maxActive = 0;
  calls = 0;
  readonly returnedTrialIds: Record<string, string> = {};
  readonly failedTrialIds = new Set<string>();
  readonly omitEnvironmentVersionTrialIds = new Set<string>();
  readonly incompleteCleanupTrialIds = new Set<string>();

  constructor(
    private readonly environmentVersions: Readonly<Record<string, string>> = {},
  ) {}

  async run(input: EvaluationCampaignRequest): Promise<EvaluationCampaignRunResult> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await Promise.resolve();
    const subjectFailed = this.failedTrialIds.has(input.trial.identity.trial_id);
    const evaluation = manager().evaluate({
      run_id: input.run_id,
      workspace_id: input.workspace.workspace_id,
      subject: input.subject,
      suite: input.suite,
      resolved_versions: this.omitEnvironmentVersionTrialIds.has(
        input.trial.identity.trial_id,
      )
        ? input.resolved_versions
        : {
            ...input.resolved_versions,
            environment:
              this.environmentVersions[input.trial.identity.trial_id] ??
              "local-evaluation@1.0.0",
          },
      trial_results: [
        {
          case_id: input.trial.identity.case_id,
          trial_id:
            this.returnedTrialIds[input.trial.identity.trial_id] ??
            input.trial.identity.trial_id,
          outcome: subjectFailed ? "failed" : "passed",
          failure_class: subjectFailed ? "subject" : "none",
          evidence: [`evidence://${input.trial.identity.trial_id}`],
        },
      ],
      critical_invariants: [
        { id: "contract-valid", passed: !subjectFailed },
        { id: "no-provider", passed: true },
      ],
    });
    this.active -= 1;
    return {
      evaluation,
      operations: [],
      cleanup_completed: !this.incompleteCleanupTrialIds.has(
        input.trial.identity.trial_id,
      ),
    };
  }
}

class CancellingTrialRunner extends PassingTrialRunner {
  constructor(private readonly cancelledTrialId = "trial-002") {
    super();
  }

  override async run(
    input: EvaluationCampaignRequest,
  ): Promise<EvaluationCampaignRunResult> {
    const result = await super.run(input);
    return input.trial.identity.trial_id === this.cancelledTrialId
      ? { ...result, operations: [cancelledOperation(input)] }
      : result;
  }
}

function cancelledOperation(
  input: EvaluationCampaignRequest,
): EvaluationAdapterResult<"executeTrial"> {
  return {
    operation: "executeTrial",
    operationId: `${input.trial.identity.attempt_id}:executeTrial`,
    trial: input.trial.identity,
    workspace: input.workspace,
    idempotency: {
      key: `${input.trial.identity.attempt_id}:executeTrial`,
      scope: `${input.workspace.workspace_id}:${input.run_id}`,
      request_digest: "sha256:cancelled-fixture",
    },
    deadline: input.deadline,
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    provider: { id: "fixture-evaluation-adapter", version: "1.0.0" },
    timing: { started_at: NOW, completed_at: NOW, duration_ms: 0 },
    usage: {},
    warnings: [],
    evidence: ["evidence://trial-002/cancelled"],
    ok: false,
    failure: {
      code: "cancelled",
      retryable: false,
      responsible_domain: "adapter",
      message: "trial cancelled by fixture",
      details: {},
      diagnostic_evidence_refs: ["evidence://trial-002/cancelled"],
      provider_details: {},
    },
  };
}

test("runs a bounded parallel trial matrix and analyzes it once in declared order", async () => {
  const runner = new PassingTrialRunner();
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.equal(runner.maxActive, 2);
  assert.deepEqual(
    result.trial_runs.map((run) => run.evaluation.trial_results[0]?.trial_id),
    ["trial-001", "trial-002"],
  );
  assert.equal(result.evaluation.verdict, "passed");
  assert.equal(result.evaluation.recommendation, "recommend_release");
  assert.deepEqual(result.evaluation.metrics, {
    total_trials: 2,
    passed_trials: 2,
    failed_trials: 0,
    blocked_trials: 0,
    indeterminate_trials: 0,
    critical_invariants_total: 2,
    critical_invariants_passed: 2,
    evidence_reference_count: 2,
    invalid_test_reasons: [],
  });
  assert.equal(result.state, "awaiting_review");
  assert.deepEqual(result.state_history, [
    "draft",
    "validating",
    "ready",
    "running",
    "analyzing",
    "awaiting_review",
  ]);
  assert.deepEqual(result.configuration_failures, []);
  assert.deepEqual(result.analysis_failures, []);
});

test("rejects a duplicate trial matrix before dispatching any trial", async () => {
  const runner = new PassingTrialRunner();
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });
  const valid = request();

  const result = await coordinator.run({
    ...valid,
    trials: [
      valid.trials[0]!,
      {
        ...valid.trials[1]!,
        identity: {
          ...valid.trials[1]!.identity,
          trial_id: valid.trials[0]!.identity.trial_id,
        },
      },
    ],
  });

  assert.equal(runner.calls, 0);
  assert.equal(result.state, "failed");
  assert.deepEqual(result.state_history, ["draft", "validating", "failed"]);
  assert.deepEqual(result.configuration_failures, ["duplicate-trial-id"]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
});

test("keeps version-divergent trials but makes the campaign indeterminate", async () => {
  const runner = new PassingTrialRunner({
    "trial-001": "local-evaluation@1.0.0",
    "trial-002": "local-evaluation@2.0.0",
  });
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.equal(runner.calls, 2);
  assert.equal(result.trial_runs.length, 2);
  assert.equal(result.state, "awaiting_review");
  assert.deepEqual(result.analysis_failures, ["resolved-version-conflict:environment"]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.ok(result.evaluation.metrics.invalid_test_reasons.includes("unresolved-version"));
});

test("a trial runner cannot substitute facts from a different trial", async () => {
  const runner = new PassingTrialRunner();
  runner.returnedTrialIds["trial-002"] = "trial-substituted";
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.equal(runner.calls, 2);
  assert.deepEqual(result.analysis_failures, [
    "trial-run-identity-mismatch:trial-002",
  ]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.ok(result.evaluation.metrics.invalid_test_reasons.includes("unresolved-version"));
});

test("a dependency version missing from one trial invalidates reproducibility", async () => {
  const runner = new PassingTrialRunner();
  runner.omitEnvironmentVersionTrialIds.add("trial-002");
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.deepEqual(result.analysis_failures, [
    "resolved-version-missing:environment",
  ]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
});

test("a trial cannot claim pass while reporting incomplete cleanup", async () => {
  const runner = new PassingTrialRunner();
  runner.incompleteCleanupTrialIds.add("trial-002");
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.deepEqual(result.analysis_failures, [
    "trial-run-cleanup-inconsistent:trial-002",
  ]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
});

test("respects a sequential campaign concurrency bound", async () => {
  const runner = new PassingTrialRunner();
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run({ ...request(), max_parallel_trials: 1 });

  assert.equal(runner.maxActive, 1);
  assert.equal(result.evaluation.verdict, "passed");
});

test("one critical trial failure dominates the multi-trial campaign", async () => {
  const runner = new PassingTrialRunner();
  runner.failedTrialIds.add("trial-002");
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.equal(result.evaluation.verdict, "failed");
  assert.equal(result.evaluation.recommendation, "reject_release");
  assert.deepEqual(result.evaluation.critical_invariants[0], {
    id: "contract-valid",
    passed: false,
  });
  assert.equal(result.state, "awaiting_review");
});

test("cancellation is terminal and never becomes an awaiting-review recommendation", async () => {
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: new CancellingTrialRunner(),
    manager: manager(),
  });

  const result = await coordinator.run(request());

  assert.equal(result.state, "cancelled");
  assert.deepEqual(result.state_history, [
    "draft",
    "validating",
    "ready",
    "running",
    "cancelled",
  ]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
});

test("observed cancellation prevents dispatching new sequential trials", async () => {
  const runner = new CancellingTrialRunner("trial-001");
  const coordinator = new EvaluationCampaignCoordinator({
    trial_runner: runner,
    manager: manager(),
  });

  const result = await coordinator.run({ ...request(), max_parallel_trials: 1 });

  assert.equal(runner.calls, 1);
  assert.equal(result.trial_runs.length, 1);
  assert.equal(result.state, "cancelled");
  assert.equal(result.evaluation.verdict, "indeterminate");
});
