#!/usr/bin/env node
/**
 * Development-only remote MCP Streamable HTTP server (ADR-020). Mirrors
 * `dev-entrypoint.ts`'s Agent Runtime wiring exactly (same reviewer, same
 * seeded requirement, same tool definitions — shared via `dev-fixture.ts`)
 * but exposes it over `StreamableHttpTransport` with real cryptographic
 * identity instead of `stdio` with a fixture proof: it mints its own
 * ephemeral RSA keypair, serves its own local JWKS endpoint, and issues
 * real signed OIDC ID tokens for a demo actor — a real end-to-end round
 * trip through `OidcWorkspaceContextIssuer` and the bearer-token
 * verification path, without depending on an external identity provider.
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

import { generateSigningKey, startJwksServer } from "../adapters/oidc/jwks-fixture-server.js";
import { JwksWorkspaceIntegrityProofVerifier } from "../adapters/oidc/jwks-integrity-proof-verifier.js";
import { OidcWorkspaceContextIssuer, type MembershipRecord } from "../adapters/oidc/workspace-context-issuer.js";
import { DeterministicWorkspaceAuthorizer } from "../adapters/deterministic/workspace-authorizer.js";
import { SessionMemory } from "../memory/session-memory.js";

import { OidcBearerAuthenticator } from "./remote/oidc-bearer-authenticator.js";
import { StreamableHttpTransport } from "./remote/streamable-http-transport.js";
import { buildDevFixture } from "./dev-fixture.js";

const WORKSPACE_ID = process.env["QA_INTELLIGENCE_DEV_WORKSPACE_ID"] ?? "workspace-remote-dev-001";
const ACTOR_ID = process.env["QA_INTELLIGENCE_DEV_ACTOR_ID"] ?? "actor-remote-dev-001";
const PORT = Number(process.env["QA_INTELLIGENCE_DEV_REMOTE_PORT"] ?? "8787");
const HOST = process.env["QA_INTELLIGENCE_DEV_REMOTE_HOST"] ?? "127.0.0.1";
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
    "defect:read",
    "workflow:read",
    "risk:read",
    "test_strategy:read",
    "test_case:read",
    "test_dataset:read",
    "automation_asset:read",
    "report:read",
    "execution_record:read",
    "credential:register",
    "credential:read",
    "environment:register",
    "environment:read",
    "test_dataset:create",
    "automation_asset:create",
  ],
  policy_version: POLICY_VERSION,
};

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

  const sessionMemory = new SessionMemory(clock);
  const { runtime, tools } = buildDevFixture({
    workspaceId: WORKSPACE_ID,
    policyVersion: POLICY_VERSION,
    authorizer,
    clock,
    sessionMemory,
  });

  const authenticator = new OidcBearerAuthenticator({
    issuer,
    runtime,
    tools,
    serverInfo: { name: "qa-intelligence-remote-dev", version: "0.1.0" },
    environment: "development",
    deadlineSeconds: 120,
    sessionMemory,
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
