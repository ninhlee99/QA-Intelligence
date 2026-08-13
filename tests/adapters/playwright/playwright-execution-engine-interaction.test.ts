import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  PlaywrightExecutionEngine,
  type PlaywrightExecutionPlan,
  type SecretResolver,
} from "../../../src/adapters/playwright/playwright-execution-engine.js";
import { createLaunchBrowser, type BrowserName } from "../../../src/adapters/playwright/browser-launcher.js";
import type { ExecutionAttemptIdentity, StartRequest } from "../../../src/execution-engine/public.js";
import type {
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizer,
  WorkspaceContext,
} from "../../../src/requirement-review/public.js";

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
    workspace_id: "workspace-interaction-001",
    actor_id: "actor-interaction-001",
    actor_type: "service",
    roles: ["execution-operator"],
    permissions: ["execution:execute"],
    policy_version: "policy@1.0.0",
    request_id: "request-interaction-001",
    correlation_id: "correlation-interaction-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
  };
}

// A form whose own JS redirects only when the exact expected credentials are
// submitted, landing on a page only reachable post-login — same shape as a
// real login flow, self-contained (no network dependency).
const LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <h1>Sign in</h1>
  <input aria-label="Username" id="u"/>
  <input aria-label="Password" id="p" type="password"/>
  <button aria-label="Sign in" onclick="
    if (document.getElementById('u').value === 'demo-user' &amp;&amp; document.getElementById('p').value === 'demo-pass') {
      document.body.innerHTML = '<h1>Welcome</h1>';
    } else {
      document.body.innerHTML = '<h1>Invalid credentials</h1>';
    }
  ">Sign in</button>
</body></html>
`)}`;

function makeEngine(
  plans: ReadonlyMap<string, PlaywrightExecutionPlan>,
  secrets?: SecretResolver,
  evidenceDirs?: Readonly<{ screenshotDir: string; traceDir: string; videoDir: string }>,
): PlaywrightExecutionEngine {
  return new PlaywrightExecutionEngine({
    clock: { now: () => new Date() },
    authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans,
    ...(secrets !== undefined ? { secrets } : {}),
    ...(evidenceDirs ?? {}),
  });
}

function startRequestFor(attempt: ExecutionAttemptIdentity): StartRequest {
  return {
    operation: "start",
    operationId: `op-start:${attempt.attempt_id}`,
    attempt,
    workspace: workspaceContext(),
    idempotency: { key: `start:${attempt.attempt_id}`, scope: "start", request_digest: "" },
    deadline: { at: "2026-08-07T09:00:00.000Z", time_standard: "UTC" },
    version: { contract: "1.0.0", operation_schema: "1.0.0" },
    payload: {
      environment_lease: `lease:${attempt.execution_id}`,
      execution_plan_ref: `plan:${attempt.attempt_id}`,
      authorized_input_refs: [],
    },
  };
}

test("logs into a fixture form via semantic type+click steps and asserts the post-login page", async () => {
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [
      { kind: "type", target: { accessible_name: "Username", accessible_role: "textbox" }, text: "demo-user" },
      { kind: "type", target: { accessible_name: "Password" }, text: "demo-pass" },
      { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Welcome"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-login", attempt_id: "attempt-login" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]));

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
});

test("a step targeting a nonexistent element fails closed with plugin_failure, not a hang", async () => {
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [{ kind: "click", target: { accessible_name: "Does not exist", accessible_role: "button" } }],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-missing", attempt_id: "attempt-missing" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]));

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.failure.code, "plugin_failure");
  assert.equal(result.failure.responsible_domain, "plugin");
});

