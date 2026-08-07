import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import { DiscoverAfterLogin } from "../../src/discovery/discover-after-login.js";
import { GenerateTestCases } from "../../src/test-design/generate-test-cases.js";
import { RunAutoQaPipelineRuntimeExecutor } from "../../src/test-design/run-auto-qa-pipeline-runtime-executor.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T09:00:00.000Z";
const WORKSPACE_ID = "workspace-auto-qa-001";
const AGENT = { id: "auto-qa-pipeline-agent", version: "0.1.0" } as const;
const SKILL = { id: "run-auto-qa-pipeline", version: "0.1.0" } as const;

const clock = { now: (): Date => new Date(NOW) };

class RuntimeSequenceIds implements RuntimeIdFactory {
  #run = 0;
  #event = 0;
  next(kind: "run" | "event"): string {
    if (kind === "run") return `run-${++this.#run}`;
    return `event-${++this.#event}`;
  }
}

class GenIds {
  #testCase = 0;
  #finding = 0;
  next(scope: "test-case" | "finding"): string {
    return scope === "test-case" ? `test-case-${++this.#testCase}` : `finding-${++this.#finding}`;
  }
}

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function context(permissions: readonly string[]): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "actor-001",
    actor_type: "human",
    roles: ["qa-operator"],
    permissions: [...permissions],
    policy_version: "test-policy@0.1.0",
    request_id: "request-auto-qa-001",
    correlation_id: "correlation-auto-qa-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T08:00:00.000Z",
    expires_at: "2026-08-07T10:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return { ...unsigned, integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)) };
}

const LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<html><body>
  <h1>Sign in</h1>
  <label for="u">Username</label><input id="u" type="text"/>
  <label for="p">Password</label><input id="p" type="password"/>
  <button aria-label="Sign in" onclick="
    if (document.getElementById('u').value === 'real-user' &amp;&amp; document.getElementById('p').value === 'real-pass') {
      document.body.innerHTML = '<h1>Welcome</h1>';
    } else {
      document.body.innerHTML = '<h1>Invalid credentials</h1>';
    }
  ">Sign in</button>
</body></html>
`)}`;

function permissions(): readonly string[] {
  return [
    "agent:execute",
    "agent:read",
    "discovery:observe",
    "test-case:create",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
  ];
}

function makeAuthorizer(perms: readonly string[]): DeterministicWorkspaceAuthorizer {
  return new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions: perms },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });
}

