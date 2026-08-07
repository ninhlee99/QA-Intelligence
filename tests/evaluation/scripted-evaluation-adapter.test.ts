import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationRequestDigest,
  type CleanupRequest,
  type DescriptorRequest,
  type EvaluationAdapterRequest,
  type EvaluationAdapterOperation,
  type EvaluateRubricRequest,
  type ExecuteTrialRequest,
  type ReplayRequest,
} from "../../src/evaluation/adapter.js";
import { ScriptedEvaluationAdapter } from "../../src/adapters/replay/scripted-evaluation-adapter.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

const NOW = "2026-08-03T12:00:00.000Z";

function sequenceClock(...times: readonly string[]): { now(): Date } {
  let index = 0;
  return {
    now(): Date {
      const value = times[index];
      assert.ok(value, `clock call ${index + 1} has a configured timestamp`);
      index += 1;
      return new Date(value);
    },
  };
}

function context(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-evaluation-001",
    actor_id: "evaluation-runner-001",
    actor_type: "service",
    roles: ["evaluation-runner"],
    permissions: ["evaluation:read"],
    policy_version: "evaluation-policy-1.0.0",
    request_id: "request-descriptor-001",
    correlation_id: "campaign-001",
    audience: ["qa-intelligence-evaluation"],
    environment: "test",
    issued_at: "2026-08-03T11:00:00.000Z",
    expires_at: "2026-08-03T13:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "fixture-proof",
  };
}

function allowingAuthorizer(calls: WorkspaceAuthorizationRequest[]): WorkspaceAuthorizer {
  return {
    async authorize(request) {
      calls.push(request);
      return {
        ok: true,
        value: {
          policy_version: request.context.policy_version,
          effective_permissions: [...request.required_permissions],
          authorized_resource_refs: [...request.resource_refs],
          decision_evidence: ["policy://evaluation/allow"],
        },
      };
    },
  };
}

function descriptorRequest(): DescriptorRequest {
  const request: DescriptorRequest = {
    operation: "descriptor",
    operationId: "descriptor-001",
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
    },
    workspace: context(),
    idempotency: {
      key: "descriptor-key-001",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
    deadline: {
      at: "2026-08-03T12:05:00.000Z",
      time_standard: "UTC",
    },
    version: {
      contract: "1.0.0",
      operation_schema: "1.0.0",
    },
    payload: {
      required_capabilities: ["executeTrial", "collectEvidence", "cleanup"],
    },
  };
  return {
    ...request,
    idempotency: {
      ...request.idempotency,
      request_digest: evaluationRequestDigest(request),
    },
  };
}

function sealRequest<Operation extends EvaluationAdapterOperation>(
  request: EvaluationAdapterRequest<Operation>,
): EvaluationAdapterRequest<Operation> {
  return {
    ...request,
    idempotency: {
      ...request.idempotency,
      request_digest: evaluationRequestDigest(request),
    },
  };
}

function executeTrialRequest(): ExecuteTrialRequest {
  return sealRequest({
    operation: "executeTrial",
    operationId: "execute-trial-001",
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
    },
    workspace: context(),
    idempotency: {
      key: "execute-key-001",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
    deadline: {
      at: "2026-08-03T12:05:00.000Z",
      time_standard: "UTC",
    },
    version: {
      contract: "1.0.0",
      operation_schema: "1.0.0",
    },
    payload: {
      environment_lease: "lease://trial-001",
      execution_plan_ref: "plan://requirement-review@1.0.0",
      authorized_input_refs: ["requirement://REQ-001@1.0.0"],
    },
  });
}

function cleanupRequest(): CleanupRequest {
  return sealRequest({
    operation: "cleanup",
    operationId: "cleanup-001",
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
    },
    workspace: context(),
    idempotency: {
      key: "cleanup-key-001",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
    deadline: {
      at: "2026-08-03T12:05:00.000Z",
      time_standard: "UTC",
    },
    version: {
      contract: "1.0.0",
      operation_schema: "1.0.0",
    },
    payload: {
      environment_lease: "lease://trial-001",
      resource_refs: ["sandbox://trial-001"],
      cleanup_policy_ref: "cleanup-policy@1.0.0",
    },
  });
}

