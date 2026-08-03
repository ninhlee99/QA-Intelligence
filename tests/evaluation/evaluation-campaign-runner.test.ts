import assert from "node:assert/strict";
import test from "node:test";

import type {
  EvaluationAdapter,
  EvaluationAdapterOperation,
  EvaluationAdapterOperationMap,
  EvaluationAdapterRequest,
  EvaluationAdapterResult,
  EvaluationAdapterFailure,
} from "../../src/evaluation/adapter.js";
import {
  EvaluationCampaignRunner,
  type EvaluationCampaignRequest,
} from "../../src/evaluation/evaluation-campaign-runner.js";
import {
  EvaluationManager,
  StaticEvaluationSuitePolicyRegistry,
} from "../../src/evaluation/evaluation-manager.js";
import type { JsonObject, WorkspaceContext } from "../../src/requirement-review/public.js";

const NOW = "2026-08-03T12:00:00.000Z";

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-evaluation-001",
    actor_id: "evaluation-runner-001",
    actor_type: "service",
    roles: ["evaluation-runner"],
    permissions: [
      "evaluation:read",
      "evaluation:execute",
      "evaluation:cleanup",
    ],
    policy_version: "evaluation-policy-1.0.0",
    request_id: "request-campaign-001",
    correlation_id: "campaign-001",
    audience: ["qa-intelligence-evaluation"],
    environment: "test",
    issued_at: "2026-08-03T11:00:00.000Z",
    expires_at: "2026-08-03T13:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "fixture-proof",
  };
}