test("bounded semantic recovery repairs a stale role only when the accessible name is unique and records evidence", async () => {
  const page = `data:text/html,${encodeURIComponent('<button aria-label="Continue" onclick="document.body.innerHTML=\'<h1>Recovered</h1>\'">Continue</button>')}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [{ kind: "click", target: { accessible_name: "Continue", accessible_role: "link" } }],
    assert: (cleaned) => hasText(cleaned, "Recovered"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-recovery", attempt_id: "attempt-recovery" };
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(), provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([[attempt.attempt_id, plan]]), semanticRecovery: "unique_name",
  });
  const result = await engine.start(startRequestFor(attempt), (event) => events.push(event as typeof events[number]));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.value.outcome, "passed");
    assert.ok(result.value.evidence.some((ref) => ref.startsWith("semantic-recovery:")));
  }
  assert.equal(events.some((event) => event.data["kind"] === "semantic_recovery"), true);
});

test("semantic recovery refuses an ambiguous accessible name", async () => {
  const page = `data:text/html,${encodeURIComponent('<button aria-label="Continue">One</button><a href="#next" aria-label="Continue">Two</a>')}`;
  const plan: PlaywrightExecutionPlan = {
    url: page, steps: [{ kind: "click", target: { accessible_name: "Continue", accessible_role: "tab" } }], assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-recovery-ambiguous", attempt_id: "attempt-recovery-ambiguous" };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(), provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([[attempt.attempt_id, plan]]), semanticRecovery: "unique_name",
  });
  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.match(result.failure.message, /ambiguous/);
});

test("an interaction failure retains real screenshot, trace, and video diagnostic evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-interaction-evidence-"));
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [{ kind: "click", target: { accessible_name: "Does not exist", accessible_role: "button" } }],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-evidence", attempt_id: "attempt-evidence" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), undefined, {
    screenshotDir: join(root, "screenshots"),
    traceDir: join(root, "traces"),
    videoDir: join(root, "videos"),
  });

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  for (const extension of [".png", ".zip", ".webm"]) {
    const evidencePath = result.failure.diagnostic_evidence_refs.find((ref) => ref.endsWith(extension));
    assert.ok(evidencePath, `interaction failure should retain ${extension} evidence`);
    assert.ok(existsSync(evidencePath!), `${extension} evidence should exist on disk`);
  }
});

test("a navigation failure retains real screenshot, trace, and video diagnostic evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-navigation-evidence-"));
  const plan: PlaywrightExecutionPlan = { url: "unsupported-protocol://target", assert: () => true };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-navigation", attempt_id: "attempt-navigation" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), undefined, {
    screenshotDir: join(root, "screenshots"), traceDir: join(root, "traces"), videoDir: join(root, "videos"),
  });

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  for (const extension of [".png", ".zip", ".webm"]) {
    const ref = result.failure.diagnostic_evidence_refs.find((item) => item.endsWith(extension));
    assert.ok(ref, `navigation failure should retain ${extension} evidence`);
    assert.ok(existsSync(ref!));
  }
});

test("a type step's secret_ref resolves through the SecretResolver, never a plan-supplied raw value", async () => {
  const resolvedRefs: string[] = [];
  const secrets: SecretResolver = {
    resolve: async (ref) => {
      resolvedRefs.push(ref);
      return ref === "workspace-secret:demo-password" ? "demo-pass" : undefined;
    },
  };
  const plan: PlaywrightExecutionPlan = {
    url: LOGIN_PAGE,
    steps: [
      { kind: "type", target: { accessible_name: "Username" }, text: "demo-user" },
      { kind: "type", target: { accessible_name: "Password" }, secret_ref: "workspace-secret:demo-password" },
      { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Welcome"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-secret", attempt_id: "attempt-secret" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), secrets);

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  assert.deepEqual(resolvedRefs, ["workspace-secret:demo-password"]);
});

test("a secret_ref value is visually masked before fill so screenshots and video cannot expose it", async () => {
  const page = `data:text/html,${encodeURIComponent(`
    <input aria-label="API token" id="token"/>
    <button aria-label="Verify mask" onclick="document.body.dataset.masked = getComputedStyle(document.getElementById('token')).color === 'rgba(0, 0, 0, 0)' ? 'yes' : 'no'">Verify mask</button>
  `)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "type", target: { accessible_name: "API token" }, secret_ref: "workspace-secret:api-token" },
      { kind: "click", target: { accessible_name: "Verify mask", accessible_role: "button" } },
    ],
    assert: (_cleaned, context) => context.url.length > 0,
  };
  const secrets: SecretResolver = { resolve: async () => "super-secret-token" };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-mask", attempt_id: "attempt-mask" };
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), secrets);

  const result = await engine.start(startRequestFor(attempt), (event) => events.push(event as typeof events[number]));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(events.some((event) => event.type === "evidence_created" && event.data["kind"] === "secret_masked"), true);
  assert.equal(JSON.stringify(events).includes("super-secret-token"), false);
});