function evaluateRubricRequest(): EvaluateRubricRequest {
  return sealRequest({
    operation: "evaluateRubric",
    operationId: "evaluate-rubric-001",
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
    },
    workspace: context(),
    idempotency: {
      key: "rubric-key-001",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
    deadline: { at: "2026-08-03T12:05:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      rubric_ref: "rubric://requirement-quality@1.0.0",
      eligible_evidence_refs: ["evidence://trial-001/output"],
      calibration_ref: "calibration://judge@1.0.0",
      independence_policy_ref: "judge-independence@1.0.0",
      candidate_output_ref: "assessment://assessment-001",
    },
  });
}

function replayRequest(): ReplayRequest {
  return sealRequest({
    operation: "replay",
    operationId: "replay-001",
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-001",
      attempt_id: "attempt-001",
    },
    workspace: context(),
    idempotency: {
      key: "replay-key-001",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
    deadline: { at: "2026-08-03T12:05:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      source_operation_ids: ["execute-trial-001"],
      evidence_refs: ["evidence://trial-001/output"],
      exact_input_refs: ["requirement://REQ-001@1.0.0"],
      allowed_substitutions: [],
      requested_fidelity: "exact",
    },
  });
}

test("returns an authorized, provider-neutral descriptor with the common envelope", async () => {
  const request = descriptorRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: {
      id: "scripted-evaluation",
      version: "1.0.0",
    },
    supported_operations: [
      "descriptor",
      "prepareEnvironment",
      "executeTrial",
      "collectEvidence",
      "cleanup",
    ],
    cases: [
      {
        match: request,
        outcome: {
          value: {
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
          },
          evidence: ["evidence://adapter/descriptor-001"],
        },
      },
    ],
  });

  const result = await adapter.descriptor(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.operation, request.operation);
  assert.equal(result.operationId, request.operationId);
  assert.deepEqual(result.trial, request.trial);
  assert.deepEqual(result.workspace, request.workspace);
  assert.deepEqual(result.idempotency, request.idempotency);
  assert.deepEqual(result.deadline, request.deadline);
  assert.deepEqual(result.version, request.version);
  assert.deepEqual(result.provider, { id: "scripted-evaluation", version: "1.0.0" });
  assert.equal(result.value.health, "healthy");
  assert.equal("verdict" in result.value, false);
  assert.deepEqual(result.evidence, [
    "policy://evaluation/allow",
    "evidence://adapter/descriptor-001",
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(request), false);
  assert.equal(authorizationCalls.length, 1);
  assert.deepEqual(authorizationCalls[0]?.required_permissions, ["evaluation:read"]);
});

test("returns trial observations without deciding the evaluation verdict", async () => {
  const request = executeTrialRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [
              {
                assertion_id: "assessment-schema",
                observed: true,
                evidence_ref: "evidence://trial-001/assessment-schema",
              },
            ],
            subject_output_refs: ["assessment://assessment-001"],
            tool_events: [],
            policy_events: [{ decision: "allow", policy: "evaluation-policy@1.0.0" }],
            resource_usage: { steps: 1, tool_calls: 0 },
            trial_timings: { duration_ms: 20 },
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/assessment-schema"],
          },
          evidence: ["evidence://trial-001/assessment-schema"],
        },
      },
    ],
  });

  const result = await adapter.executeTrial(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.deepEqual(result.value.subject_output_refs, ["assessment://assessment-001"]);
  assert.equal("verdict" in result.value, false);
  assert.equal("campaign_state" in result.value, false);
  assert.deepEqual(authorizationCalls[0]?.required_permissions, ["evaluation:execute"]);
  assert.equal(authorizationCalls[0]?.consequence_class, "controlled_side_effect");
  assert.equal(
    authorizationCalls[0]?.resource_refs.includes(
      "environment-lease:lease://trial-001",
    ),
    true,
  );
  assert.equal(
    authorizationCalls[0]?.resource_refs.includes(
      "execution-plan:plan://requirement-review@1.0.0",
    ),
    true,
  );
  assert.equal(
    authorizationCalls[0]?.resource_refs.includes(
      "input:requirement://REQ-001@1.0.0",
    ),
    true,
  );
  assert.equal(result.evidence.includes("policy://evaluation/allow"), true);
});

