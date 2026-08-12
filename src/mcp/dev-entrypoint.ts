#!/usr/bin/env node
/**
 * Development-only MCP stdio server (ADR-016 §8, ADR-019). Composes the
 * in-memory Agent Runtime behind the MCP transport so a host (Claude Code,
 * Codex, Cursor) can call every dev tracer-bullet tool over stdio — the
 * same tool set as `remote-dev-entrypoint.ts`, minus the real OIDC/JWKS
 * identity plumbing that only matters over a network transport. The shared
 * tool definitions and Agent Runtime wiring live in `dev-fixture.ts`; this
 * file only supplies the fixture-proof authorizer and stdio transport.
 *
 * This is NOT a production entrypoint: authorization uses a deterministic
 * fixture verifier (no OIDC — ADR-014's production identity is still
 * pending per governance/reviews/requirement-review-tracer-bullet), the
 * Knowledge Store is an in-memory seed, and the Reasoning Provider is a
 * scripted replay adapter with an empty script (any indeterminate rule
 * outcome will return `unavailable` rather than reasoning). It exists to
 * let a real MCP host exercise the real Agent Runtime end-to-end during
 * development, exactly as ADR-016 §8 anticipates.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../adapters/deterministic/workspace-authorizer.js";
import { SessionMemory } from "../memory/session-memory.js";
import type { WorkspaceContext } from "../requirement-review/public.js";

import { AgentRuntimeToolRegistry } from "./agent-runtime-tool-registry.js";
import { buildDevFixture } from "./dev-fixture.js";
import { resolvePersistBaseDir } from "./persist-base-dir.js";
import { createSdkMcpServer } from "./sdk-mcp-server.js";
import { StdioTransport } from "./stdio-transport.js";

const WORKSPACE_ID = process.env["QA_INTELLIGENCE_DEV_WORKSPACE_ID"] ?? "workspace-dev-mcp-001";

const POLICY_VERSION = "dev-policy@0.1.0";
const ISSUER = "https://identity.dev.invalid";
const AUDIENCE = "qa-intelligence-dev";

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

function devWorkspaceContext(): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "mcp-dev-host",
    actor_type: "service",
    roles: ["requirement-reviewer", "agent-operator"],
    permissions: [
      "agent:execute",
      "agent:read",
      "requirement:read",
      "requirement:create",
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
    request_id: "request-dev-mcp-001",
    correlation_id: "correlation-dev-mcp-001",
    audience: [AUDIENCE],
    environment: "development",
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    issuer: ISSUER,
    integrity_proof: "",
  };
  return { ...unsigned, integrity_proof: fixtureProof(canonicalWorkspaceIntegrityClaims(unsigned)) };
}

function main(): void {
  const clock = { now: (): Date => new Date() };
  const permissions = [
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
  ];
  const authorizer = new DeterministicWorkspaceAuthorizer({
    clock,
    expected_issuer: ISSUER,
    expected_audience: AUDIENCE,
    workspace: { workspace_id: WORKSPACE_ID, status: "active" },
    policy: { workspace_id: WORKSPACE_ID, version: POLICY_VERSION, permissions },
    integrity_proof_verifier: {
      verify({ canonical_claims, integrity_proof }): boolean {
        return integrity_proof === fixtureProof(canonical_claims);
      },
    },
  });

  const persistBaseDir = resolvePersistBaseDir((message) => process.stderr.write(message));
  const sessionMemory = new SessionMemory(clock, {
    persistRootDir: join(persistBaseDir, ".qa-avoidance-hints"),
  });
  const { runtime, tools, mistakeRecurrenceTracker, candidateRepository, userPreferences } = buildDevFixture({
    workspaceId: WORKSPACE_ID,
    policyVersion: POLICY_VERSION,
    authorizer,
    clock,
    sessionMemory,
    persistBaseDir,
  });

  let idempotencySequence = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    // Refresh context on every call so the short-lived fixture token never
    // expires while the Cursor plugin keeps this process alive across hours.
    resolveWorkspaceContext: devWorkspaceContext,
    now: () => new Date(),
    nextIdempotencyKey: () => `mcp-dev-${++idempotencySequence}-${Date.now()}`,
    deadlineSeconds: 120,
    // SPEC-108 §4.2/§8: one Session Memory instance for this process's
    // lifetime, shared across every tools/call — a later call in the same
    // Workspace can read a prior call's retained outcome via
    // registry.readSessionMemory() / list_failure_avoidance_hints.
    // Local stdio serves one Workspace per process (ADR-016 §3's Local
    // Parent Runtime), so this instance never needs to isolate more than
    // the one WORKSPACE_ID this entrypoint uses.
    sessionMemory,
    mistakeRecurrenceTracker,
    candidateRepository,
    // Inject language_instruction into every tool response so Claude uses
    // the user's preferred response language without being re-prompted.
    resolveLanguageInstruction: () => userPreferences.languageInstruction(),
    tools,
  });

  const server = createSdkMcpServer({
    serverInfo: { name: "qa-intelligence-dev", version: "0.1.0" },
    tools: registry,
  });

  const transport = new StdioTransport(server, process.stdin, process.stdout);
  transport.run().catch((error: unknown) => {
    process.stderr.write(`qa-intelligence MCP dev server terminated: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

main();
