import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
      include_report_html: true,
      include_video: true,
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
  assert.equal(executed.value.cleanup_status, "completed");

  const output = executed.value.output as {
    test_cases: Array<{ test_case_id: string; variant: string; outcome: string; skip_reason: string | null; evidence: string[] }>;
    summary: { generated: number; executed: number; passed: number; failed: number; flaky: number; not_executed: number };
    release_recommendation: string;
    draft_defects: Array<{ id: string; classification: string; confirmed_cause: string | null }>;
    residual_risks: unknown[];
    variant_coverage: unknown[];
    report_html: string;
    report_path: string | null;
    evidence_manifest_path: string;
    testcase_results_json_path: string;
    testcase_results_csv_path: string;
    evidence_capture_status: { status: string; video_policy: string; expected_video_count: number; captured_video_count: number; warnings: string[] };
    report_html_omitted?: boolean;
  } | null;
  assert.ok(output, "expected a QaRunReport output");

  // One shared positive case for the criterion, plus per editable field 5
  // unconditional variants (negative/boundary/empty/whitespace/unicode) + 0
  // type_confusion (neither Username nor Password looks numeric) + 4
  // adversarial probes = 9 per field, 2 fields x 9 = 18, +1 positive = 19.
  assert.equal(output!.test_cases.length, 19, JSON.stringify(output!.test_cases, null, 2));
  assert.equal(output!.summary.generated, 19);
  assert.equal(output!.summary.executed, 19, "every generated case has a generated assertion and SHALL execute, not be skipped");
  assert.equal(output!.summary.not_executed, 0);

  // Negative/boundary/edge-case/adversarial variants carry their own fixed
  // probe values (never the real credentials) — the login fixture correctly
  // rejects them, so their forbidden_text assertion ("Welcome" absent)
  // SHALL pass for real, proving the pipeline actually drove a browser
  // rather than fabricating an outcome.
  const nonPositive = output!.test_cases.filter((testCase) => testCase.variant !== "positive");
  assert.equal(nonPositive.length, 18);
  for (const testCase of nonPositive) {
    assert.equal(testCase.outcome, "passed", `${testCase.test_case_id} (${testCase.variant}) should pass: ${JSON.stringify(testCase)}`);
  }

  // The positive variant's blank credentials (SPEC-207 §6: never invented)
  // correctly fail to authenticate against the real fixture — this proves
  // the executor is not fabricating a "passed" outcome either.
  const positive = output!.test_cases.find((testCase) => testCase.variant === "positive")!;
  assert.equal(positive.outcome, "failed", JSON.stringify(positive));
  for (const testCase of output!.test_cases) {
    const videoPath = testCase.evidence.find((e: string) => e.endsWith(".webm"));
    assert.ok(videoPath, `${testCase.test_case_id} should carry opted-in video evidence`);
    assert.ok(existsSync(videoPath!), `video evidence should exist: ${videoPath}`);
  }

  // Phase 4 Senior-QA surfaces: failed positive → draft defect + non-green gate.
  assert.ok(output!.draft_defects.length >= 1);
  assert.ok(output!.draft_defects.every((d) => d.confirmed_cause === null));
  assert.equal(output!.release_recommendation, "changes_required");
  assert.ok(Array.isArray(output!.variant_coverage) && output!.variant_coverage.length > 0);
  assert.ok(Array.isArray(output!.residual_risks) && output!.residual_risks.length > 0);

  assert.ok(output!.report_html.includes("QA run report"));
  assert.ok(output!.report_html.includes("Release gate:"));
  assert.ok(output!.report_html.includes("19"), "rendered HTML should surface the generated count");
  assert.equal(output!.report_html_omitted, false);
  assert.equal(output!.report_path, null, "no output_path was supplied");
  assert.ok(existsSync(output!.evidence_manifest_path), "full run should write a compact evidence integrity manifest");
  assert.ok(existsSync(output!.testcase_results_json_path), "full run should return a reusable testcase JSON artifact");
  assert.ok(existsSync(output!.testcase_results_csv_path), "full run should return a tester-friendly testcase CSV artifact");
  assert.equal(output!.evidence_capture_status.status, "partial", "a failed case that entered a password must omit its unsafe Playwright trace");
  assert.ok(output!.evidence_capture_status.warnings.some((warning) => warning.includes("trace evidence")));
  assert.equal(output!.evidence_capture_status.video_policy, "all");
  assert.equal(output!.evidence_capture_status.expected_video_count, output!.evidence_capture_status.captured_video_count);

  // Decision 1 (Option A): even with no output_path (JSON-only mode), a
  // real screenshot file is written for the one failing (positive-variant)
  // test case, under the default `<cwd>/.qa-screenshots/<operation_id>/`
  // directory — the JSON evidence array carries its real absolute path.
  const screenshotPath = positive.evidence.find((e: string) => e.endsWith(".png"));
  assert.ok(screenshotPath, "the failing positive-variant test case should carry real screenshot evidence even in JSON-only mode");
  assert.ok(existsSync(screenshotPath!), "the screenshot evidence path should be a real file written to disk");
  const stats = await stat(screenshotPath!);
  assert.ok(stats.size > 0);
  assert.ok(
    screenshotPath!.includes(join(".qa-screenshots", "operation-runtime-execute")),
    `expected the screenshot path to live under the default .qa-screenshots/<operation_id> directory, got: ${screenshotPath}`,
  );
  assert.ok(output!.report_html.includes(`file://${screenshotPath}`), "the inline report_html should embed the same screenshot as a file:// <img>");

  await rm(join(process.cwd(), ".qa-screenshots"), { recursive: true, force: true });
  await rm(join(process.cwd(), ".qa-videos"), { recursive: true, force: true });
});

