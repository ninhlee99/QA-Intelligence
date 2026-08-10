import assert from "node:assert/strict";
import test from "node:test";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../../src/adapters/playwright/playwright-execution-engine.js";
import { ExecuteBrowserTest, MAX_FLAKE_TRIALS, type ExecuteBrowserTestRequest } from "../../src/execution/execute-browser-test.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../src/requirement-review/public.js";

class AllowingAuthorizer implements WorkspaceAuthorizer {
  async authorize(request: WorkspaceAuthorizationRequest) {
    return {
      ok: true as const,
      value: {
        policy_version: request.context.policy_version,
        effective_permissions: [...request.required_permissions],
        authorized_resource_refs: [...request.resource_refs],
        decision_evidence: ["authorization:allow"],
      },
    };
  }
}

function workspaceContext(): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-flaky-001",
    actor_id: "actor-flaky-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-flaky-001",
    correlation_id: "correlation-flaky-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

const PAGE = `data:text/html,${encodeURIComponent('<html><body><button aria-label="Log in">Log in</button></body></html>')}`;

function hasAccessibleName(node: import("../../src/dom-cleaner/public.js").CleanedDomNode, name: string): boolean {
  if (node.accessible_name === name) return true;
  return node.children.some((child) => hasAccessibleName(child, name));
}

/** Assertion result varies by call count — the counting lives in this Node-side closure, which `PlaywrightExecutionEngine.start()` calls once per real trial. */
function flakyPlanFor(sequence: readonly boolean[]): PlaywrightExecutionPlan {
  let call = 0;
  return {
    url: PAGE,
    assert: () => sequence[Math.min(call++, sequence.length - 1)] ?? false,
  };
}

function plansForAllTrials(testCaseId: string, plan: PlaywrightExecutionPlan): Map<string, PlaywrightExecutionPlan> {
  const entries: [string, PlaywrightExecutionPlan][] = [[testCaseId, plan]];
  for (let trial = 2; trial <= MAX_FLAKE_TRIALS; trial++) entries.push([`${testCaseId}:trial-${trial}`, plan]);
  return new Map(entries);
}

function requestFor(testCaseId: string): ExecuteBrowserTestRequest {
  return {
    operation_id: `op:${testCaseId}`,
    workspace: workspaceContext(),
    execution: { execution_id: `execution:${testCaseId}`, attempt_id: testCaseId },
    test_case_ref: testCaseId,
    environment_ref: "dev-fixture",
    deadline: "2026-08-06T09:00:00.000Z",
  };
}

function skillFor(plans: ReadonlyMap<string, PlaywrightExecutionPlan>): ExecuteBrowserTest {
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
  return new ExecuteBrowserTest({ engine, clock: { now: () => new Date() }, provider_ref: "playwright-execution-engine@0.1.0" });
}

test("MAX_FLAKE_TRIALS is exported and equals 3", () => {
  assert.equal(MAX_FLAKE_TRIALS, 3);
});

test("2 passes + 1 fail across 3 trials reconciles to flaky, with retry_of_ref set", async () => {
  const skill = skillFor(plansForAllTrials("tc-flaky", flakyPlanFor([false, true, true])));
  const result = await skill.run(requestFor("tc-flaky"));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "flaky");
  assert.ok(result.value.retry_of_ref, "expected retry_of_ref to be set after a multi-trial run");
  assert.equal(result.value.retry_of_ref, `execution:execution:tc-flaky:tc-flaky`);
});

test("2 consistent failing trials reconcile to failed, not flaky, and still record retry_of_ref", async () => {
  const skill = skillFor(plansForAllTrials("tc-consistent-fail", flakyPlanFor([false, false])));
  const result = await skill.run(requestFor("tc-consistent-fail"));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
  assert.ok(result.value.retry_of_ref, "a retry did happen (trial 2), even though the outcome was not flaky");
});

test("a pass on trial 1 short-circuits: only one trial runs, retry_of_ref stays undefined", async () => {
  let calls = 0;
  const plan: PlaywrightExecutionPlan = {
    url: PAGE,
    assert: (cleaned) => {
      calls++;
      return hasAccessibleName(cleaned, "Log in");
    },
  };
  const skill = skillFor(plansForAllTrials("tc-immediate-pass", plan));
  const result = await skill.run(requestFor("tc-immediate-pass"));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.equal(result.value.retry_of_ref, undefined);
  assert.equal(calls, 1, "only trial 1 should have run the assertion");
});

test("an infrastructure fault mid-retry reconciles to the engine failure, never flaky", async () => {
  const testCaseId = "tc-infra-fault";
  let launches = 0;
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: plansForAllTrials(testCaseId, flakyPlanFor([false])),
    launchBrowser: async () => {
      launches++;
      if (launches >= 2) throw new Error("no browser binary installed");
      const { chromium } = await import("playwright");
      return chromium.launch();
    },
  });
  const skill = new ExecuteBrowserTest({ engine, clock: { now: () => new Date() }, provider_ref: "playwright-execution-engine@0.1.0" });

  const result = await skill.run(requestFor(testCaseId));

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.class, "infrastructure");
});

test("existing single-trial passed/failed behavior is unaffected for a caller that only seeds the base attempt id", async () => {
  const passSkill = skillFor(new Map([["tc-single-pass", flakyPlanFor([true])]]));
  const passResult = await passSkill.run(requestFor("tc-single-pass"));
  assert.equal(passResult.ok, true, JSON.stringify(passResult));
  if (passResult.ok) assert.equal(passResult.value.outcome, "passed");

  const failSkill = skillFor(plansForAllTrials("tc-single-fail-then-fail", flakyPlanFor([false, false])));
  const failResult = await failSkill.run(requestFor("tc-single-fail-then-fail"));
  assert.equal(failResult.ok, true, JSON.stringify(failResult));
  if (failResult.ok) assert.equal(failResult.value.outcome, "failed");
});
