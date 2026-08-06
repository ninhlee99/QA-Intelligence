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
import { SessionMemory } from "../memory/session-memory.js";
import type { Requirement } from "../requirement-review/public.js";

import { OidcBearerAuthenticator } from "./remote/oidc-bearer-authenticator.js";
import { StreamableHttpTransport } from "./remote/streamable-http-transport.js";

const WORKSPACE_ID = process.env["QA_INTELLIGENCE_DEV_WORKSPACE_ID"] ?? "workspace-remote-dev-001";
const ACTOR_ID = process.env["QA_INTELLIGENCE_DEV_ACTOR_ID"] ?? "actor-remote-dev-001";
const PORT = Number(process.env["QA_INTELLIGENCE_DEV_REMOTE_PORT"] ?? "8787");
const HOST = process.env["QA_INTELLIGENCE_DEV_REMOTE_HOST"] ?? "127.0.0.1";
const AGENT = { id: "requirement-review-agent", version: "0.1.0" } as const;
const SKILL = { id: "assess-requirement-quality", version: "0.1.0" } as const;
const POLICY_VERSION = "dev-policy@0.1.0";
const IDP_ISSUER = "https://identity.dev.invalid";
const CONTEXT_ISSUER = "https://workspace-manager.dev.invalid";
const AUDIENCE = "qa-intelligence-remote-dev";
const MEMBERSHIP: MembershipRecord = {
  workspace_id: WORKSPACE_ID,
  actor_id: ACTOR_ID,
  actor_type: "human",
  roles: ["requirement-reviewer", "agent-operator"],
  permissions: ["agent:execute", "agent:read", "requirement:read", "knowledge:read", "assessment:create"],
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

  let runSequence = 0;
  let eventSequence = 0;
  const ids: IdFactory = {
    next: (kind: "run" | "event"): string => (kind === "run" ? `run-${++runSequence}` : `event-${++eventSequence}`),
  };
  const runtime = new InMemoryAgentRuntime(
    clock,
    ids,
    authorizer,
    new RequirementReviewRuntimeExecutor({
      reviewer,
      requirements: new InMemoryRequirementResolver(WORKSPACE_ID, [seedRequirement()], authorizer),
      validateAssessment: () => true,
      expected_agent: AGENT,
      expected_skill: SKILL,
    }),
  );

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
