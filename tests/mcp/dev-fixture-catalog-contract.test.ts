import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  DeterministicWorkspaceAuthorizer,
  canonicalWorkspaceIntegrityClaims,
} from "../../src/adapters/deterministic/workspace-authorizer.js";
import { SessionMemory } from "../../src/memory/session-memory.js";
import { buildDevFixture } from "../../src/mcp/dev-fixture.js";

const WORKSPACE_ID = "workspace-catalog-contract-001";
const POLICY_VERSION = "test-policy@0.1.0";
const ISSUER = "identity-test";
const AUDIENCE = "qa-intelligence-test";

function fixtureProof(canonicalClaims: string): string {
  return createHash("sha256").update(`fixture:${canonicalClaims}`).digest("hex");
}

function authorizer() {
  const clock = { now: (): Date => new Date("2026-08-10T08:00:00.000Z") };
  const permissions = [
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
  ];
  return new DeterministicWorkspaceAuthorizer({
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
}

test("every tool agent is wired to a registered executor id", () => {
  const clock = { now: (): Date => new Date("2026-08-10T08:00:00.000Z") };
  const { tools, registeredAgentIds } = buildDevFixture({
    workspaceId: WORKSPACE_ID,
    policyVersion: POLICY_VERSION,
    authorizer: authorizer(),
    clock,
    sessionMemory: new SessionMemory(clock),
  });

  assert.ok(registeredAgentIds.length > 0, "expected at least one registered agent id");
  const registered = new Set(registeredAgentIds);
  assert.equal(registered.size, registeredAgentIds.length, "duplicate registered agent ids");

  for (const tool of tools) {
    assert.equal(
      registered.has(tool.agent.id),
      true,
      `tool ${tool.name} references unknown agent id ${tool.agent.id}`,
    );
  }
});