test("run_auto_qa writes the HTML report to output_path when supplied", async () => {
  const perms = permissions();
  const authorizer = makeAuthorizer(perms);
  const discoverUiSurface = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLogin = new DiscoverAfterLogin({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });
  const workspaceContext = context(perms);

  const tempDir = await mkdtemp(join(tmpdir(), "qa-intelligence-auto-qa-"));
  const outputPath = join(tempDir, "nested", "report.html");

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
          outputBaseDir: tempDir,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
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
        output_path: "nested/report.html",
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

    const output = executed.value.output as {
      report_path: string | null;
      report_html?: string;
      report_html_omitted?: boolean;
      release_recommendation?: string;
      draft_defects?: unknown[];
      test_cases: Array<{ variant: string; evidence: string[]; outcome: string }>;
    } | null;
    assert.equal(output!.report_path, outputPath);
    assert.equal(output!.report_html, undefined, "HTML stays on disk — omit from MCP JSON by default");
    assert.equal(output!.report_html_omitted, true);
    assert.ok(typeof output!.release_recommendation === "string");
    assert.ok(Array.isArray(output!.draft_defects));
    // Fixture positive case intentionally fails (wrong credentials path) —
    // the pipeline SHALL draft at least one defect and must not claim recommend_release.
    assert.ok((output!.draft_defects?.length ?? 0) > 0);
    assert.notEqual(output!.release_recommendation, "recommend_release");

    const written = await readFile(outputPath, "utf8");
    assert.ok(written.includes("<!doctype html>"));
    assert.ok(written.includes("QA run report"));
    assert.ok(written.includes("Release gate:"));
    assert.ok(written.includes("Draft defects (SPEC-211)"));

    // With output_path supplied, screenshots live in a sibling directory
    // next to the report HTML (dirname(outputPath)/.qa-screenshots/...),
    // not the JSON-only-mode default location.
    const positive = output!.test_cases.find((testCase) => testCase.variant === "positive")!;
    const screenshotPath = positive.evidence.find((e) => e.endsWith(".png"));
    assert.ok(screenshotPath, "the failing positive-variant test case should carry real screenshot evidence");
    assert.ok(existsSync(screenshotPath!));
    assert.ok(
      screenshotPath!.startsWith(join(dirname(outputPath), ".qa-screenshots")),
      `expected the screenshot to live under dirname(outputPath)/.qa-screenshots, got: ${screenshotPath}`,
    );
    assert.ok(written.includes(`file://${screenshotPath}`), "the written HTML report should embed the same screenshot as a file:// <img>");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("run_auto_qa rejects an output_path that escapes the configured output directory", async () => {
  const perms = permissions();
  const authorizer = makeAuthorizer(perms);
  const discoverUiSurface = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLogin = new DiscoverAfterLogin({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });
  const workspaceContext = context(perms);

  const tempDir = await mkdtemp(join(tmpdir(), "qa-intelligence-auto-qa-"));

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
          outputBaseDir: tempDir,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  try {
    const started = await runtime.start({
      schema_version: "1.0.0",
      operation_id: "operation-runtime-start",
      workspace_id: WORKSPACE_ID,
      actor_id: workspaceContext.actor_id,
      workspace_context: workspaceContext,
      agent: AGENT,
      purpose: "Attempt to write the HTML report outside the configured output directory.",
      consequence_class: "reversible",
      input: {
        url: LOGIN_PAGE,
        acceptance_criteria: [
          { id: "AC-1", statement: 'The "Sign in" action authenticates a user who entered valid Username and Password.', expected_text: "Welcome" },
        ],
        output_path: "../escaped-report.html",
      },
      allowed_skills: [SKILL],
      allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }, { id: "playwright-dom-pipeline", version: "0.1.0" }],
      policy_version: workspaceContext.policy_version,
      budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
      deadline: "2026-08-07T09:10:00.000Z",
      idempotency_key: "auto-qa-traversal-start-001",
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
      idempotency_key: "auto-qa-traversal-execute-001",
    });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    if (!executed.ok) return;
    assert.equal(executed.value.outcome, "failed", JSON.stringify(executed.value, null, 2));
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
