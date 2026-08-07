#!/usr/bin/env node
/**
 * Development-only remote MCP Streamable HTTP server (ADR-020). Mirrors
 * `dev-entrypoint.ts`'s Agent Runtime wiring exactly (same reviewer, same
 * seeded requirement, same tool definition) but exposes it over
 * `StreamableHttpTransport` with real cryptographic identity instead of
 * `stdio` with a fixture proof: it mints its own ephemeral RSA keypair,
 * serves its own local JWKS endpoint, and issues real signed OIDC ID
 * tokens for two demo actors — a real end-to-end round trip through
 * `OidcWorkspaceContextIssuer` and the bearer-token verification path,
 * without depending on an external identity provider.
 *
 * This is NOT a production entrypoint: the "identity provider" is this
 * same process's own self-signed JWKS server, and
 * `DemoWorkspaceMembershipResolver` is a two-entry fixture, not governed
 * platform state (ADR-014's real membership store remains unbuilt). It
 * exists so a real MCP host can exercise the real remote transport,
 * bearer-token authentication, and Session Memory sharing end-to-end
 * during development, exactly as ADR-016 §8 and ADR-020 anticipate for
 * `stdio`'s remote counterpart.
 */
import { SignJWT } from "jose";

import { InMemoryKnowledgeSearch } from "../adapters/memory/knowledge-search.js";
import { InMemoryRequirementResolver } from "../adapters/memory/requirement-resolver.js";
import { generateSigningKey, startJwksServer } from "../adapters/oidc/jwks-fixture-server.js";
import { JwksWorkspaceIntegrityProofVerifier } from "../adapters/oidc/jwks-integrity-proof-verifier.js";
import { OidcWorkspaceContextIssuer, type MembershipRecord } from "../adapters/oidc/workspace-context-issuer.js";
import { DeterministicWorkspaceAuthorizer } from "../adapters/deterministic/workspace-authorizer.js";
import { ScriptedReasoningProvider } from "../adapters/replay/scripted-reasoning-provider.js";
import {
  AssessRequirementQuality,
  RequirementQualityRuleEngine,
} from "../requirement-review/assess-requirement-quality.js";
import { CompositeRuleEngine } from "../requirement-review/composite-rule-engine.js";
import { RequirementReviewRuntimeExecutor } from "../requirement-review/runtime-executor.js";
import { RequirementIntelligenceRuleEngine } from "../requirement-intelligence/requirement-intelligence-rule-engine.js";
import { InMemoryAgentRuntime, type IdFactory } from "../runtime/in-memory-agent-runtime.js";
import { CompositeAgentRunExecutor } from "../runtime/composite-executor.js";
import type { AgentRunExecutor } from "../runtime/executor.js";
import { SessionMemory } from "../memory/session-memory.js";
import type { JsonValue, Requirement } from "../requirement-review/public.js";
import { PlaywrightExecutionEngine, type PlaywrightExecutionPlan } from "../adapters/playwright/playwright-execution-engine.js";
import { ExecuteBrowserTest } from "../execution/execute-browser-test.js";
import { BrowserTestRuntimeExecutor } from "../execution/runtime-executor.js";
import { DiscoverUiSurface } from "../discovery/discover-ui-surface.js";
import { UiSurfaceDiscoveryRuntimeExecutor } from "../discovery/runtime-executor.js";
import { DiscoverAfterLogin } from "../discovery/discover-after-login.js";
import { DiscoverAfterLoginRuntimeExecutor } from "../discovery/discover-after-login-runtime-executor.js";
import { GenerateTestCases } from "../test-design/generate-test-cases.js";
import { GenerateTestCasesRuntimeExecutor } from "../test-design/runtime-executor.js";
import { ExecuteGeneratedTestCaseRuntimeExecutor } from "../test-design/execute-generated-test-case-runtime-executor.js";
import { RunAutoQaPipelineRuntimeExecutor } from "../test-design/run-auto-qa-pipeline-runtime-executor.js";