test("fails closed when authorization omits a payload resource", async () => {
  const request = executeTrialRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: {
      async authorize(authorizationRequest) {
        return {
          ok: true,
          value: {
            policy_version: authorizationRequest.context.policy_version,
            effective_permissions: [...authorizationRequest.required_permissions],
            authorized_resource_refs: authorizationRequest.resource_refs.filter(
              (reference) => reference !== "input:requirement://REQ-001@1.0.0",
            ),
            decision_evidence: ["policy://evaluation/incomplete-coverage"],
          },
        };
      },
    },
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [],
  });

  const result = await adapter.executeTrial(request);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "policy_denied");
  assert.deepEqual(result.evidence, ["policy://evaluation/incomplete-coverage"]);
});

test("normalizes an explicit authorization denial without executing a script", async () => {
  const request = executeTrialRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: {
      async authorize() {
        return {
          ok: false,
          failure: {
            code: "insufficient_permission",
            message: "fixture denial",
            retryable: false,
            evidence: ["policy://evaluation/deny"],
          },
        };
      },
    },
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [],
  });

  const result = await adapter.executeTrial(request);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "policy_denied");
  assert.deepEqual(result.evidence, ["policy://evaluation/deny"]);
});

test("reauthorizes duplicate requests and retains the same logical result", async () => {
  const request = executeTrialRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [],
            subject_output_refs: ["assessment://assessment-001"],
            tool_events: [],
            policy_events: [],
            resource_usage: {},
            trial_timings: {},
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/output"],
          },
          evidence: ["evidence://trial-001/output"],
        },
      },
    ],
  });

  const first = await adapter.executeTrial(request);
  const duplicate = await adapter.executeTrial(request);

  assert.equal(first.ok, true);
  assert.strictEqual(duplicate, first);
  assert.equal(authorizationCalls.length, 2);
});

test("rejects reuse of an idempotency key with a different canonical request", async () => {
  const request = executeTrialRequest();
  const changed = sealRequest({
    ...request,
    payload: {
      ...request.payload,
      execution_plan_ref: "plan://different@1.0.0",
    },
    idempotency: {
      ...request.idempotency,
      request_digest: "",
    },
  });
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer([]),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [],
            subject_output_refs: [],
            tool_events: [],
            policy_events: [],
            resource_usage: {},
            trial_timings: {},
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/output"],
          },
        },
      },
    ],
  });

  const first = await adapter.executeTrial(request);
  const conflict = await adapter.executeTrial(changed);

  assert.equal(first.ok, true);
  assert.equal(conflict.ok, false);
  assert.ok(!conflict.ok);
  assert.equal(conflict.failure.code, "idempotency_conflict");
});

test("authorizes but does not execute a new operation after its deadline", async () => {
  const valid = executeTrialRequest();
  const expired = sealRequest({
    ...valid,
    deadline: { at: "2026-08-03T11:59:59.000Z", time_standard: "UTC" },
    idempotency: { ...valid.idempotency, request_digest: "" },
  });
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [],
  });

  const result = await adapter.executeTrial(expired);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "deadline_exceeded");
  assert.equal(authorizationCalls.length, 1);
});

test("keeps cleanup bounded and idempotent", async () => {
  const request = cleanupRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            resource_outcomes: [
              { resource_ref: "sandbox://trial-001", outcome: "revoked" },
            ],
            residual_resources: [],
            completion_status: "completed",
            residual_risk: [],
          },
          evidence: ["evidence://trial-001/cleanup"],
        },
      },
    ],
  });

  const first = await adapter.cleanup(request);
  const duplicate = await adapter.cleanup(request);

  assert.equal(first.ok, true);
  assert.strictEqual(duplicate, first);
  assert.equal(authorizationCalls.length, 2);
  assert.ok(first.ok);
  assert.equal(first.value.completion_status, "completed");
  assert.deepEqual(first.value.residual_resources, []);
});