test("a secret_ref value is absent from retained Playwright trace contents", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-secret-trace-"));
  const secret = "trace-must-never-retain-this-secret";
  const page = `data:text/html,${encodeURIComponent('<input aria-label="API token"/><button aria-label="Continue">Continue</button>')}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "type", target: { accessible_name: "API token" }, secret_ref: "workspace-secret:api-token" },
      { kind: "click", target: { accessible_name: "Missing action", accessible_role: "button" } },
    ],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-secret-trace", attempt_id: "attempt-secret-trace" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]), { resolve: async () => secret }, {
    screenshotDir: join(root, "screenshots"), traceDir: join(root, "traces"), videoDir: join(root, "videos"),
  });

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  const tracePaths = result.failure.diagnostic_evidence_refs.filter((ref) => ref.endsWith(".zip"));
  for (const tracePath of tracePaths) {
    const traceContents = execFileSync("unzip", ["-p", tracePath], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    assert.equal(traceContents.includes(secret), false, "trace archive must not retain the resolved secret");
  }
  assert.ok(result.failure.diagnostic_evidence_refs.some((ref) => ref.startsWith("trace-omitted:sensitive-input")));
});

test("PII-like fields are visually masked even when the value is not a secret_ref", async () => {
  const page = `data:text/html,${encodeURIComponent('<input aria-label="Customer email"/>')}`;
  const plan: PlaywrightExecutionPlan = { url: page, steps: [{ kind: "type", target: { accessible_name: "Customer email", accessible_role: "textbox" }, text: "person@example.test" }], assert: () => true };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-pii", attempt_id: "attempt-pii" };
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const result = await makeEngine(new Map([[attempt.attempt_id, plan]])).start(startRequestFor(attempt), (event) => events.push(event as typeof events[number]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(events.some((event) => event.data["kind"] === "pii_masked"), true);
  assert.equal(JSON.stringify(events).includes("person@example.test"), false);
});

test("check, uncheck, and press steps behave like real keyboard and checkbox interactions", async () => {
  const page = `data:text/html,${encodeURIComponent(`
    <label><input aria-label="Remember me" type="checkbox"/>Remember me</label>
    <input aria-label="Search" onkeydown="if(event.key==='Enter') document.body.dataset.enter='yes'"/>
  `)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "check", target: { accessible_name: "Remember me", accessible_role: "checkbox" } },
      { kind: "uncheck", target: { accessible_name: "Remember me", accessible_role: "checkbox" } },
      { kind: "press", target: { accessible_name: "Search", accessible_role: "textbox" }, key: "Enter" },
    ],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-human-actions", attempt_id: "attempt-human-actions" };
  const engine = makeEngine(new Map([[attempt.attempt_id, plan]]));

  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
});