import { OidcBearerAuthenticator } from "./remote/oidc-bearer-authenticator.js";
import { StreamableHttpTransport } from "./remote/streamable-http-transport.js";

const WORKSPACE_ID = process.env["QA_INTELLIGENCE_DEV_WORKSPACE_ID"] ?? "workspace-remote-dev-001";
const ACTOR_ID = process.env["QA_INTELLIGENCE_DEV_ACTOR_ID"] ?? "actor-remote-dev-001";
const PORT = Number(process.env["QA_INTELLIGENCE_DEV_REMOTE_PORT"] ?? "8787");
const HOST = process.env["QA_INTELLIGENCE_DEV_REMOTE_HOST"] ?? "127.0.0.1";
const AGENT = { id: "requirement-review-agent", version: "0.1.0" } as const;
const SKILL = { id: "assess-requirement-quality", version: "0.1.0" } as const;
const BROWSER_TEST_AGENT = { id: "browser-test-execution-agent", version: "0.1.0" } as const;
const BROWSER_TEST_SKILL = { id: "execute-browser-test", version: "0.1.0" } as const;
const DEMO_TEST_CASE_REF = "TC-DEMO-001@1.0.0";
const DEMO_ENVIRONMENT_REF = "dev-fixture";
const UI_DISCOVERY_AGENT = { id: "ui-surface-discovery-agent", version: "0.1.0" } as const;
const UI_DISCOVERY_SKILL = { id: "discover-ui-surface", version: "0.1.0" } as const;
const UI_DISCOVERY_ENGINE_REF = "playwright-dom-pipeline@0.1.0";
const DISCOVER_AFTER_LOGIN_AGENT = { id: "discover-after-login-agent", version: "0.1.0" } as const;
const DISCOVER_AFTER_LOGIN_SKILL = { id: "discover-after-login", version: "0.1.0" } as const;
const TEST_CASE_GENERATION_AGENT = { id: "test-case-generation-agent", version: "0.1.0" } as const;
const TEST_CASE_GENERATION_SKILL = { id: "generate-test-cases", version: "0.1.0" } as const;
const EXECUTE_GENERATED_AGENT = { id: "execute-generated-test-case-agent", version: "0.1.0" } as const;
const EXECUTE_GENERATED_SKILL = { id: "execute-generated-test-case", version: "0.1.0" } as const;
const AUTO_QA_AGENT = { id: "auto-qa-pipeline-agent", version: "0.1.0" } as const;
const AUTO_QA_SKILL = { id: "run-auto-qa-pipeline", version: "0.1.0" } as const;
const DEMO_LOGIN_REQUIREMENT_REF = "REQ-DEMO-002@1.0.0";
const POLICY_VERSION = "dev-policy@0.1.0";
const IDP_ISSUER = "https://identity.dev.invalid";
const CONTEXT_ISSUER = "https://workspace-manager.dev.invalid";
const AUDIENCE = "qa-intelligence-remote-dev";
const MEMBERSHIP: MembershipRecord = {
  workspace_id: WORKSPACE_ID,
  actor_id: ACTOR_ID,
  actor_type: "human",
  roles: ["requirement-reviewer", "agent-operator"],
  permissions: [
    "agent:execute",
    "agent:read",
    "requirement:read",
    "knowledge:read",
    "assessment:create",
    "execution:read",
    "execution:execute",
    "execution:cancel",
    "execution:cleanup",
    "discovery:observe",
    "test-case:create",
  ],
  policy_version: POLICY_VERSION,
};

function seedRequirement(): Requirement {
  return {
    id: "REQ-DEMO-001",
    version: "1.0.0",
    status: "draft",
    title: "Lock repeated failed login attempts",
    statement: "The demo product SHALL lock authentication after the configured failed-attempt threshold.",
    source: ["DEMO-POLICY-001"],
    owner: "Demo Product Owner",
    capability_id: "Authentication",
    scope: { workspace_id: WORKSPACE_ID },
    acceptance_criteria: [{ id: "AC-1", statement: "The threshold is evaluated by an accepted deterministic rule." }],
    assumptions: [],
    traceability: [{ relationship: "governed_by", target_id: "DEMO-POLICY-001" }],
  };
}

