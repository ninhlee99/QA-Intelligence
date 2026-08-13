#!/usr/bin/env node
/** Production local MCP entrypoint. The parent coding agent is the trust boundary. */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

import { canonicalWorkspaceIntegrityClaims, DeterministicWorkspaceAuthorizer } from "../adapters/deterministic/workspace-authorizer.js";
import { SessionMemory } from "../memory/session-memory.js";
import type { WorkspaceContext } from "../requirement-review/public.js";
import { AgentRuntimeToolRegistry } from "./agent-runtime-tool-registry.js";
import { buildDevFixture } from "./dev-fixture.js";
import { loadServerConfig } from "./server-config.js";
import { createSdkMcpServer } from "./sdk-mcp-server.js";
import { StdioTransport } from "./stdio-transport.js";
import { productionToolFilter, selectProductionTools } from "./tool-profile.js";

const POLICY_VERSION = "local-production-policy@1.0.0";
const ISSUER = "urn:qa-intelligence:local-host";
const AUDIENCE = "qa-intelligence-local";
const PERMISSIONS = [
  "agent:execute", "agent:read", "requirement:read", "requirement:create", "knowledge:read",
  "assessment:create", "execution:read", "evidence:delete", "execution:execute", "execution:cancel",
  "execution:cleanup", "discovery:observe", "test-case:create", "defect:read", "workflow:read",
  "risk:read", "test_strategy:read", "test_case:read", "test_dataset:read", "automation_asset:read",
  "report:read", "execution_record:read", "credential:register", "credential:read",
  "environment:register", "environment:read", "test_dataset:create", "automation_asset:create",
] as const;

function proof(claims: string): string {
  return `local-sha256:${createHash("sha256").update(claims).digest("hex")}`;
}

export function main(): void {
  const config = loadServerConfig();
  const clock = { now: (): Date => new Date() };
  const context = (): WorkspaceContext => {
    const now = clock.now();
    const unsigned: WorkspaceContext = {
      schema_version: "1.0.0", workspace_id: config.workspaceId, actor_id: "local-coding-agent",
      actor_type: "service", roles: ["agent-operator"], permissions: [...PERMISSIONS],
      policy_version: POLICY_VERSION, request_id: randomUUID(), correlation_id: randomUUID(),
      audience: [AUDIENCE], environment: "production", issued_at: now.toISOString(),
      expires_at: new Date(now.valueOf() + 5 * 60_000).toISOString(), issuer: ISSUER, integrity_proof: "",
    };
    return { ...unsigned, integrity_proof: proof(canonicalWorkspaceIntegrityClaims(unsigned)) };
  };
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock, expected_issuer: ISSUER, expected_audience: AUDIENCE,
    workspace: { workspace_id: config.workspaceId, status: "active" },
    policy: { workspace_id: config.workspaceId, version: POLICY_VERSION, permissions: PERMISSIONS },
    integrity_proof_verifier: { verify: ({ canonical_claims, integrity_proof }) => integrity_proof === proof(canonical_claims) },
  });
  const sessionMemory = new SessionMemory(clock, { persistRootDir: join(config.dataDir, ".qa-avoidance-hints") });
  const composition = buildDevFixture({
    workspaceId: config.workspaceId, policyVersion: POLICY_VERSION, authorizer, clock, sessionMemory,
    persistBaseDir: config.dataDir, exposeTool: productionToolFilter(config.toolProfile),
  });
  const tools = selectProductionTools(composition.tools, config.toolProfile);
  let sequence = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime: composition.runtime, tools, resolveWorkspaceContext: context, now: clock.now,
    nextIdempotencyKey: () => `local-${++sequence}-${Date.now()}`, deadlineSeconds: config.deadlineSeconds,
    sessionMemory, mistakeRecurrenceTracker: composition.mistakeRecurrenceTracker,
    candidateRepository: composition.candidateRepository,
    resolveLanguageInstruction: () => composition.userPreferences.languageInstruction(),
  });
  const server = createSdkMcpServer({ serverInfo: { name: "qa-intelligence", version: "0.9.0" }, tools: registry });
  new StdioTransport(server, process.stdin, process.stdout).run().catch((error: unknown) => {
    process.stderr.write(`qa-intelligence terminated: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

try { main(); } catch (error: unknown) {
  process.stderr.write(`qa-intelligence configuration error: ${String(error)}\n`);
  process.exitCode = 78;
}