test("reports cleanup_incomplete when residual resources remain", async () => {
  const request = cleanupRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer([]),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            resource_outcomes: [
              { resource_ref: "sandbox://trial-001", outcome: "failed" },
            ],
            residual_resources: ["sandbox://trial-001"],
            completion_status: "completed",
            residual_risk: ["sandbox lease remains active"],
          },
          evidence: ["evidence://trial-001/cleanup-failure"],
        },
      },
    ],
  });

  const result = await adapter.cleanup(request);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "cleanup_incomplete");
  assert.deepEqual(result.failure.details.residual_resources, [
    "sandbox://trial-001",
  ]);
  assert.equal(result.evidence.includes("policy://evaluation/allow"), true);
  assert.equal(result.evidence.includes("evidence://trial-001/cleanup-failure"), true);
});

test("fails explicitly when the descriptor does not support an optional capability", async () => {
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    supported_operations: ["descriptor", "executeTrial", "collectEvidence", "cleanup"],
    cases: [],
  });

  const result = await adapter.evaluateRubric(evaluateRubricRequest());

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "unsupported_capability");
  assert.equal(authorizationCalls.length, 1);
});

test("retains a successful result when an authorized duplicate arrives after the deadline", async () => {
  const request = executeTrialRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: sequenceClock(
      "2026-08-03T12:00:00.000Z",
      "2026-08-03T12:01:00.000Z",
      "2026-08-03T12:06:00.000Z",
    ),
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [],
            subject_output_refs: ["assessment://assessment-001"],
            tool_events: [],
            policy_events: [],
            resource_usage: {},
            trial_timings: {},
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/output"],
          },
        },
      },
    ],
  });

  const first = await adapter.executeTrial(request);
  const afterDeadline = await adapter.executeTrial(request);

  assert.equal(first.ok, true);
  assert.strictEqual(afterDeadline, first);
  assert.equal(authorizationCalls.length, 2);
});

test("retains deadline_exceeded when a provider result completes late", async () => {
  const request = executeTrialRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: sequenceClock(
      "2026-08-03T12:00:00.000Z",
      "2026-08-03T12:06:00.000Z",
      "2026-08-03T12:07:00.000Z",
    ),
    authorizer: allowingAuthorizer([]),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [],
            subject_output_refs: ["assessment://late-output"],
            tool_events: [],
            policy_events: [],
            resource_usage: {},
            trial_timings: {},
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/late-output"],
          },
        },
      },
    ],
  });

  const late = await adapter.executeTrial(request);
  const duplicate = await adapter.executeTrial(request);

  assert.equal(late.ok, false);
  assert.ok(!late.ok);
  assert.equal(late.failure.code, "deadline_exceeded");
  assert.strictEqual(duplicate, late);
});

test("rejects a timezone-less deadline instead of interpreting host local time", async () => {
  const valid = executeTrialRequest();
  const localDeadline = sealRequest({
    ...valid,
    deadline: { at: "2026-08-03T12:05:00", time_standard: "UTC" },
    idempotency: { ...valid.idempotency, request_digest: "" },
  });
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [],
  });

  const result = await adapter.executeTrial(localDeadline);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "invalid_request");
  assert.equal(authorizationCalls.length, 0);
});

test("a cancelled operation retains a stable cancelled failure, not a retried attempt", async () => {
  const request = executeTrialRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          failure: {
            code: "cancelled",
            retryable: false,
            responsible_domain: "caller",
            message: "The evaluation trial was cancelled before completion.",
            details: {},
            diagnostic_evidence_refs: ["evidence://trial-001/cancellation"],
            provider_details: {},
          },
          evidence: ["evidence://trial-001/cancellation"],
        },
      },
    ],
  });

  const result = await adapter.executeTrial(request);
  const duplicate = await adapter.executeTrial(request);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "cancelled");
  assert.equal(result.failure.retryable, false);
  assert.equal(result.evidence.includes("evidence://trial-001/cancellation"), true);
  assert.strictEqual(duplicate, result);
  assert.equal(authorizationCalls.length, 2);
});

