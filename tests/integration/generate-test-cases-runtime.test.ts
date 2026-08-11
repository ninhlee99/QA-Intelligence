import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { InMemoryRequirementResolver } from "../../src/adapters/memory/requirement-resolver.js";
import { DiscoverUiSurface } from "../../src/discovery/discover-ui-surface.js";
import { GenerateTestCases } from "../../src/test-design/generate-test-cases.js";
import { GenerateTestCasesRuntimeExecutor } from "../../src/test-design/runtime-executor.js";
import type { Requirement, WorkspaceContext } from "../../src/requirement-review/public.js";
import { CompositeAgentRunExecutor } from "../../src/runtime/composite-executor.js";
import type { AgentRunExecutor } from "../../src/runtime/executor.js";
import {
  InMemoryAgentRuntime,
  type IdFactory as RuntimeIdFactory,
} from "../../src/runtime/in-memory-agent-runtime.js";

const NOW = "2026-08-07T08:00:00.000Z";
const WORKSPACE_ID = "workspace-test-design-001";
const AGENT = { id: "test-case-generation-agent", version: "0.1.0" } as const;
const SKILL = { id: "generate-test-cases", version: "0.1.0" } as const;
const REQUIREMENT_REF = "REQ-LOGIN-001@1.0.0";

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
    if (scope === "test-case") return `test-case-${++this.#testCase}`;
    return `finding-${++this.#finding}`;
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
    roles: ["test-designer"],
    permissions: [...permissions],
    policy_version: "test-policy@0.1.0",
    request_id: "request-test-design-001",
    correlation_id: "correlation-test-design-001",
    audience: ["qa-intelligence-test"],
    environment: "test",
    issued_at: "2026-08-07T07:00:00.000Z",
    expires_at: "2026-08-07T09:00:00.000Z",
    issuer: "https://identity.test.invalid",
    integrity_proof: "",
  };
  return { ...unsigned, integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)) };
}

function requirement(): Requirement {
  return {
    id: "REQ-LOGIN-001",
    version: "1.0.0",
    status: "in_review",
    title: "User can sign in",
    statement: "The platform shall let a registered user sign in with valid credentials.",
    source: ["product-brief@1.0.0"],
    owner: "Product Requirements",
    capability_id: "authentication",
    scope: { workspace_id: WORKSPACE_ID },
    acceptance_criteria: [
      {
        id: "AC-1",
        statement: 'The "Sign in" action authenticates a user who has entered valid Username and Password.',
        expected_text: "Welcome",
      },
      { id: "AC-2", statement: "The system remembers the last visited page after a browser refresh." },
    ],
    traceability: [{ relationship: "derived_from", target_id: "product-brief@1.0.0" }],
  };
}

const LOGIN_PAGE = `data:text/html,${encodeURIComponent(
  '<html><body><h1>Sign in</h1><input aria-label="Username"/><input aria-label="Password"/><button aria-label="Sign in">Sign in</button></body></html>',
)}`;

