#!/usr/bin/env node
/**
 * Development-only MCP stdio server (ADR-016 §8, ADR-019). Composes the
 * in-memory Requirement Review Agent Runtime behind the MCP transport so a
 * host (Claude Code, Codex, Cursor) can call `assess_requirement_quality`
 * over stdio.
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

import {
  canonicalWorkspaceIntegrityClaims,
  DeterministicWorkspaceAuthorizer,
} from "../adapters/deterministic/workspace-authorizer.js";
import { InMemoryKnowledgeSearch } from "../adapters/memory/knowledge-search.js";
import { InMemoryRequirementResolver } from "../adapters/memory/requirement-resolver.js";
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
import type { Requirement, WorkspaceContext } from "../requirement-review/public.js";

import { AgentRuntimeToolRegistry, fixedWorkspaceContext } from "./agent-runtime-tool-registry.js";
import { McpServer } from "./mcp-server.js";
import { StdioTransport, stdioSender } from "./stdio-transport.js";

const WORKSPACE_ID = process.env["QA_INTELLIGENCE_DEV_WORKSPACE_ID"] ?? "workspace-dev-mcp-001";
const AGENT = { id: "requirement-review-agent", version: "0.1.0" } as const;
const SKILL = { id: "assess-requirement-quality", version: "0.1.0" } as const;
const POLICY_VERSION = "dev-policy@0.1.0";
const ISSUER = "https://identity.dev.invalid";
const AUDIENCE = "qa-intelligence-dev";

function fixtureProof(canonicalClaims: string): string {
  return `fixture-sha256:${createHash("sha256").update(canonicalClaims).digest("hex")}`;
}

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

function devWorkspaceContext(): WorkspaceContext {
  const unsigned: WorkspaceContext = {
    schema_version: "1.0.0",
    workspace_id: WORKSPACE_ID,
    actor_id: "mcp-dev-host",
    actor_type: "service",
    roles: ["requirement-reviewer", "agent-operator"],
    permissions: ["agent:execute", "agent:read", "requirement:read", "knowledge:read", "assessment:create"],
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
  const permissions = ["agent:execute", "agent:read", "requirement:read", "knowledge:read", "assessment:create"];
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

  let reviewId = 0;
  const reviewer = new AssessRequirementQuality({
    authorizer,
    knowledge: new InMemoryKnowledgeSearch({
      workspace_id: WORKSPACE_ID,
      knowledge_snapshot: "0.1.0",
      projection_freshness: clock.now().toISOString(),
      records: [],
    }),
    // SPEC-203 (quality: acceptance criteria, source, ambiguous terms) and
    // SPEC-202 (contract completeness: rationale, traceability-count-by-
    // status) are independent accepted rule sets that both govern the same
    // Requirement — merge them so this dev entrypoint doesn't silently run
    // only one of the two rule sets a Requirement is actually subject to.
    rules: new CompositeRuleEngine([
      new RequirementQualityRuleEngine(),
      new RequirementIntelligenceRuleEngine(),
    ]),
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
    next: (kind: "run" | "event"): string =>
      kind === "run" ? `run-${++runSequence}` : `event-${++eventSequence}`,
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

  let idempotencySequence = 0;
  const registry = new AgentRuntimeToolRegistry({
    runtime,
    resolveWorkspaceContext: fixedWorkspaceContext(devWorkspaceContext()),
    now: () => new Date(),
    nextIdempotencyKey: () => `mcp-dev-${++idempotencySequence}-${Date.now()}`,
    deadlineSeconds: 120,
    // SPEC-108 §4.2/§8: one Session Memory instance for this process's
    // lifetime, shared across every tools/call — a later call in the same
    // Workspace can read a prior call's retained outcome via
    // registry.readSessionMemory(). Local stdio serves one Workspace per
    // process (ADR-016 §3's Local Parent Runtime), so this instance never
    // needs to isolate more than the one WORKSPACE_ID this entrypoint uses.
    sessionMemory: new SessionMemory(clock),
    tools: [
      {
        name: "assess_requirement_quality",
        description:
          "Assess a requirement's quality (traceability, acceptance criteria, ambiguity) via the QA Intelligence Requirement Review Agent. Development seed data only (REQ-DEMO-001).",
        inputSchema: {
          type: "object",
          properties: { requirement_ref: { type: "string", description: "e.g. REQ-DEMO-001@1.0.0" } },
          required: ["requirement_ref"],
        },
        agent: AGENT,
        purpose: "Review requirement quality via MCP (development)",
        consequence_class: "advisory",
        policy_version: POLICY_VERSION,
        allowed_skills: [SKILL],
        // No max_tokens: this Skill only calls a Reasoning Provider when
        // deterministic rules are indeterminate, and RequirementReviewRuntimeExecutor
        // does not report usage.tokens at all — the SPEC-508 §3.1 default
        // would otherwise fail every run as budget_exhausted on a
        // dimension this Skill never measures.
        budgets: { max_steps: 8, max_duration_seconds: 120, max_tool_calls: 10, max_retries: 1 },
        buildInput: (args) => ({
          requirement_ref: (args["requirement_ref"] as string | undefined) ?? "REQ-DEMO-001@1.0.0",
        }),
      },
    ],
  });

  const server = new McpServer({
    serverInfo: { name: "qa-intelligence-dev", version: "0.1.0" },
    tools: registry,
    send: stdioSender(process.stdout),
  });

  const transport = new StdioTransport(server, process.stdin, process.stdout);
  transport.run().catch((error: unknown) => {
    process.stderr.write(`qa-intelligence MCP dev server terminated: ${String(error)}\n`);
    process.exitCode = 1;
  });
}

main();