test("replay never overwrites the original trial and reports achieved fidelity", async () => {
  const request = replayRequest();
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [
              {
                assertion_id: "assessment-schema",
                observed: true,
                evidence_ref: "evidence://trial-001/replay/assessment-schema",
              },
            ],
            resolved_versions: { "requirement-review": "1.0.0" },
            substitutions: [],
            divergences: [],
            evidence: ["evidence://trial-001/replay/assessment-schema"],
            achieved_fidelity: "exact",
          },
          evidence: ["evidence://trial-001/replay/assessment-schema"],
        },
      },
    ],
  });

  const result = await adapter.replay(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.value.achieved_fidelity, "exact");
  assert.deepEqual(result.value.divergences, []);
  assert.equal(result.operationId, "replay-001");
  assert.notEqual(result.operationId, "execute-trial-001");
  assert.deepEqual(authorizationCalls[0]?.required_permissions, ["evaluation:replay"]);
  assert.equal(authorizationCalls[0]?.consequence_class, "controlled_side_effect");
});

test("a replay result explicitly reports divergence instead of a silent match", async () => {
  const request = replayRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer([]),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          value: {
            observations: [
              {
                assertion_id: "assessment-schema",
                observed: false,
                evidence_ref: "evidence://trial-001/replay/assessment-schema",
              },
            ],
            resolved_versions: { "requirement-review": "1.0.1" },
            substitutions: ["provider:scripted-evaluation@1.0.1"],
            divergences: [
              "requirement-review version drifted from 1.0.0 to 1.0.1",
              "assessment-schema observation flipped from true to false",
            ],
            evidence: ["evidence://trial-001/replay/assessment-schema"],
            achieved_fidelity: "substituted",
          },
        },
      },
    ],
  });

  const result = await adapter.replay(request);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.value.achieved_fidelity, "substituted");
  assert.equal(result.value.divergences.length, 2);
  assert.deepEqual(result.value.substitutions, ["provider:scripted-evaluation@1.0.1"]);
});

test("a trial cannot observe or receive another trial's scripted case", async () => {
  const ownTrial = executeTrialRequest();
  const otherTrial = sealRequest({
    ...ownTrial,
    trial: {
      campaign_id: "campaign-001",
      case_id: "case-001",
      trial_id: "trial-002",
      attempt_id: "attempt-001",
    },
    idempotency: {
      key: "execute-key-002",
      scope: "workspace-evaluation-001:campaign-001",
      request_digest: "",
    },
  });
  const authorizationCalls: WorkspaceAuthorizationRequest[] = [];
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer(authorizationCalls),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: ownTrial,
        outcome: {
          value: {
            observations: [
              {
                assertion_id: "hidden-case-marker",
                observed: true,
                evidence_ref: "evidence://trial-001/hidden-case-marker",
              },
            ],
            subject_output_refs: ["assessment://trial-001-only"],
            tool_events: [],
            policy_events: [],
            resource_usage: {},
            trial_timings: {},
            termination_observation: { state: "completed" },
            raw_evidence_refs: ["evidence://trial-001/hidden-case-marker"],
          },
        },
      },
    ],
  });

  const result = await adapter.executeTrial(otherTrial);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "unavailable");
  assert.equal(JSON.stringify(result).includes("trial-001-only"), false);
  assert.equal(JSON.stringify(result).includes("hidden-case-marker"), false);
  assert.equal(authorizationCalls.length, 1);
});

test("replay fails explicitly with replay_unavailable when a dependency cannot be reconstructed", async () => {
  const request = replayRequest();
  const adapter = new ScriptedEvaluationAdapter({
    clock: { now: () => new Date(NOW) },
    authorizer: allowingAuthorizer([]),
    provider: { id: "scripted-evaluation", version: "1.0.0" },
    cases: [
      {
        match: request,
        outcome: {
          failure: {
            code: "replay_unavailable",
            retryable: true,
            responsible_domain: "replay",
            message: "A source evidence reference required for replay is no longer available.",
            details: {},
            diagnostic_evidence_refs: ["evidence://trial-001/replay/missing-source"],
            provider_details: {},
          },
          evidence: ["evidence://trial-001/replay/missing-source"],
        },
      },
    ],
  });

  const result = await adapter.replay(request);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.failure.code, "replay_unavailable");
  assert.equal(result.failure.responsible_domain, "replay");
  assert.equal(
    result.evidence.includes("evidence://trial-001/replay/missing-source"),
    true,
  );
});