function request(): EvaluationCampaignRequest {
  return {
    run_id: "campaign-001",
    workspace: context(),
    subject: { type: "skill", id: "assess-requirement-quality", version: "0.1.0" },
    suite: { id: "requirement-quality-core", version: "0.1.0" },
    resolved_versions: {
      skill: "assess-requirement-quality@0.1.0",
      suite: "requirement-quality-core@0.1.0",
      adapter: "fixture-evaluation-adapter@1.0.0",
    },
    deadline: { at: "2026-08-03T12:05:00.000Z", time_standard: "UTC" },
    trial: {
      identity: {
        campaign_id: "campaign-001",
        case_id: "positive-rule-only",
        trial_id: "trial-001",
        attempt_id: "attempt-001",
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
      evidence_manifest_ref: "manifest://trial-001@1.0.0",
      cleanup: {
        resource_refs: ["sandbox://trial-001"],
        cleanup_policy_ref: "cleanup-policy@1.0.0",
      },
      assertions: [
        { id: "contract-valid", critical: true },
        { id: "no-provider", critical: true },
      ],
    },
  };
}

function success<Operation extends EvaluationAdapterOperation>(
  requestValue: EvaluationAdapterRequest<Operation>,
  value: EvaluationAdapterOperationMap[Operation]["value"],
): EvaluationAdapterResult<Operation> {
  return {
    ...requestValue,
    provider: { id: "fixture-evaluation-adapter", version: "1.0.0" },
    timing: { started_at: NOW, completed_at: NOW, duration_ms: 0 },
    usage: {},
    warnings: [],
    evidence: [`evidence://${requestValue.operation}`],
    ok: true,
    value,
  };
}

function failed<Operation extends EvaluationAdapterOperation>(
  requestValue: EvaluationAdapterRequest<Operation>,
  failure: EvaluationAdapterFailure,
): EvaluationAdapterResult<Operation> {
  return {
    ...requestValue,
    provider: { id: "fixture-evaluation-adapter", version: "1.0.0" },
    timing: { started_at: NOW, completed_at: NOW, duration_ms: 0 },
    usage: {},
    warnings: [],
    evidence: [`evidence://${requestValue.operation}/failure`],
    ok: false,
    failure,
  };
}

type AdapterBehavior = Readonly<{
  observations?: readonly JsonObject[];
  execute_failure?: EvaluationAdapterFailure;
  cleanup_failure?: EvaluationAdapterFailure;
  cleanup_residual?: boolean;
  descriptor_workspace_id?: string;
  environment_versions?: Readonly<Record<string, string>>;
}>;

function adapterFailure(
  code: EvaluationAdapterFailure["code"],
  responsibleDomain: EvaluationAdapterFailure["responsible_domain"],
): EvaluationAdapterFailure {
  return {
    code,
    retryable: false,
    responsible_domain: responsibleDomain,
    message: `${code} fixture`,
    details: {},
    diagnostic_evidence_refs: [`evidence://diagnostic/${code}`],
    provider_details: {},
  };
}

function happyAdapter(
  calls: EvaluationAdapterOperation[],
  behavior: AdapterBehavior = {},
): EvaluationAdapter {
  return {
    async descriptor(operation) {
      calls.push(operation.operation);
      const result = success(operation, {
        supported_contract_versions: ["1.0.0"],
        supported_operations: [
          "descriptor",
          "prepareEnvironment",
          "executeTrial",
          "collectEvidence",
          "cleanup",
        ],
        isolation_strength: "process",
        deterministic: true,
        replay_fidelity: "exact",
        limits: { max_parallel_trials: 1 },
        data_residency: ["local-test"],
        evidence_guarantees: ["append-only", "sha256"],
        cancellation_guarantee: "bounded",
        cleanup_guarantee: "bounded-idempotent",
        health: "healthy",
        capacity: { available_slots: 1 },
      });
      return behavior.descriptor_workspace_id === undefined
        ? result
        : {
            ...result,
            workspace: {
              ...result.workspace,
              workspace_id: behavior.descriptor_workspace_id,
            },
          };
    },
    async prepareEnvironment(operation) {
      calls.push(operation.operation);
      return success(operation, {
        environment_lease: "lease://trial-001",
        resolved_versions: behavior.environment_versions ?? {
          environment: "local-evaluation@1.0.0",
        },
        effective_limits: { max_seconds: 30 },
        isolation_evidence: ["evidence://isolation/trial-001"],
        expires_at: "2026-08-03T12:05:00.000Z",
        cleanup_required: true,
      });
    },
    async executeTrial(operation) {
      calls.push(operation.operation);
      if (behavior.execute_failure !== undefined) {
        return failed(operation, behavior.execute_failure);
      }
      return success(operation, {
        observations: behavior.observations ?? [
          {
            assertion_id: "contract-valid",
            observed: true,
            evidence_ref: "evidence://trial-001/contract-valid",
          },
          {
            assertion_id: "no-provider",
            observed: true,
            evidence_ref: "evidence://trial-001/no-provider",
          },
        ],
        subject_output_refs: ["assessment://assessment-001"],
        tool_events: [],
        policy_events: [],
        resource_usage: { compute_ms: 10 },
        trial_timings: { duration_ms: 10 },
        termination_observation: { reason: "completed" },
        raw_evidence_refs: [
          "evidence://trial-001/contract-valid",
          "evidence://trial-001/no-provider",
        ],
      });
    },
    async collectEvidence(operation) {
      calls.push(operation.operation);
      return success(operation, {
        manifest_ref: "manifest://trial-001@1.0.0",
        entries: [
          { evidence_ref: "evidence://trial-001/contract-valid" },
          { evidence_ref: "evidence://trial-001/no-provider" },
        ],
        completeness_observations: ["required evidence present"],
        reproducibility_limitations: [],
      });
    },
    async cleanup(operation) {
      calls.push(operation.operation);
      if (behavior.cleanup_failure !== undefined) {
        return failed(operation, behavior.cleanup_failure);
      }
      return success(operation, {
        resource_outcomes: [{ resource_ref: "sandbox://trial-001", revoked: true }],
        residual_resources: behavior.cleanup_residual === true
          ? ["sandbox://trial-001"]
          : [],
        completion_status: "completed",
        residual_risk: behavior.cleanup_residual === true
          ? ["sandbox remains active"]
          : [],
      });
    },
    async evaluateRubric() {
      throw new Error("rubric is not part of this deterministic campaign");
    },
    async replay() {
      throw new Error("replay is not part of this deterministic campaign");
    },
  };
}

test("orchestrates one isolated trial and leaves the verdict to Evaluation Manager", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const manager = new EvaluationManager(
    { now: () => new Date(NOW) },
    new StaticEvaluationSuitePolicyRegistry([
      {
        suite: { id: "requirement-quality-core", version: "0.1.0" },
        required_case_ids: ["positive-rule-only"],
        critical_invariant_ids: ["contract-valid", "no-provider"],
        minimum_trials_per_case: 1,
      },
    ]),
    { verify: () => true },
  );
  const runner = new EvaluationCampaignRunner({
    adapter: happyAdapter(calls),
    manager,
    evidence_verifier: { verify: () => true },
  });

  const result = await runner.run(request());

  assert.deepEqual(calls, [
    "descriptor",
    "prepareEnvironment",
    "executeTrial",
    "collectEvidence",
    "cleanup",
  ]);
  assert.equal(result.evaluation.verdict, "passed");
  assert.equal(result.evaluation.recommendation, "recommend_release");
  assert.deepEqual(result.evaluation.critical_invariants, [
    { id: "contract-valid", passed: true },
    { id: "no-provider", passed: true },
  ]);
  assert.equal(result.cleanup_completed, true);
  assert.equal(result.operations.length, 5);
  assert.equal(Object.isFrozen(result.operations[0]), true);
  assert.equal(Object.isFrozen(result.evaluation), true);
  assert.equal(
    result.operations.some((operation) => "verdict" in operation),
    false,
  );
  assert.equal(result.evaluation.resolved_versions.environment, "local-evaluation@1.0.0");
});