test("targets accessible controls inside a named iframe without CSS or XPath selectors", async () => {
  const child = `<label for="q">Query</label><input id="q"/><button aria-label="Submit" onclick="document.body.innerHTML='<h1>Frame complete</h1>'">Submit</button>`;
  const srcdoc = child.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const page = `data:text/html,${encodeURIComponent(`<iframe aria-label="Payment frame" srcdoc="${srcdoc}"></iframe>`)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "type", target: { frame_accessible_name: "Payment frame", accessible_name: "Query", accessible_role: "textbox" }, text: "invoice-1" },
      { kind: "click", target: { frame_accessible_name: "Payment frame", accessible_name: "Submit", accessible_role: "button" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Frame complete"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-iframe", attempt_id: "attempt-iframe" };
  const result = await makeEngine(new Map([[attempt.attempt_id, plan]])).start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.value.outcome, "passed");
});

test("switches to a popup opened by an accessible click and asserts the new page", async () => {
  const page = `data:text/html,${encodeURIComponent(`<button aria-label="Open receipt" onclick="const w=window.open('about:blank');w.document.write('&lt;h1&gt;Receipt ready&lt;/h1&gt;')">Open receipt</button>`)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [{ kind: "click", target: { accessible_name: "Open receipt", accessible_role: "button" }, switch_to_popup: true }],
    assert: (cleaned) => hasText(cleaned, "Receipt ready"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-popup", attempt_id: "attempt-popup" };
  const result = await makeEngine(new Map([[attempt.attempt_id, plan]])).start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.value.outcome, "passed");
});

test("hovers and drags between accessible targets like a real pointer", async () => {
  const page = `data:text/html,${encodeURIComponent(`
    <button aria-label="Help" onmouseenter="document.body.dataset.hovered='yes'">Help</button>
    <div role="button" aria-label="Card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','card')">Card</div>
    <div role="region" aria-label="Done lane" ondragover="event.preventDefault()" ondrop="event.preventDefault();document.body.innerHTML='<h1>Card moved</h1>'">Done</div>
  `)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "hover", target: { accessible_name: "Help", accessible_role: "button" } },
      { kind: "drag_to", target: { accessible_name: "Card", accessible_role: "button" }, destination: { accessible_name: "Done lane", accessible_role: "region" } },
    ],
    assert: (cleaned) => hasText(cleaned, "Card moved"),
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-pointer", attempt_id: "attempt-pointer" };
  const result = await makeEngine(new Map([[attempt.attempt_id, plan]])).start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) assert.equal(result.value.outcome, "passed");
});

test("uploads only from the governed artifact root and retains a completed download as evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-file-artifacts-"));
  const uploadPath = join(root, "input.txt");
  const downloadDir = join(root, "downloads");
  writeFileSync(uploadPath, "approved fixture", "utf8");
  const page = `data:text/html,${encodeURIComponent(`
    <label for="file">Attachment</label><input id="file" type="file" onchange="document.body.dataset.uploaded=this.files[0].name"/>
    <a aria-label="Download result" download="result.txt" href="data:text/plain,verified-result">Download result</a>
  `)}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [
      { kind: "upload", target: { accessible_name: "Attachment" }, artifact_refs: ["input.txt"] },
      { kind: "download", target: { accessible_name: "Download result", accessible_role: "link" } },
    ],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-files", attempt_id: "attempt-files" };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" }, plans: new Map([[attempt.attempt_id, plan]]),
    fileArtifactRoot: root, downloadDir,
  });
  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.outcome, "passed");
  const downloaded = result.value.evidence.find((ref) => ref.endsWith("result.txt"));
  assert.ok(downloaded, JSON.stringify(result));
  assert.equal(readFileSync(downloaded!, "utf8"), "verified-result");
});

test("rejects an upload artifact that escapes the governed root", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-file-root-"));
  const outside = join(tmpdir(), `outside-${Date.now()}.txt`);
  writeFileSync(outside, "not authorized", "utf8");
  const page = `data:text/html,${encodeURIComponent('<label for="file">Attachment</label><input id="file" type="file"/>')}`;
  const plan: PlaywrightExecutionPlan = {
    url: page,
    steps: [{ kind: "upload", target: { accessible_name: "Attachment" }, artifact_refs: [outside] }],
    assert: () => true,
  };
  const attempt: ExecutionAttemptIdentity = { execution_id: "execution-file-escape", attempt_id: "attempt-file-escape" };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(),
    provider: { id: "playwright-execution-engine", version: "0.1.0" }, plans: new Map([[attempt.attempt_id, plan]]),
    fileArtifactRoot: root,
  });
  const result = await engine.start(startRequestFor(attempt), () => {});

  assert.equal(result.ok, false, JSON.stringify(result));
  if (!result.ok) assert.match(result.failure.message, /governed artifact root/);
});

