import assert from "node:assert/strict";
import test from "node:test";

import { evaluateAdmission, type AdmissionDependencies } from "../../src/scheduling/admission.js";
import { SchedulingQueue } from "../../src/scheduling/priority-queue.js";
import type { AdmissionRequest, WorkspaceQuota } from "../../src/scheduling/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest): Promise<WorkspaceAuthorizationResult> {
    return {
      ok: true,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(workspaceId: string): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: workspaceId,
    actor_id: "actor-scheduling-001",
    actor_type: "service",
    roles: ["scheduler"],
    permissions: ["scheduling:admit"],
    policy_version: "policy@1.0.0",
    request_id: "request-scheduling-001",
    correlation_id: "correlation-scheduling-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-08T09:00:00.000Z",
    expires_at: "2026-08-08T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

function request(overrides: Partial<AdmissionRequest> = {}): AdmissionRequest {
  const workspaceId = overrides.workspace_id ?? "workspace-alpha";
  return {
    request_id: "req-1",
    workspace_id: workspaceId,
    actor_id: "actor-scheduling-001",
    context: workspaceContext(workspaceId),
    operation_type: "execution",
    priority: "normal",
    deadline: "2026-08-08T10:00:00.000Z",
    required_capability: { id: "playwright", version: "1.0.0" },
    estimated_resources: { concurrency_slots: 1 },
    ...overrides,
  };
}

function dependencies(overrides: Partial<AdmissionDependencies> = {}): AdmissionDependencies {
  return {
    authorizer: new AllowingAuthorizer(),
    queue: new SchedulingQueue({ now: () => new Date("2026-08-08T09:30:00.000Z") }),
    quotas: new Map<string, WorkspaceQuota>([
      ["workspace-alpha", { workspace_id: "workspace-alpha", max_concurrent: 2, reserved_critical_slots: 1 }],
      ["workspace-beta", { workspace_id: "workspace-beta", max_concurrent: 2, reserved_critical_slots: 0 }],
    ]),
    currentInFlight: () => 0,
    supportedCapabilities: new Set(["playwright@1.0.0"]),
    environmentAvailable: () => true,
    now: () => new Date("2026-08-08T09:30:00.000Z"),
    ...overrides,
  };
}

test("a normal request within quota is admitted", async () => {
  const result = await evaluateAdmission(dependencies(), request());

  assert.equal(result.outcome, "admitted");
});

test("quota: a Workspace at max_concurrent is deferred, not rejected", async () => {
  const result = await evaluateAdmission(dependencies({ currentInFlight: () => 2 }), request());

  assert.equal(result.outcome, "deferred");
});

test("priority inversion is prevented: critical-governance ignores reserved_critical_slots and is still admitted at high in-flight", async () => {
  const result = await evaluateAdmission(
    dependencies({ currentInFlight: () => 1 }),
    request({ priority: "critical_governance" }),
  );

  assert.equal(result.outcome, "admitted");
});

test("a normal request is deferred once reserved_critical_slots leaves no room", async () => {
  // max_concurrent 2, reserved_critical_slots 1 -> only 1 slot for non-critical work.
  const result = await evaluateAdmission(dependencies({ currentInFlight: () => 1 }), request({ priority: "normal" }));

  assert.equal(result.outcome, "deferred");
});

test("authorization denial is rejected, not deferred", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await evaluateAdmission(dependencies({ authorizer: deniedAuthorizer }), request());

  assert.equal(result.outcome, "rejected");
  if (result.outcome !== "rejected") return;
  assert.equal(result.reason, "unauthorized");
});

test("unsupported capability is rejected before quota is even checked", async () => {
  const result = await evaluateAdmission(
    dependencies({ supportedCapabilities: new Set(), currentInFlight: () => 999 }),
    request(),
  );

  assert.equal(result.outcome, "rejected");
  if (result.outcome !== "rejected") return;
  assert.equal(result.reason, "unsupported_capability");
});

test("environment unavailability is rejected as environment_unavailable", async () => {
  const result = await evaluateAdmission(dependencies({ environmentAvailable: () => false }), request());

  assert.equal(result.outcome, "rejected");
  if (result.outcome !== "rejected") return;
  assert.equal(result.reason, "environment_unavailable");
});

test("a deadline already in the past is deadline_infeasible", async () => {
  const result = await evaluateAdmission(dependencies(), request({ deadline: "2020-01-01T00:00:00.000Z" }));

  assert.equal(result.outcome, "rejected");
  if (result.outcome !== "rejected") return;
  assert.equal(result.reason, "deadline_infeasible");
});

test("Workspace isolation: one Workspace's quota exhaustion never blocks another Workspace's admission", async () => {
  const deps = dependencies({
    currentInFlight: (workspaceId: string) => (workspaceId === "workspace-alpha" ? 2 : 0),
  });

  const alphaResult = await evaluateAdmission(deps, request({ workspace_id: "workspace-alpha" }));
  const betaResult = await evaluateAdmission(deps, request({ workspace_id: "workspace-beta" }));

  assert.equal(alphaResult.outcome, "deferred");
  assert.equal(betaResult.outcome, "admitted");
});

test("fairness: two Workspaces' deferred requests both land in the queue and interleave on dequeue", async () => {
  const queue = new SchedulingQueue({ now: () => new Date("2026-08-08T09:30:00.000Z") });
  const deps = dependencies({ queue, currentInFlight: () => 999 });

  await evaluateAdmission(deps, request({ request_id: "alpha-1", workspace_id: "workspace-alpha" }));
  await evaluateAdmission(deps, request({ request_id: "beta-1", workspace_id: "workspace-beta" }));

  const first = queue.dequeueNext();
  const second = queue.dequeueNext();
  assert.notEqual(first?.workspace_id, second?.workspace_id);
});