test("a critical negative observation rejects release as a subject failure", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, {
      observations: [
        {
          assertion_id: "contract-valid",
          observed: false,
          evidence_ref: "evidence://trial-001/contract-valid",
        },
        {
          assertion_id: "no-provider",
          observed: true,
          evidence_ref: "evidence://trial-001/no-provider",
        },
      ],
    }),
  );

  const result = await runner.run(request());

  assert.equal(result.evaluation.verdict, "failed");
  assert.equal(result.evaluation.recommendation, "reject_release");
  assert.equal(result.evaluation.trial_results[0]?.failure_class, "subject");
  assert.deepEqual(result.evaluation.critical_invariants[0], {
    id: "contract-valid",
    passed: false,
  });
  assert.equal(result.cleanup_completed, true);
});

test("unverified collected evidence is invalid-test evidence and cannot release", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(happyAdapter(calls), false);

  const result = await runner.run(request());

  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.equal(result.evaluation.trial_results[0]?.failure_class, "invalid_test");
  assert.ok(
    result.evaluation.evidence.includes("evaluation:evidence-integrity-failure"),
  );
  assert.equal(result.cleanup_completed, true);
});

test("an execution provider failure remains infrastructure evidence and still cleans up", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, {
      execute_failure: adapterFailure("provider_failure", "provider"),
    }),
  );

  const result = await runner.run(request());

  assert.deepEqual(calls, [
    "descriptor",
    "prepareEnvironment",
    "executeTrial",
    "collectEvidence",
    "cleanup",
  ]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.trial_results[0]?.failure_class, "infrastructure");
  assert.ok(result.evaluation.evidence.includes("evidence://diagnostic/provider_failure"));
  assert.ok(result.evaluation.evidence.includes("evidence://collectEvidence"));
  assert.ok(result.evaluation.evidence.includes("evidence://cleanup"));
  assert.equal(result.cleanup_completed, true);
});