function seedLoginRequirement(): Requirement {
  return {
    id: "REQ-DEMO-002",
    version: "1.0.0",
    status: "in_review",
    title: "User can sign in",
    statement: "The demo product SHALL let a registered user sign in with valid credentials.",
    source: ["DEMO-POLICY-001"],
    owner: "Demo Product Owner",
    capability_id: "Authentication",
    scope: { workspace_id: WORKSPACE_ID },
    acceptance_criteria: [
      { id: "AC-1", statement: 'The "Sign in" action authenticates a user who has entered a valid Username and Password.' },
    ],
    assumptions: [],
    traceability: [{ relationship: "governed_by", target_id: "DEMO-POLICY-001" }],
  };
}

function hasAccessibleText(
  node: import("../dom-cleaner/public.js").CleanedDomNode,
  expected: string,
): boolean {
  if (node.text === expected || node.accessible_name === expected) return true;
  return node.children.some((child) => hasAccessibleText(child, expected));
}

async function main(): Promise<void> {
  const clock = { now: (): Date => new Date() };

  // Two independent JWKS endpoints, mirroring the real-driver interop test
  // pattern (tests/adapters/oidc-workspace-context-issuer.real.test.ts):
  // one stands in for the upstream IdP the caller's ID token is signed
  // against, one is this Workspace Manager's own key for the integrity_proof
  // it issues on top.
  const idpKey = await generateSigningKey("idp-dev-key");
  const idp = await startJwksServer(() => [idpKey]);
  const workspaceManagerKey = await generateSigningKey("wm-dev-key");
  const workspaceManagerJwks = await startJwksServer(() => [workspaceManagerKey]);

  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: CONTEXT_ISSUER,
    expected_audience: AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: POLICY_VERSION, permissions: MEMBERSHIP.permissions },
    integrity_proof_verifier: new JwksWorkspaceIntegrityProofVerifier({
      jwks_uri: workspaceManagerJwks.url,
      expected_issuer: CONTEXT_ISSUER,
      expected_audience: AUDIENCE,
    }),
  });

  const issuer = new OidcWorkspaceContextIssuer({
    jwks_uri: idp.url,
    expected_issuer: IDP_ISSUER,
    expected_audience: AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    membership: { resolve: (actorId, workspaceId) => (actorId === MEMBERSHIP.actor_id && workspaceId === WORKSPACE_ID ? MEMBERSHIP : undefined) },
    signing_key: workspaceManagerKey.privateKey,
    signing_kid: workspaceManagerKey.kid,
    context_issuer: CONTEXT_ISSUER,
  });

  let reviewId = 0;
  const reviewer = new AssessRequirementQuality({
    authorizer,
    knowledge: new InMemoryKnowledgeSearch({
      workspace_id: WORKSPACE_ID,
      knowledge_snapshot: "0.1.0",
      projection_freshness: clock.now().toISOString(),
      records: [],
    }),
    rules: new CompositeRuleEngine([new RequirementQualityRuleEngine(), new RequirementIntelligenceRuleEngine()]),
    reasoning: new ScriptedReasoningProvider([]),
    clock,
    ids: { next: (scope): string => `${scope}-${++reviewId}` },
    configuration: {
      resolved_versions: {
        agent: `${AGENT.id}@${AGENT.version}`,
        skill: `${SKILL.id}@${SKILL.version}`,
        prompt: "requirement-assessment-prompt@0.1.0",
        rule_set: "requirement-quality@1.0.0",
        knowledge_snapshot: "0.1.0",
        policy: POLICY_VERSION,
        input_schema: "requirement.schema.json@1.0.0",
        output_schema: "requirement-assessment.schema.json@1.0.0",
      },
      limits: { knowledge_hits: 5, reasoning_tokens: 500, reasoning_cost: 0, reasoning_timeout_ms: 5_000 },
    },
  });

  // Tracer bullet (docs/proposals/SPEC-512-mcp-test-execution-tool.md).
  // TC-DEMO-001: navigate + assert only. TC-DEMO-002 (Phase 2,
  // docs/proposals/professional-qa-mcp-roadmap.md): semantic type/click
  // steps driving a real login fixture, with the password resolved through
  // `demoSecrets` rather than appearing anywhere in the plan or MCP input —
  // the seam a real environment/credential registry (Phase 3) will replace.
  // The plan Map key SHALL equal the `test_case_ref` a caller supplies (see
  // `PlaywrightExecutionEngine`'s `attempt.attempt_id` lookup).
  const demoPageUrl = `data:text/html,${encodeURIComponent(
    "<html><body><h1>QA Intelligence dev fixture</h1></body></html>",
  )}`;
  const demoLoginPageUrl = `data:text/html,${encodeURIComponent(`
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
  const DEMO_LOGIN_TEST_CASE_REF = "TC-DEMO-002@1.0.0";
  const demoSecrets = {
    resolve: async (secretRef: string): Promise<string | undefined> =>
      secretRef === "workspace-secret:demo-password" ? "demo-pass" : undefined,
  };
  const browserTestPlans = new Map<string, PlaywrightExecutionPlan>([
    [
      DEMO_TEST_CASE_REF,
      {
        url: demoPageUrl,
        assert: (cleaned) => hasAccessibleText(cleaned, "QA Intelligence dev fixture"),
      },
    ],
    [
      DEMO_LOGIN_TEST_CASE_REF,
      {
        url: demoLoginPageUrl,
        steps: [
          { kind: "type", target: { accessible_name: "Username" }, text: "demo-user" },
          { kind: "type", target: { accessible_name: "Password" }, secret_ref: "workspace-secret:demo-password" },
          { kind: "click", target: { accessible_name: "Sign in", accessible_role: "button" } },
        ],
        assert: (cleaned) => hasAccessibleText(cleaned, "Welcome"),
      },
    ],
  ]);
  const browserTestEngine = new PlaywrightExecutionEngine({
    clock,
    authorizer,
    provider: { id: "playwright-execution-engine", version: "0.1.0" },
    plans: browserTestPlans,
    secrets: demoSecrets,
  });
  const browserTestSkill = new ExecuteBrowserTest({
    engine: browserTestEngine,
    clock,
    provider_ref: "playwright-execution-engine@0.1.0",
  });
  const uiDiscoverySkill = new DiscoverUiSurface({ clock, authorizer });
  const discoverAfterLoginSkill = new DiscoverAfterLogin({ clock, authorizer });
  const requirementResolver = new InMemoryRequirementResolver(
    WORKSPACE_ID,
    [seedRequirement(), seedLoginRequirement()],
    authorizer,
  );
  let testCaseSequence = 0;
  let testCaseFindingSequence = 0;
  const testCaseGenerator = new GenerateTestCases({
    authorizer,
    ids: { next: (scope): string => (scope === "test-case" ? `test-case-${++testCaseSequence}` : `finding-${++testCaseFindingSequence}`) },
  });

  let runSequence = 0;
  let eventSequence = 0;
  const ids: IdFactory = {
    next: (kind: "run" | "event"): string => (kind === "run" ? `run-${++runSequence}` : `event-${++eventSequence}`),
  };
  const executor: AgentRunExecutor = new CompositeAgentRunExecutor(
    new Map<string, AgentRunExecutor>([
      [
        AGENT.id,
        new RequirementReviewRuntimeExecutor({
          reviewer,
          requirements: requirementResolver,
          validateAssessment: () => true,
          expected_agent: AGENT,
          expected_skill: SKILL,
        }),
      ],
      [
        BROWSER_TEST_AGENT.id,
        new BrowserTestRuntimeExecutor({
          skill: browserTestSkill,
          expected_agent: BROWSER_TEST_AGENT,
          expected_skill: BROWSER_TEST_SKILL,
        }),
      ],
      [
        UI_DISCOVERY_AGENT.id,
        new UiSurfaceDiscoveryRuntimeExecutor({
          skill: uiDiscoverySkill,
          expected_agent: UI_DISCOVERY_AGENT,
          expected_skill: UI_DISCOVERY_SKILL,
          engine_ref: UI_DISCOVERY_ENGINE_REF,
        }),
      ],
      [
        DISCOVER_AFTER_LOGIN_AGENT.id,
        new DiscoverAfterLoginRuntimeExecutor({
          skill: discoverAfterLoginSkill,
          expected_agent: DISCOVER_AFTER_LOGIN_AGENT,
          expected_skill: DISCOVER_AFTER_LOGIN_SKILL,
          engine_ref: UI_DISCOVERY_ENGINE_REF,
        }),
      ],
      [
        TEST_CASE_GENERATION_AGENT.id,
        new GenerateTestCasesRuntimeExecutor({
          requirements: requirementResolver,
          discovery: uiDiscoverySkill,
          generator: testCaseGenerator,
          expected_agent: TEST_CASE_GENERATION_AGENT,
          expected_skill: TEST_CASE_GENERATION_SKILL,
        }),
      ],
      [
        EXECUTE_GENERATED_AGENT.id,
        new ExecuteGeneratedTestCaseRuntimeExecutor({
          clock,
          authorizer,
          expected_agent: EXECUTE_GENERATED_AGENT,
          expected_skill: EXECUTE_GENERATED_SKILL,
        }),
      ],
      [
        AUTO_QA_AGENT.id,
        new RunAutoQaPipelineRuntimeExecutor({
          clock,
          authorizer,
          discoverUiSurface: uiDiscoverySkill,
          discoverAfterLogin: discoverAfterLoginSkill,
          generator: testCaseGenerator,
          expected_agent: AUTO_QA_AGENT,
          expected_skill: AUTO_QA_SKILL,
        }),
      ],
    ]),
  );
  const runtime = new InMemoryAgentRuntime(clock, ids, authorizer, executor);

  const authenticator = new OidcBearerAuthenticator({
    issuer,
    runtime,
    tools: [
      {
        name: "assess_requirement_quality",
        description:
          "Assess a requirement's quality (traceability, acceptance criteria, ambiguity) via the QA Intelligence Requirement Review Agent, over the remote Streamable HTTP transport. Development seed data only (REQ-DEMO-001).",
        inputSchema: {
          type: "object",
          properties: { requirement_ref: { type: "string", description: "e.g. REQ-DEMO-001@1.0.0" } },
          required: ["requirement_ref"],
        },
        agent: AGENT,
        purpose: "Review requirement quality via remote MCP (development)",
        consequence_class: "advisory",
        policy_version: POLICY_VERSION,
        allowed_skills: [SKILL],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "REQ-DEMO-001@1.0.0",
        }),
      },
      {
        name: "execute_browser_test",
        description:
          "Execute a governed browser test (SPEC-210/SPEC-407/SPEC-504) through the Agent Runtime and PlaywrightExecutionEngine. Development tracer bullet with seeded plans only. TC-DEMO-001: navigate + assert (read-only). TC-DEMO-002: semantic type/click steps driving a real login fixture — target elements resolve by accessible name/role, never raw selectors (ADR-022 §4), and credentials resolve through a Workspace-scoped SecretResolver, never appear in the MCP call. Raw selector interaction and free-form URLs remain out of scope.",
        inputSchema: {
          type: "object",
          properties: {
            test_case_ref: { type: "string", description: "e.g. TC-DEMO-001@1.0.0 (read-only) or TC-DEMO-002@1.0.0 (login flow)" },
            environment_ref: { type: "string", description: "e.g. dev-fixture" },
          },
          required: [],
        },
        agent: BROWSER_TEST_AGENT,
        purpose: "Execute a governed browser test via remote MCP (development tracer bullet)",
        consequence_class: "reversible",
        policy_version: POLICY_VERSION,
        allowed_skills: [BROWSER_TEST_SKILL],
        allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          test_case_ref: (args["test_case_ref"] as string | undefined) ?? DEMO_TEST_CASE_REF,
          environment_ref: (args["environment_ref"] as string | undefined) ?? DEMO_ENVIRONMENT_REF,
        }),
      },
      {
        name: "discover_ui_surface",
        description:
          "Discover a live page's Semantic UI Map (SPEC-201 §8/SPEC-101 §12: Page/Field/Action) by navigating a URL and running it through the Semantic UI pipeline (DomCleaner). Development tracer bullet: read-only observation, no interaction — Region/Validation/Navigation/Workflow/State/Permission concepts are not yet covered. Requires an explicit URL; no seed default (unlike the other two tools) because Discovery has no meaningful fixture without one.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "e.g. https://example.com/login" },
          },
          required: ["url"],
        },
        agent: UI_DISCOVERY_AGENT,
        purpose: "Discover a page's Semantic UI Map via remote MCP (development tracer bullet)",
        consequence_class: "advisory",
        policy_version: POLICY_VERSION,
        allowed_skills: [UI_DISCOVERY_SKILL],
        allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          url: (args["url"] as string | undefined) ?? "",
        }),
      },
      {
        name: "discover_ui_surface_after_login",
        description:
          "Discovers a Semantic UI Map for a screen reachable only after logging in (session/cookie-gated, not just basic-auth) — discover_ui_surface alone cannot see it because every call launches a fresh, unauthenticated browser. This tool runs one browser for the whole sequence: navigates to login_url, discovers ITS Semantic UI Map, resolves username_field_name/password_field_name/submit_action_name against that discovered map (never a raw selector), fills and submits, then navigates to target_url and discovers that screen on the exact same session. Field/action names must match what discover_ui_surface would report for the login page — call it on login_url first if unsure.",
        inputSchema: {
          type: "object",
          properties: {
            login_url: { type: "string", description: "e.g. https://your-app.example/login" },
            username_field_name: { type: "string", description: "Discovered field accessible_name, e.g. \"Username\"" },
            username: { type: "string" },
            password_field_name: { type: "string", description: "Discovered field accessible_name, e.g. \"Password\"" },
            password: { type: "string" },
            submit_action_name: { type: "string", description: "Discovered action accessible_name, e.g. \"Sign in\"" },
            target_url: { type: "string", description: "The screen to discover after login, e.g. https://your-app.example/dashboard" },
          },
          required: ["login_url", "username_field_name", "username", "password_field_name", "password", "submit_action_name", "target_url"],
        },
        agent: DISCOVER_AFTER_LOGIN_AGENT,
        purpose: "Discover a session-gated screen's Semantic UI Map via remote MCP, logging in first",
        consequence_class: "reversible",
        policy_version: POLICY_VERSION,
        allowed_skills: [DISCOVER_AFTER_LOGIN_SKILL],
        allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          login_url: (args["login_url"] as string | undefined) ?? "",
          username_field_name: (args["username_field_name"] as string | undefined) ?? "",
          username: (args["username"] as string | undefined) ?? "",
          password_field_name: (args["password_field_name"] as string | undefined) ?? "",
          password: (args["password"] as string | undefined) ?? "",
          submit_action_name: (args["submit_action_name"] as string | undefined) ?? "",
          target_url: (args["target_url"] as string | undefined) ?? "",
        }),
      },
      {
        name: "generate_test_cases",
        description:
          "Generate governed TestCases (SPEC-207 §2/§6) against a live page's discovered Semantic UI Map — composes Discovery then Test Design in one call. Per bindable, expected_text-bearing acceptance criterion, generates up to 4 variants per editable field: positive, negative (wrong value, success text must be absent), boundary (oversized input, no leaked system error), adversarial (benign XSS/SQLi probe, checked for both unescaped reflection and actual execution via dialog detection). A criterion that cannot be bound to any discovered field/action is reported as a finding, never fabricated into a test case. Two input modes: (1) pass acceptance_criteria inline — works against ANY real url, no seed data needed, e.g. {\"url\": \"https://your-real-app.example/login\", \"acceptance_criteria\": [{\"id\": \"AC-1\", \"statement\": \"...mentions a discovered field or action's name...\", \"expected_text\": \"text expected after a successful action\"}]}; (2) omit acceptance_criteria to fall back to development seed data (REQ-DEMO-002).",
        inputSchema: {
          type: "object",
          properties: {
            requirement_ref: { type: "string", description: "e.g. REQ-DEMO-002@1.0.0, or any label when acceptance_criteria is supplied inline" },
            requirement_title: { type: "string", description: "Used only with inline acceptance_criteria." },
            url: { type: "string", description: "Any real, reachable URL, e.g. https://example.com/login" },
            acceptance_criteria: {
              type: "array",
              description: "Inline ad hoc criteria (advisory consequence class — bypasses the seeded Requirement Resolver entirely). Each item needs at least id, statement, and expected_text.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  statement: { type: "string" },
                  expected_text: { type: "string" },
                },
              },
            },
          },
          required: [],
        },
        agent: TEST_CASE_GENERATION_AGENT,
        purpose: "Generate test cases via remote MCP (development tracer bullet)",
        consequence_class: "advisory",
        policy_version: POLICY_VERSION,
        allowed_skills: [TEST_CASE_GENERATION_SKILL],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? DEMO_LOGIN_REQUIREMENT_REF,
          requirement_title: (args["requirement_title"] as string | undefined) ?? "",
          url: (args["url"] as string | undefined) ?? demoLoginPageUrl,
          acceptance_criteria: (args["acceptance_criteria"] as JsonValue | undefined) ?? [],
        }),
      },
      {
        name: "execute_generated_test_case",
        description:
          "Closes the generate->execute loop: takes the exact test_case and generated_assertion objects a prior generate_test_cases call returned (copy them verbatim from its output) and runs the test case for real via PlaywrightExecutionEngine, against whatever real URL the TestCase's own navigate step already points to — works against ANY site generate_test_cases discovered, not just seeded fixtures. field_values (e.g. {\"Username\": \"...\", \"Password\": \"...\"}) fills in real data for the positive variant's blank type steps (SPEC-207 §6: the generator never invents 'correct' credentials) — every value comes from this call's own input, never a server-side secret store. negative/boundary/adversarial variants already carry their own fixed probe values and ignore field_values.",
        inputSchema: {
          type: "object",
          properties: {
            test_case: { type: "object", description: "The exact test_case object from a generate_test_cases response's test_cases array." },
            generated_assertion: { type: "object", description: "The matching entry from that same response's generated_assertions array (same test_case_id)." },
            field_values: {
              type: "object",
              description: "Real values keyed by field accessible_name, e.g. {\"Username\": \"daijobhr\", \"Password\": \"...\"}. Only fills blank positive-variant steps.",
            },
          },
          required: ["test_case", "generated_assertion"],
        },
        agent: EXECUTE_GENERATED_AGENT,
        purpose: "Execute a freshly generated test case via remote MCP, against any real target",
        consequence_class: "reversible",
        policy_version: POLICY_VERSION,
        allowed_skills: [EXECUTE_GENERATED_SKILL],
        allowed_tools: [{ id: "playwright-execution-engine", version: "0.1.0" }],
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          test_case: (args["test_case"] as JsonValue | undefined) ?? {},
          generated_assertion: (args["generated_assertion"] as JsonValue | undefined) ?? {},
          field_values: (args["field_values"] as JsonValue | undefined) ?? {},
        }),
      },
      {
        name: "run_auto_qa",
        description:
          "One call that runs the whole pipeline: discovers a page's Semantic UI Map, generates TestCases (positive/negative/boundary/adversarial per bindable, expected_text-bearing acceptance criterion — SPEC-207 §4/§6), executes every generated case for real via PlaywrightExecutionEngine, and returns a QA run report — both as JSON (report_html field) and, when output_path is given, written to that path as a self-contained HTML file you can open directly. Replaces manually chaining discover_ui_surface -> generate_test_cases -> execute_generated_test_case yourself. Supply login_url + username_field_name + username + password_field_name + password + submit_action_name together to test a screen reachable only after signing in (all six or none — a partial set is rejected); omit all six to discover url directly. acceptance_criteria is required (this tool never invents what a page should do) — each item needs at least id, statement, and expected_text; statement should mention a field/action name the target page is expected to have.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The page to test — the post-login target screen when login fields are supplied, otherwise navigated to directly." },
            requirement_ref: { type: "string", description: "Optional label for the report; defaults to a value derived from url." },
            requirement_title: { type: "string", description: "Optional label for the report; defaults to url." },
            acceptance_criteria: {
              type: "array",
              description: "Required. Each item needs at least id, statement, and expected_text.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  statement: { type: "string" },
                  expected_text: { type: "string" },
                },
              },
            },
            login_url: { type: "string", description: "Supply with the other five login_* fields to test a session-gated screen." },
            username_field_name: { type: "string", description: "Discovered field accessible_name on the login page, e.g. \"Username\"." },
            username: { type: "string" },
            password_field_name: { type: "string", description: "Discovered field accessible_name on the login page, e.g. \"Password\"." },
            password: { type: "string" },
            submit_action_name: { type: "string", description: "Discovered action accessible_name on the login page, e.g. \"Sign in\"." },
            output_path: { type: "string", description: "When given, the self-contained HTML report is also written to this local file path (parent directories are created as needed). Must resolve inside the server's configured output directory — a path that escapes it (e.g. via ../) is rejected." },
          },
          required: ["url", "acceptance_criteria"],
        },
        agent: AUTO_QA_AGENT,
        purpose: "Discover, generate, execute, and report on a target screen in one call",
        consequence_class: "reversible",
        policy_version: POLICY_VERSION,
        allowed_skills: [AUTO_QA_SKILL],
        allowed_tools: [{ id: "playwright-dom-pipeline", version: "0.1.0" }, { id: "playwright-execution-engine", version: "0.1.0" }],
        budgets: { max_steps: 20, max_duration_seconds: 300, max_tool_calls: 30, max_retries: 1 },
        buildInput: (args) => ({
          url: (args["url"] as string | undefined) ?? "",
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "",
          requirement_title: (args["requirement_title"] as string | undefined) ?? "",
          acceptance_criteria: (args["acceptance_criteria"] as JsonValue | undefined) ?? [],
          login_url: (args["login_url"] as string | undefined) ?? "",
          username_field_name: (args["username_field_name"] as string | undefined) ?? "",
          username: (args["username"] as string | undefined) ?? "",
          password_field_name: (args["password_field_name"] as string | undefined) ?? "",
          password: (args["password"] as string | undefined) ?? "",
          submit_action_name: (args["submit_action_name"] as string | undefined) ?? "",
          output_path: (args["output_path"] as string | undefined) ?? "",
        }),
      },
    ],
    serverInfo: { name: "qa-intelligence-remote-dev", version: "0.1.0" },
    environment: "development",
    deadlineSeconds: 120,
    sessionMemory: new SessionMemory(clock),
  });

  const transport = new StreamableHttpTransport({ authenticator });
  await transport.listen(PORT, HOST);

  const demoToken = await new SignJWT({})
    .setSubject(ACTOR_ID)
    .setProtectedHeader({ alg: "RS256", kid: idpKey.kid })
    .setIssuer(IDP_ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(idpKey.privateKey);

  process.stderr.write(
    [
      `qa-intelligence remote MCP dev server listening on http://${HOST}:${PORT}/mcp`,
      `Demo bearer token (Workspace ${WORKSPACE_ID}, actor ${ACTOR_ID}, expires in 1h):`,
      demoToken,
      "",
    ].join("\n"),
  );

  process.on("SIGINT", () => {
    void Promise.all([transport.close(), idp.close(), workspaceManagerJwks.close()]).then(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`qa-intelligence remote MCP dev server failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