test("generates TestCases bound to discovered UI elements, and reports an unbindable criterion as a finding instead of fabricating one", async () => {
  const permissions = ["agent:execute", "agent:read", "requirement:read", "discovery:observe", "test-case:create"];
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
  const requirements = new InMemoryRequirementResolver(WORKSPACE_ID, [requirement()], authorizer);

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new GenerateTestCasesRuntimeExecutor({
          requirements,
          discovery,
          generator,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(permissions);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Generate test cases for REQ-LOGIN-001 against the discovered login page.",
    consequence_class: "advisory",
    input: { requirement_ref: REQUIREMENT_REF, url: LOGIN_PAGE },
    allowed_skills: [SKILL],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "generate-test-cases-start-001",
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
    idempotency_key: "generate-test-cases-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

  const output = executed.value.output as {
    test_cases: Array<{ id: string; traceability: string[]; steps: Array<{ action: string; input: Record<string, string> }>; expected_results: Array<{ assertion: string; authority: string }>; tags: string[] }>;
    findings: Array<{ category: string; message: string }>;
    generated_assertions: Array<{ test_case_id: string; expected_text: string | null; forbidden_text: string[] }>;
  } | null;
  assert.ok(output, "expected a TestCaseGenerationResult output");

  // AC-1 binds to the discovered "Sign in" action + Username/Password
  // fields and declared expected_text: 1 positive case, plus per editable
  // field 5 unconditional variants (negative/boundary/empty/whitespace/
  // unicode) + 0 type_confusion (neither field name looks numeric) + 4
  // adversarial probes = 9 per field, 2 fields x 9 = 18, +1 positive = 19.
  assert.equal(output!.test_cases.length, 19, JSON.stringify(output!.test_cases, null, 2));
  const positive = output!.test_cases.find((testCase) => testCase.tags.includes("positive"))!;
  assert.ok(positive, "expected a positive-variant test case");
  assert.ok(positive.traceability.includes(`${REQUIREMENT_REF}#AC-1`));
  assert.ok(positive.expected_results[0]!.authority.includes("AC-1"));
  assert.ok(positive.steps.some((step) => step.action === "click" && step.input["accessible_name"] === "Sign in"));

  const positiveAssertion = output!.generated_assertions.find((assertion) => assertion.test_case_id === positive.id)!;
  assert.ok(positiveAssertion, "expected a generated assertion for the positive case");
  assert.equal(positiveAssertion.expected_text, "Welcome");

  const negativeCases = output!.test_cases.filter((testCase) => testCase.tags.includes("negative"));
  assert.equal(negativeCases.length, 2, "expected one negative case per editable field");
  const boundaryCases = output!.test_cases.filter((testCase) => testCase.tags.includes("boundary"));
  assert.equal(boundaryCases.length, 2);
  const emptyCases = output!.test_cases.filter((testCase) => testCase.tags.includes("empty"));
  assert.equal(emptyCases.length, 2);
  const whitespaceCases = output!.test_cases.filter((testCase) => testCase.tags.includes("whitespace"));
  assert.equal(whitespaceCases.length, 2);
  const unicodeCases = output!.test_cases.filter((testCase) => testCase.tags.includes("unicode"));
  assert.equal(unicodeCases.length, 2);
  const typeConfusionCases = output!.test_cases.filter((testCase) => testCase.tags.includes("type_confusion"));
  assert.equal(typeConfusionCases.length, 0, "neither Username nor Password looks numeric, so type_confusion SHALL NOT be fabricated");
  const adversarialCases = output!.test_cases.filter((testCase) => testCase.tags.includes("adversarial"));
  assert.equal(adversarialCases.length, 8, "4 adversarial probes x 2 editable fields");

  // Regression guard for the fixed latent bug: each adversarial case's
  // forbidden_text SHALL match the exact value that was actually injected
  // as its own step input — under the old shared-forbidden-list design,
  // most entries here were never submitted, so this assertion would have
  // passed vacuously regardless of what the page actually did.
  const allGeneratedAssertions = output!.generated_assertions;
  for (const adversarialCase of adversarialCases) {
    const injectedValue: string | undefined = adversarialCase.steps.find((step) => step.action === "type" && step.input["value"] !== undefined)?.input["value"];
    const matchingAssertion = allGeneratedAssertions.find((assertion) => assertion.test_case_id === adversarialCase.id);
    assert.ok(matchingAssertion, `expected a generated assertion for adversarial case ${adversarialCase.id}`);
    assert.ok(injectedValue, `expected adversarial case ${adversarialCase.id} to have injected a value`);
    assert.equal(matchingAssertion!.forbidden_text[0], injectedValue, "forbidden_text SHALL assert absence of the exact value that was injected, not an unrelated probe");
  }

  // AC-2 mentions no discovered element ("last visited page" / "browser refresh") — reported as a finding, not fabricated.
  assert.equal(output!.findings.length, 1, JSON.stringify(output!.findings, null, 2));
  assert.equal(output!.findings[0]!.category, "unbindable_criterion");
  assert.ok(output!.findings[0]!.message.includes("AC-2"));
});

test("generates TestCases from inline acceptance_criteria against a real external page, without any seeded Requirement or URL", async () => {
  const permissions = ["agent:execute", "agent:read", "discovery:observe", "test-case:create"];
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
  // No requirement is seeded into this resolver — the inline path SHALL
  // NOT need it. A denying resolver proves the executor never falls
  // through to it when acceptance_criteria is supplied inline.
  const requirements = new InMemoryRequirementResolver(WORKSPACE_ID, [], authorizer);

  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map([
      [
        AGENT.id,
        new GenerateTestCasesRuntimeExecutor({ requirements, discovery, generator, expected_agent: AGENT, expected_skill: SKILL }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, new RuntimeSequenceIds(), authorizer, executor);
  const workspaceContext = context(permissions);

  const started = await runtime.start({
    schema_version: "1.0.0",
    operation_id: "operation-runtime-start",
    workspace_id: WORKSPACE_ID,
    actor_id: workspaceContext.actor_id,
    workspace_context: workspaceContext,
    agent: AGENT,
    purpose: "Generate test cases from ad hoc inline criteria against a real external page.",
    consequence_class: "advisory",
    input: {
      requirement_ref: "AD-HOC-001@1.0.0",
      requirement_title: "example.com has a Learn more link",
      url: "https://example.com",
      acceptance_criteria: [
        { id: "AC-1", statement: 'The "Learn more" action is present and reachable.', expected_text: "Example Domain" },
      ],
    },
    allowed_skills: [SKILL],
    allowed_tools: [],
    policy_version: workspaceContext.policy_version,
    budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
    deadline: "2026-08-07T09:00:00.000Z",
    idempotency_key: "generate-test-cases-inline-start-001",
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
    idempotency_key: "generate-test-cases-inline-execute-001",
  });
  assert.equal(executed.ok, true, JSON.stringify(executed));
  if (!executed.ok) return;
  assert.equal(executed.value.outcome, "completed", JSON.stringify(executed.value, null, 2));

  const output = executed.value.output as { test_cases: Array<{ tags: string[]; traceability: string[] }> } | null;
  assert.ok(output, "expected a TestCaseGenerationResult output");
  const positive = output!.test_cases.find((testCase) => testCase.tags.includes("positive"));
  assert.ok(positive, "expected the real example.com Learn more link to bind to a positive test case");
  assert.ok(positive!.traceability.includes("AD-HOC-001@1.0.0#AC-1"));
});