test("run_auto_qa discovers, generates, executes, and reports on a real page in one call — negative/boundary/adversarial variants pass for real, and an HTML report is produced", async () => {
  const perms = permissions();
  const authorizer = makeAuthorizer(perms);
  const discoverUiSurface = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLogin = new DiscoverAfterLogin({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new RunAutoQaPipelineRuntimeExecutor({
          clock,
          authorizer,
          discoverUiSurface,
          discoverAfterLogin,
          generator,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(perms);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Run the full auto-QA pipeline against a real login page.",
    consequence_class: "reversible",
    input: {
      url: LOGIN_PAGE,
      requirement_ref: "REQ-AUTO-QA-001@1.0.0",
      requirement_title: "Sign in",
      acceptance_criteria: [
        { id: "AC-1", statement: 'The "Sign in" action authenticates a user who entered valid Username and Password.', expected_text: "Welcome" },
      ],
    },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }, { id: "playwright-dom-pipeline", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
    deadline: "2026-08-07T09:10:00.000Z",
    idempotency_key: "auto-qa-start-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const executed = await runtime.execute(started.value, {
    schema_version: "1.0.0",
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
    expected_revision: 3,
    idempotency_key: "auto-qa-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

  const output = executed.value.output as {
    test_cases: Array<{ test_case_id: string; variant: string; outcome: string; skip_reason: string | null }>;
    summary: { generated: number; executed: number; passed: number; failed: number; not_executed: number };
    report_html: string;
    report_path: string | null;
  } | null;
  assert.ok(output, "expected a QaRunReport output");

  // One shared positive case for the criterion, plus 2 editable fields x 3
  // negative/boundary/adversarial variants each = 1 + 6 = 7.
  assert.equal(output!.test_cases.length, 7, JSON.stringify(output!.test_cases, null, 2));
  assert.equal(output!.summary.generated, 7);
  assert.equal(output!.summary.executed, 7, "every generated case has a generated assertion and SHALL execute, not be skipped");
  assert.equal(output!.summary.not_executed, 0);

  // Negative/boundary/adversarial variants carry their own fixed probe
  // values (never the real credentials) — the login fixture correctly
  // rejects them, so their forbidden_text assertion ("Welcome" absent)
  // SHALL pass for real, proving the pipeline actually drove a browser
  // rather than fabricating an outcome.
  const nonPositive = output!.test_cases.filter((testCase) => testCase.variant !== "positive");
  assert.equal(nonPositive.length, 6);
  for (const testCase of nonPositive) {
    assert.equal(testCase.outcome, "passed", `${testCase.test_case_id} (${testCase.variant}) should pass: ${JSON.stringify(testCase)}`);
  }

  // The positive variant's blank credentials (SPEC-207 §6: never invented)
  // correctly fail to authenticate against the real fixture — this proves
  // the executor is not fabricating a "passed" outcome either.
  const positive = output!.test_cases.find((testCase) => testCase.variant === "positive")!;
  assert.equal(positive.outcome, "failed", JSON.stringify(positive));

  assert.ok(output!.report_html.includes("QA run report"));
  assert.ok(output!.report_html.includes("7"), "rendered HTML should surface the generated count");
  assert.equal(output!.report_path, null, "no output_path was supplied");
});

test("run_auto_qa writes the HTML report to output_path when supplied", async () => {
  const perms = permissions();
  const authorizer = makeAuthorizer(perms);
  const discoverUiSurface = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLogin = new DiscoverAfterLogin({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new RunAutoQaPipelineRuntimeExecutor({
          clock,
          authorizer,
          discoverUiSurface,
          discoverAfterLogin,
          generator,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(perms);

  const tempDir = await mkdtemp(join(tmpdir(), "qa-intelligence-auto-qa-"));
  const outputPath = join(tempDir, "nested", "report.html");
  try {
    const started = await runtime.start({
      schema_version: "1.0.0",
      operation_id: "operation-runtime-start",
      workspace_id: WORKSPACE_ID,
      actor_id: workspaceContext.actor_id,
      workspace_context: workspaceContext,
      agent: AGENT,
      purpose: "Run the full auto-QA pipeline and export the HTML report to disk.",
      consequence_class: "reversible",
      input: {
        url: LOGIN_PAGE,
        acceptance_criteria: [
          { id: "AC-1", statement: 'The "Sign in" action authenticates a user who entered valid Username and Password.', expected_text: "Welcome" },
        ],
        output_path: outputPath,
      },
      allowed_skills: [SKILL],
      allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }, { id: "playwright-dom-pipeline", version: "0.1.0" }],
      policy_version: workspaceContext.policy_version,
      budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
      deadline: "2026-08-07T09:10:00.000Z",
      idempotency_key: "auto-qa-export-start-001",
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    if (!started.ok) return;

    const executed = await runtime.execute(started.value, {
      schema_version: "1.0.0",
      operation_id: "operation-runtime-execute",
      workspace_id: WORKSPACE_ID,
      actor_id: workspaceContext.actor_id,
      policy_version: workspaceContext.policy_version,
      workspace_context: workspaceContext,
      expected_revision: 3,
      idempotency_key: "auto-qa-export-execute-001",
    });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    if (!executed.ok) return;
    assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

    const output = executed.value.output as { report_path: string | null } | null;
    assert.equal(output!.report_path, outputPath);

    const written = await readFile(outputPath, "utf8");
    assert.ok(written.includes("<!doctype html>"));
    assert.ok(written.includes("QA run report"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("run_auto_qa rejects a request with no acceptance_criteria instead of inventing what the page should do", async () => {
  const perms = permissions();
  const authorizer = makeAuthorizer(perms);
  const discoverUiSurface = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLogin = new DiscoverAfterLogin({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new RunAutoQaPipelineRuntimeExecutor({
          clock,
          authorizer,
          discoverUiSurface,
          discoverAfterLogin,
          generator,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(perms);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Run the pipeline with no acceptance criteria.",
    consequence_class: "reversible",
    input: { url: LOGIN_PAGE },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }, { id: "playwright-dom-pipeline", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
    deadline: "2026-08-07T09:10:00.000Z",
    idempotency_key: "auto-qa-invalid-start-001",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const executed = await runtime.execute(started.value, {
    schema_version: "1.0.0",
    operation_id: "operation-runtime-execute",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
    expected_revision: 3,
    idempotency_key: "auto-qa-invalid-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "failed", JSON.stringify(executed.value, null, 2));
});