test("cleanup failure overrides favorable observations and remains explicitly retained", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, {
      cleanup_failure: adapterFailure("cleanup_incomplete", "cleanup"),
    }),
  );

  const result = await runner.run(request());

  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.equal(result.evaluation.trial_results[0]?.failure_class, "infrastructure");
  assert.equal(result.cleanup_completed, false);
  assert.ok(result.evaluation.evidence.includes("manifest://trial-001@1.0.0"));
  assert.ok(result.evaluation.evidence.includes("evidence://trial-001/contract-valid"));
  const cleanup = result.operations.at(-1);
  assert.equal(cleanup?.operation, "cleanup");
  assert.equal(cleanup?.ok, false);
  assert.ok(cleanup !== undefined && !cleanup.ok);
  assert.equal(cleanup.failure.code, "cleanup_incomplete");
});

test("cleanup failure cannot erase an independently observed subject failure", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, {
      observations: [
        {
          assertion_id: "contract-valid",
          observed: false,
          evidence_ref: "evidence://trial-001/contract-valid",
        },
        {
          assertion_id: "no-provider",
          observed: true,
          evidence_ref: "evidence://trial-001/no-provider",
        },
      ],
      cleanup_failure: adapterFailure("cleanup_incomplete", "cleanup"),
    }),
  );

  const result = await runner.run(request());

  assert.equal(result.evaluation.verdict, "failed");
  assert.equal(result.evaluation.trial_results[0]?.failure_class, "subject");
  assert.deepEqual(result.evaluation.critical_invariants[0], {
    id: "contract-valid",
    passed: false,
  });
  assert.ok(result.evaluation.evidence.includes("evidence://diagnostic/cleanup_incomplete"));
  assert.equal(result.cleanup_completed, false);
});

test("a nominal cleanup response with residual resources cannot release", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(happyAdapter(calls, { cleanup_residual: true }));

  const result = await runner.run(request());

  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.ok(result.evaluation.evidence.includes("evaluation:cleanup-residual-resources"));
  assert.equal(result.cleanup_completed, false);
});

test("rejects mismatched campaign identity before any Adapter side effect", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(happyAdapter(calls));
  const valid = request();

  const result = await runner.run({
    ...valid,
    trial: {
      ...valid.trial,
      identity: { ...valid.trial.identity, campaign_id: "different-campaign" },
    },
  });

  assert.deepEqual(calls, []);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.equal(result.evaluation.recommendation, "indeterminate");
  assert.ok(result.evaluation.evidence.includes("evaluation:campaign-identity-mismatch"));
  assert.equal(result.operations.length, 0);
  assert.equal(result.cleanup_completed, false);
});

test("rejects an Adapter response that echoes a different Workspace", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, { descriptor_workspace_id: "workspace-other" }),
  );

  const result = await runner.run(request());

  assert.deepEqual(calls, ["descriptor"]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.ok(result.evaluation.evidence.includes("evaluation:descriptor-envelope-mismatch"));
  assert.equal(result.operations.length, 1);
});

test("rejects a conflicting environment version and cleans its lease before stopping", async () => {
  const calls: EvaluationAdapterOperation[] = [];
  const runner = campaignRunner(
    happyAdapter(calls, {
      environment_versions: {
        adapter: "different-adapter@2.0.0",
        environment: "local-evaluation@1.0.0",
      },
    }),
  );

  const result = await runner.run(request());

  assert.deepEqual(calls, ["descriptor", "prepareEnvironment", "cleanup"]);
  assert.equal(result.evaluation.verdict, "indeterminate");
  assert.ok(result.evaluation.evidence.includes("evaluation:environment-version-mismatch"));
  assert.equal(result.cleanup_completed, true);
});

function campaignRunner(
  adapter: EvaluationAdapter,
  evidenceVerified = true,
): EvaluationCampaignRunner {
  return new EvaluationCampaignRunner({
    adapter,
    manager: new EvaluationManager(
      { now: () => new Date(NOW) },
      new StaticEvaluationSuitePolicyRegistry([
        {
          suite: { id: "requirement-quality-core", version: "0.1.0" },
          required_case_ids: ["positive-rule-only"],
          critical_invariant_ids: ["contract-valid", "no-provider"],
          minimum_trials_per_case: 1,
        },
      ]),
      { verify: () => true },
    ),
    evidence_verifier: { verify: () => evidenceVerified },
  });
}