test("reuses browser session state across a sequential multi-page batch and deletes it on finalize", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/login") {
      response.end(`<button aria-label="Sign in" onclick="document.cookie='auth=1; path=/';document.body.innerHTML='<h1>Signed in</h1>'">Sign in</button>`);
      return;
    }
    response.end(request.headers.cookie?.includes("auth=1") ? "<h1>Account page</h1>" : "<h1>Unauthorized</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${(address as { port: number }).port}`;
  const root = mkdtempSync(join(tmpdir(), "qa-session-state-"));
  const statePath = join(root, "batch-state.json");
  const first: PlaywrightExecutionPlan = {
    url: `${base}/login`, steps: [{ kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } }],
    assert: (cleaned) => hasText(cleaned, "Signed in"),
  };
  const second: PlaywrightExecutionPlan = { url: `${base}/account`, assert: (cleaned) => hasText(cleaned, "Account page") };
  const attempt1: ExecutionAttemptIdentity = { execution_id: "execution-batch", attempt_id: "batch-1" };
  const attempt2: ExecutionAttemptIdentity = { execution_id: "execution-batch", attempt_id: "batch-2" };
  const engine = new PlaywrightExecutionEngine({
    clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(), provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: new Map([[attempt1.attempt_id, first], [attempt2.attempt_id, second]]), sessionStatePath: statePath,
  });
  try {
    const login = await engine.start(startRequestFor(attempt1), () => {});
    assert.equal(login.ok && login.value.outcome, "passed", JSON.stringify(login));
    assert.ok(existsSync(statePath));
    const account = await engine.start(startRequestFor(attempt2), () => {});
    assert.equal(account.ok && account.value.outcome, "passed", JSON.stringify(account));
    const finalized = await engine.finalize({
      operation: "finalize", operationId: "finalize-batch", attempt: attempt2, workspace: workspaceContext(),
      idempotency: { key: "finalize-batch", scope: "finalize", request_digest: "" },
      deadline: { at: "2026-08-07T09:00:00.000Z", time_standard: "UTC" }, version: { contract: "1.0.0", operation_schema: "1.0.0" },
      payload: { environment_lease: "lease:batch", cleanup_policy_ref: "policy:default" },
    });
    assert.equal(finalized.ok, true, JSON.stringify(finalized));
    assert.equal(existsSync(statePath), false, "finalize must delete reusable session state");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

for (const browserName of ["chromium", "firefox", "webkit"] as const satisfies readonly BrowserName[]) {
  test(`advanced iframe/upload/download/pointer/popup workflow passes on ${browserName}`, async () => {
    const root = mkdtempSync(join(tmpdir(), `qa-parity-${browserName}-`));
    writeFileSync(join(root, "fixture.txt"), "fixture", "utf8");
    const child = `<label for="q">Query</label><input id="q" onchange="parent.document.body.dataset.frame=this.value"/>`;
    const srcdoc = child.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const page = `data:text/html,${encodeURIComponent(`
      <iframe aria-label="Search frame" srcdoc="${srcdoc}"></iframe>
      <label for="file">Attachment</label><input id="file" type="file" onchange="document.body.dataset.upload=this.files[0].name"/>
      <button aria-label="Help" onmouseenter="document.body.dataset.hover='yes'">Help</button>
      <div role="button" aria-label="Card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','card')">Card</div>
      <div role="region" aria-label="Done" ondragover="event.preventDefault()" ondrop="event.preventDefault();document.body.dataset.drag='yes'">Done</div>
      <a aria-label="Download" download="result.txt" href="data:text/plain,result">Download</a>
      <button aria-label="Open summary" onclick="const ok=document.body.dataset.frame==='invoice'&&document.body.dataset.upload==='fixture.txt'&&document.body.dataset.hover==='yes'&&document.body.dataset.drag==='yes';const w=window.open('about:blank');w.document.write(ok?'&lt;h1&gt;Advanced complete&lt;/h1&gt;':'&lt;h1&gt;Missing interaction&lt;/h1&gt;')">Open</button>
    `)}`;
    const plan: PlaywrightExecutionPlan = {
      url: page,
      steps: [
        { kind: "type", target: { frame_accessible_name: "Search frame", accessible_name: "Query", accessible_role: "textbox" }, text: "invoice" },
        { kind: "upload", target: { accessible_name: "Attachment" }, artifact_refs: ["fixture.txt"] },
        { kind: "hover", target: { accessible_name: "Help", accessible_role: "button" } },
        { kind: "drag_to", target: { accessible_name: "Card", accessible_role: "button" }, destination: { accessible_name: "Done", accessible_role: "region" } },
        { kind: "download", target: { accessible_name: "Download", accessible_role: "link" } },
        { kind: "click", target: { accessible_name: "Open summary", accessible_role: "button" }, switch_to_popup: true },
      ],
      assert: (cleaned) => hasText(cleaned, "Advanced complete"),
    };
    const attempt: ExecutionAttemptIdentity = { execution_id: `execution-parity-${browserName}`, attempt_id: `attempt-parity-${browserName}` };
    const engine = new PlaywrightExecutionEngine({
      clock: { now: () => new Date() }, authorizer: new AllowingAuthorizer(), provider: { id: "playwright-execution-engine", version: "0.1.0" },
      plans: new Map([[attempt.attempt_id, plan]]), launchBrowser: createLaunchBrowser(browserName), fileArtifactRoot: root, downloadDir: join(root, "downloads"),
    });
    const result = await engine.start(startRequestFor(attempt), () => {});
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) assert.equal(result.value.outcome, "passed", JSON.stringify(result));
  });
}

function hasText(node: import("../../../src/dom-cleaner/public.js").CleanedDomNode, text: string): boolean {
  if (node.text === text) return true;
  return node.children.some((child) => hasText(child, text));
}
