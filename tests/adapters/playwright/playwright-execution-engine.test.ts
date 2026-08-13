import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../../../src/adapters/playwright/playwright-execution-engine.js";
import type {
  ExecutionAttemptIdentity,
  StartRequest,
} from "../../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";
import { runExecutionEngineContract } from "../../execution-engine/execution-engine-contract.js";

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
    workspace_id: "workspace-playwright-001",
    actor_id: "actor-playwright-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-playwright-001",
    correlation_id: "correlation-playwright-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-06T08:00:00.000Z",
    expires_at: "2026-08-06T10:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

const PASSED_PAGE = `data:text/html,${encodeURIComponent(
  '<html><body><button aria-label="Log in">Log in</button></body></html>',
)}`;
const FAILED_PAGE = `data:text/html,${encodeURIComponent("<html><body><div>No login here</div></body></html>")}`;

function planFor(outcome: "passed" | "failed" | "cancelled"): PlaywrightExecutionPlan {
  return {
    url: outcome === "failed" ? FAILED_PAGE : PASSED_PAGE,
    assert: (cleaned) => hasAccessibleName(cleaned, "Log in"),
  };
}

function hasAccessibleName(node: import("../../../src/dom-cleaner/public.js").CleanedDomNode, name: string): boolean {
  if (node.accessible_name === name) return true;
  return node.children.some((child) => hasAccessibleName(child, name));
}

