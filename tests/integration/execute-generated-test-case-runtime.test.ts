import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import { GenerateTestCases } from "../../src/test-design/generate-test-cases.js";
import { ExecuteGeneratedTestCaseRuntimeExecutor } from "../../src/test-design/execute-generated-test-case-runtime-executor.js";
import { writeTestcaseDesignArtifact } from "../../src/test-design/testcase-design-artifact.js";
import { appendSessionLedgerEntry } from "../../src/reporting/session-ledger.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T09:00:00.000Z";
const WORKSPACE_ID = "workspace-execute-generated-001";
const AGENT = { id: "execute-generated-test-case-agent", version: "0.1.0" } as const;
const SKILL = { id: "execute-generated-test-case", version: "0.1.0" } as const;

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
    roles: ["execution-operator"],
    permissions: [...permissions],
    policy_version: "test-policy@0.1.0",
    request_id: "request-execute-generated-001",
    correlation_id: "correlation-execute-generated-001",
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

test("executes a freshly generated TestCase end to end, filling real credentials the generator deliberately left blank", async () => {
  const permissions = ["agent:execute", "agent:read", "discovery:observe", "test-case:create", "execution:read", "execution:execute", "execution:cancel", "execution:cleanup"];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });

  // Step 1: generate against the real page (in-process, mirroring what an
  // MCP `generate_test_cases` call would produce).
  const discovery = new DiscoverUiSurface({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });
  const workspaceContext = context(permissions);
  const discovered = await discovery.discover({ operation_id: "op-discover", context: workspaceContext, url: LOGIN_PAGE });
  assert.equal(discovered.ok, true, JSON.stringify(discovered));
  if (!discovered.ok) return;

  const generated = await generator.generate({
    operation_id: "op-generate",
    workspace_id: WORKSPACE_ID,
    context: workspaceContext,
    requirement_ref: "REQ-E2E-001@1.0.0",
    requirement_title: "Sign in",
    acceptance_criteria: [
      { id: "AC-1", statement: 'The "Sign in" action authenticates a user who entered valid Username and Password.', expected_text: "Welcome" },
    ],
    ui_map_elements: discovered.value.elements,
    ui_map_source_url: discovered.value.source_url,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  if (!generated.ok) return;

  const positive = generated.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive, "expected a positive test case");
  const positiveAssertion = generated.value.generated_assertions.find((assertion) => assertion.test_case_id === positive!.id);
  assert.ok(positiveAssertion, "expected a generated assertion for the positive case");
  const artifactRoot = await mkdtemp(join(tmpdir(), "qa-qc-handoff-"));
  const artifact = await writeTestcaseDesignArtifact({
    output_dir: join(artifactRoot, ".qa-testcases", "design-1"),
    workspace_id: WORKSPACE_ID,
    requirement_ref: "REQ-E2E-001@1.0.0",
    generated_at: NOW,
    test_cases: generated.value.test_cases,
    generated_assertions: generated.value.generated_assertions,
    findings: generated.value.findings,
  });
  assert.equal(artifact.ok, true, JSON.stringify(artifact));
  if (!artifact.ok) return;

  // Step 2: execute the exact generated TestCase through the runtime,
  // supplying real credentials the generator never invented.
  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new ExecuteGeneratedTestCaseRuntimeExecutor({ clock, authorizer, expected_agent: AGENT, expected_skill: SKILL, testcaseBaseDir: artifactRoot, screenshotBaseDir: artifactRoot, ledgerBaseDir: artifactRoot }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Execute a freshly generated TestCase with real credentials.",
    consequence_class: "reversible",
    input: {
      testcase_file: artifact.path,
      test_case_id: positive!.id,
      field_values: { Username: "real-user", Password: "real-pass" },
    },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T10:00:00.000Z",
    idempotency_key: "execute-generated-start-001",
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
    idempotency_key: "execute-generated-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

  const output = executed.value.output as { outcome: string; evidence: string[]; evidence_capture_status: { screenshot_policy: string; video_policy: string; status: string } } | null;
  assert.ok(output, "expected an execution outcome output");
  assert.equal(output!.outcome, "passed", `expected the filled-in real credentials to pass: ${JSON.stringify(executed.value, null, 2)}`);
  assert.equal(output!.evidence.some((ref) => ref.endsWith(".png")), true, "standard MCP execution should automatically return pass screenshot evidence");
  assert.equal(output!.evidence.some((ref) => ref.endsWith(".webm")), false, "failure-only default should avoid storing video for a passing testcase");
  assert.deepEqual({ screenshot_policy: output!.evidence_capture_status.screenshot_policy, video_policy: output!.evidence_capture_status.video_policy, status: output!.evidence_capture_status.status }, { screenshot_policy: "all", video_policy: "failure_only", status: "complete" });
  assert.equal(output!.evidence.some((ref) => ref.startsWith("testcase-design-sha256:")), true, "QC result should retain the exact QA artifact digest");
  assert.equal(output!.evidence.includes("ledger:sequence_gap"), true, "no upstream generate_test_cases ledger entry was written for this requirement_ref, so the tag must advise the gap — never fail the call");
  await rm(artifactRoot, { recursive: true, force: true });
});

