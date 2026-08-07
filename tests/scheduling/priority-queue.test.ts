import assert from "node:assert/strict";
import test from "node:test";

import { SchedulingQueue } from "../../src/scheduling/priority-queue.js";
import type { AdmissionRequest } from "../../src/scheduling/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

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
  return {
    request_id: "req-1",
    workspace_id: "workspace-alpha",
    actor_id: "actor-scheduling-001",
    context: workspaceContext(overrides.workspace_id ?? "workspace-alpha"),
    operation_type: "execution",
    priority: "normal",
    deadline: "2026-08-08T10:00:00.000Z",
    required_capability: { id: "playwright", version: "1.0.0" },
    estimated_resources: { concurrency_slots: 1 },
    ...overrides,
  };
}

function makeQueue(): SchedulingQueue {
  return new SchedulingQueue({ now: () => new Date("2026-08-08T09:30:00.000Z") });
}

test("fairness: two Workspaces at equal priority interleave rather than one draining first", () => {
  const queue = makeQueue();
  queue.enqueue(request({ request_id: "alpha-1", workspace_id: "workspace-alpha" }));
  queue.enqueue(request({ request_id: "alpha-2", workspace_id: "workspace-alpha" }));
  queue.enqueue(request({ request_id: "beta-1", workspace_id: "workspace-beta" }));

  const first = queue.dequeueNext();
  const second = queue.dequeueNext();

  assert.equal(first?.workspace_id, "workspace-alpha");
  assert.equal(second?.workspace_id, "workspace-beta");
});

test("critical-governance requests bypass fairness rotation entirely", () => {
  const queue = makeQueue();
  queue.enqueue(request({ request_id: "alpha-1", workspace_id: "workspace-alpha", priority: "normal" }));
  queue.enqueue(request({ request_id: "beta-1", workspace_id: "workspace-beta", priority: "normal" }));
  queue.enqueue(request({ request_id: "alpha-critical", workspace_id: "workspace-alpha", priority: "critical_governance" }));

  const first = queue.dequeueNext();

  assert.equal(first?.request_id, "alpha-critical");
});

test("depth and oldestAgeSeconds report queue observability signals", () => {
  const queue = new SchedulingQueue({ now: () => new Date("2026-08-08T09:30:00.000Z") });
  queue.enqueue(request({ request_id: "alpha-1", workspace_id: "workspace-alpha" }));

  assert.equal(queue.depth(), 1);
  assert.equal(queue.depth("workspace-alpha"), 1);
  assert.equal(queue.depth("workspace-beta"), 0);
  assert.equal(queue.oldestAgeSeconds(), 0);
});

test("dequeueNext returns undefined when the queue is empty", () => {
  const queue = makeQueue();
  assert.equal(queue.dequeueNext(), undefined);
});

test("starvation: a low-priority request eventually dequeues under fair rotation", () => {
  const queue = makeQueue();
  queue.enqueue(request({ request_id: "alpha-low", workspace_id: "workspace-alpha", priority: "low" }));
  for (let index = 0; index < 5; index += 1) {
    queue.enqueue(request({ request_id: `beta-${index}`, workspace_id: "workspace-beta", priority: "normal" }));
  }

  const dequeued: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const next = queue.dequeueNext();
    if (next !== undefined) dequeued.push(next.request_id);
  }

  assert.ok(dequeued.includes("alpha-low"));
});