function startRequestFor(attempt: ExecutionAttemptIdentity, outcome: "passed" | "failed" | "cancelled"): StartRequest {
  return {
    operation: "start",
    operationId: `op-start:${attempt.attempt_id}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${attempt.attempt_id}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-06T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      environment_lease: `lease:${attempt.execution_id}`,
      execution_plan_ref: `plan:${attempt.attempt_id}`,
      authorized_input_refs: [],
    },
  };
}

function makeEngine(plans: ReadonlyMap<string, PlaywrightExecutionPlan>): PlaywrightExecutionEngine {
  return new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
  });
}

/** Every attempt_id the shared contract suite exercises, pre-planned so `makeEngine()` needs no per-test wiring. */
function contractPlans(): ReadonlyMap<string, PlaywrightExecutionPlan> {
  return new Map([
    ["attempt-idempotent-1", planFor("passed")],
    ["attempt-ordering-1", planFor("passed")],
    ["attempt-map-passed", planFor("passed")],
    ["attempt-map-failed", planFor("failed")],
    ["attempt-cancel-1", planFor("cancelled")],
    ["attempt-terminal-cancel-1", planFor("passed")],
    ["attempt-finalize-1", planFor("passed")],
  ]);
}

runExecutionEngineContract("playwright-execution-engine", {
  makeEngine: () => makeEngine(contractPlans()),
  workspaceContext,
  startRequestFor,
});

test("start drives a real Chromium page through the Semantic UI pipeline and reports passed", async () => {
  const engine = makeEngine(new Map([["attempt-real-passed", planFor("passed")]]));
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-real", attempt_id: "attempt-real-passed" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.ok(result.value.evidence.length > 0, "a real run SHALL retain a DOM-clean capture id as evidence");
});

test("start kill switch blocks before the browser is launched", async () => {
  let launched = false;
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-killed", planFor("passed")]]),
    launchBrowser: async () => { launched = true; throw new Error("must not launch"); },
    executionKillSwitch: { state: () => ({ disabled: true, reason: "incident-42" }) },
  });
  const result = await engine.start(startRequestFor({ execution_id: "execution-killed", attempt_id: "attempt-killed" }, "passed"), () => {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "policy_denied");
  assert.equal(launched, false);
});

test("global environment kill switch protects an engine even when its caller omitted configuration", async () => {
  const previous = process.env["QA_INTELLIGENCE_EXECUTION_DISABLED"];
  process.env["QA_INTELLIGENCE_EXECUTION_DISABLED"] = "global-incident";
  try {
    let launched = false;
    const engine = new PlaywrightExecutionEngine({ clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(), provider: { id: "playwright-execution-engine", version: "0.1.0" }, plans: new Map([["attempt-global-killed", planFor("passed")]]), launchBrowser: async () => { launched = true; throw new Error("must not launch"); } });
    const result = await engine.start(startRequestFor({ execution_id: "execution-global-killed", attempt_id: "attempt-global-killed" }, "passed"), () => {});
    assert.equal(result.ok, false);
    assert.equal(launched, false);
  } finally {
    if (previous === undefined) delete process.env["QA_INTELLIGENCE_EXECUTION_DISABLED"]; else process.env["QA_INTELLIGENCE_EXECUTION_DISABLED"] = previous;
  }
});

test("start drives a real Chromium page through the Semantic UI pipeline and reports failed when the plan assertion does not hold", async () => {
  const engine = makeEngine(new Map([["attempt-real-failed", planFor("failed")]]));
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-real", attempt_id: "attempt-real-failed" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
});

test("start writes a real screenshot file to disk when screenshotDir is configured and the plan assertion does not hold", async () => {
  const screenshotDir = mkdtempSync(join(tmpdir(), "qa-screenshot-test-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-screenshot-failed", planFor("failed")]]),
    screenshotDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-screenshot", attempt_id: "attempt-screenshot-failed" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
  const screenshotPath = result.value.evidence.find((e) => e.endsWith(".png"));
  assert.ok(screenshotPath, "a failed run with screenshotDir configured SHALL capture a real screenshot file, not only the synthetic capture_id");
  assert.ok(existsSync(screenshotPath!), "the evidence path SHALL be a real file, not just a plausible-looking string");
  assert.ok(statSync(screenshotPath!).size > 0, "the screenshot file SHALL be non-empty");
  assert.ok(result.value.evidence.length >= 2, "evidence SHALL include both capture_id and the screenshot path");
});

test("start writes a Playwright trace zip when traceDir is configured and assertion fails", async () => {
  const traceDir = mkdtempSync(join(tmpdir(), "qa-trace-test-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-trace-failed", planFor("failed")]]),
    traceDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-trace", attempt_id: "attempt-trace-failed" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
  const tracePath = result.value.evidence.find((e) => e.endsWith(".zip"));
  assert.ok(tracePath, "failed run with traceDir SHALL attach a Playwright trace zip");
  assert.ok(existsSync(tracePath!), "trace path SHALL exist on disk");
  assert.ok(statSync(tracePath!).size > 0, "trace zip SHALL be non-empty");
});

test("start writes a real WebM video and attaches it as evidence when videoDir is configured", async () => {
  const videoDir = mkdtempSync(join(tmpdir(), "qa-video-test-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-video-passed", planFor("passed")]]),
    videoDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-video", attempt_id: "attempt-video-passed" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  const videoPath = result.value.evidence.find((e) => e.endsWith(".webm"));
  assert.ok(videoPath, "an opted-in run SHALL attach its real Playwright video path");
  assert.ok(existsSync(videoPath!), "video evidence path SHALL exist on disk");
  assert.ok(statSync(videoPath!).size > 0, "video evidence SHALL be non-empty");
});

test("videoPolicy failure_only retains failed video but omits passed video", async () => {
  const videoDir = mkdtempSync(join(tmpdir(), "qa-video-policy-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([
      ["attempt-video-policy-pass", planFor("passed")],
      ["attempt-video-policy-fail", planFor("failed")],
    ]),
    videoDir,
    videoPolicy: "failure_only",
  });
  const passed = await engine.start(startRequestFor({ execution_id: "execution-video-policy", attempt_id: "attempt-video-policy-pass" }, "passed"), () => {});
  const failed = await engine.start(startRequestFor({ execution_id: "execution-video-policy", attempt_id: "attempt-video-policy-fail" }, "failed"), () => {});

  assert.equal(passed.ok, true, JSON.stringify(passed));
  assert.equal(failed.ok, true, JSON.stringify(failed));
  if (!passed.ok || !failed.ok) return;
  assert.equal(passed.value.evidence.some((ref) => ref.endsWith(".webm")), false);
  const failedVideo = failed.value.evidence.find((ref) => ref.endsWith(".webm"));
  assert.ok(failedVideo, "failure_only should retain failed testcase video");
  assert.ok(existsSync(failedVideo!));
});

test("start does not write a trace zip when assertion passes even with traceDir configured", async () => {
  const traceDir = mkdtempSync(join(tmpdir(), "qa-trace-pass-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-trace-passed", planFor("passed")]]),
    traceDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-trace-pass", attempt_id: "attempt-trace-passed" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.equal(result.value.evidence.some((e) => e.endsWith(".zip")), false);
});

test("start does not capture a screenshot when the plan assertion passes, even with screenshotDir configured", async () => {
  const screenshotDir = mkdtempSync(join(tmpdir(), "qa-screenshot-test-"));
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-screenshot-passed", planFor("passed")]]),
    screenshotDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-screenshot", attempt_id: "attempt-screenshot-passed" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.ok(result.value.evidence.every((e) => !e.endsWith(".png")), "screenshot capture SHALL be failure-only, not unconditional");
});

test("start does not attempt screenshot capture when screenshotDir is not configured", async () => {
  const engine = makeEngine(new Map([["attempt-no-screenshot-dir", planFor("failed")]]));
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-screenshot", attempt_id: "attempt-no-screenshot-dir" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.evidence.length, 1, "opt-in default (no screenshotDir) SHALL keep today's capture_id-only evidence");
});

test("a screenshotDir that cannot be written to is swallowed — start still resolves ok with the real outcome, not a screenshot-capture failure", async () => {
  // A regular file, not a directory, at the screenshotDir path: mkdir(recursive) over
  // an existing file fails, so page.screenshot({ path }) inside it can never succeed.
  const parent = mkdtempSync(join(tmpdir(), "qa-screenshot-test-"));
  const unwritableScreenshotDir = join(parent, "not-a-directory");
  writeFileSync(unwritableScreenshotDir, "not a directory");

  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-screenshot-unwritable", planFor("failed")]]),
    screenshotDir: unwritableScreenshotDir,
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-screenshot", attempt_id: "attempt-screenshot-unwritable" };

  const result = await engine.start(startRequestFor(attempt, "failed"), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "failed");
  assert.equal(result.value.evidence.length, 1, "screenshot capture failure SHALL be swallowed, not propagated as a start() failure");
});

test("start fails closed with infrastructure_failure when the browser cannot launch (ADR-022 §4)", async () => {
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([["attempt-launch-fails", planFor("passed")]]),
    launchBrowser: async () => {
      throw new Error("no browser binary installed");
    },
  });
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-launch", attempt_id: "attempt-launch-fails" };

  const result = await engine.start(startRequestFor(attempt, "passed"), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.code, "infrastructure_failure");
  assert.equal(result.failure.retryable, true);
});