test("tags ledger:upstream_qa_present when a prior testcase ledger entry exists for the same requirement_ref", async () => {
  const permissions = ["agent:execute", "agent:read", "discovery:observe", "test-case:create", "execution:read", "execution:execute", "execution:cancel", "execution:cleanup"];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: "https://identity.test.invalid",
    expected_audience: "qa-intelligence-test",
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: "test-policy@0.1.0", permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });

  const discovery = new DiscoverUiSurface({ clock, authorizer });
  const generator = new GenerateTestCases({ authorizer, ids: new GenIds() });
  const workspaceContext = context(permissions);
  const discovered = await discovery.discover({ operation_id: "op-discover-2", context: workspaceContext, url: LOGIN_PAGE });
  assert.equal(discovered.ok, true, JSON.stringify(discovered));
  if (!discovered.ok) return;

  const generated = await generator.generate({
    operation_id: "op-generate-2",
    workspace_id: WORKSPACE_ID,
    context: workspaceContext,
    requirement_ref: "REQ-E2E-002@1.0.0",
    requirement_title: "Sign in",
    acceptance_criteria: [
      { id: "AC-1", statement: 'The "Sign in" action authenticates a user who entered valid Username and Password.', expected_text: "Welcome" },
    ],
    ui_map_elements: discovered.value.elements,
    ui_map_source_url: discovered.value.source_url,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated));
  if (!generated.ok) return;

  const positive = generated.value.test_cases.find((testCase) => testCase.tags?.includes("positive"));
  assert.ok(positive, "expected a positive test case");
  const artifactRoot = await mkdtemp(join(tmpdir(), "qa-qc-handoff-ledger-"));
  const artifact = await writeTestcaseDesignArtifact({
    output_dir: join(artifactRoot, ".qa-testcases", "design-1"),
    workspace_id: WORKSPACE_ID,
    requirement_ref: "REQ-E2E-002@1.0.0",
    generated_at: NOW,
    test_cases: generated.value.test_cases,
    generated_assertions: generated.value.generated_assertions,
    findings: generated.value.findings,
  });
  assert.equal(artifact.ok, true, JSON.stringify(artifact));
  if (!artifact.ok) return;

  const ledgerAppend = await appendSessionLedgerEntry({
    ledger_dir: join(artifactRoot, ".qa-ledger", WORKSPACE_ID, "REQ-E2E-002_1.0.0"),
    entry: {
      requirement_ref: "REQ-E2E-002@1.0.0",
      workspace_id: WORKSPACE_ID,
      skill: "testcase",
      tool: "generate_test_cases",
      run_id: "run-upstream",
      recorded_at: NOW,
      testcase_design_sha256: artifact.sha256,
    },
  });
  assert.equal(ledgerAppend.ok, true, JSON.stringify(ledgerAppend));

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new ExecuteGeneratedTestCaseRuntimeExecutor({ clock, authorizer, expected_agent: AGENT, expected_skill: SKILL, testcaseBaseDir: artifactRoot, screenshotBaseDir: artifactRoot, ledgerBaseDir: artifactRoot }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start-2",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Execute a freshly generated TestCase with an upstream ledger entry present.",
    consequence_class: "reversible",
    input: {
      testcase_file: artifact.path,
      test_case_id: positive!.id,
      field_values: { Username: "real-user", Password: "real-pass" },
    },
    allowed_skills: [SKILL],
    allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T10:00:00.000Z",
    idempotency_key: "execute-generated-start-002",
  });
  assert.equal(started.ok, true, JSON.stringify(started));
  if (!started.ok) return;

  const executed = await runtime.execute(started.value, {
    schema_version: "1.0.0",
    operation_id: "operation-runtime-execute-2",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    policy_version: workspaceContext.policy_version,
    workspace_context: workspaceContext,
    expected_revision: 3,
    idempotency_key: "execute-generated-execute-002",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;

  const output = executed.value.output as { evidence: string[] } | null;
  assert.ok(output, "expected an execution outcome output");
  assert.equal(output!.evidence.includes("ledger:upstream_qa_present"), true, "an upstream testcase ledger entry exists for this requirement_ref, so the tag must reflect that — not sequence_gap");
  await rm(artifactRoot, { recursive: true, force: true });
});
