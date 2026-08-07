import { randomUUID } from "node:crypto";

import type { AgentRuntime, AgentRunBudgets, AgentRunResult, AgentRunStartRequest } from "../runtime/public.js";
import type { WorkspaceContext, ConsequenceClass, JsonObject } from "../requirement-review/public.js";
import { resolveAgentRunBudgets } from "../runtime/default-budgets.js";
import type { SessionMemory, SessionMemoryEntry } from "../memory/session-memory.js";
import type { McpTool, McpToolCallOutcome, McpToolRegistry } from "./sdk-mcp-server.js";

export type AgentRuntimeToolDefinition = Readonly<{
  /** MCP tool name, e.g. "assess_requirement_quality". */
  name: string;
  description: string;
  inputSchema: McpTool["inputSchema"];
  /** Exact SPEC-508 Agent identity this tool starts a run for. */
  agent: Readonly<{ id: string; version: string }>;
  purpose: string;
  consequence_class: ConsequenceClass;
  policy_version: string;
  /** Least-privilege Skill/Tool allowlist for this run (SPEC-508 §3); execution using an unlisted Skill or Tool fails closed. */
  allowed_skills?: readonly Readonly<{ id: string; version: string }>[];
  allowed_tools?: readonly Readonly<{ id: string; version: string }>[];
  /**
   * Replaces the SPEC-508 §3.1 consequence-class default budget entirely
   * when provided. Use this for a deterministic-only Skill that never
   * invokes a Reasoning Provider and therefore never reports token usage —
   * the default budget's `max_tokens` ceiling would otherwise make every
   * such run fail `budget_exhausted` on a dimension it never measures.
   */
  budgets?: AgentRunBudgets;
  /** Builds the run's opaque input payload from the tool call's typed arguments. */
  buildInput(args: Readonly<Record<string, unknown>>): JsonObject;
}>;

export type AgentRuntimeToolRegistryDependencies = Readonly<{
  runtime: AgentRuntime;
  tools: readonly AgentRuntimeToolDefinition[];
  /** Builds a trusted Workspace context for one call; the transport itself is untrusted (ADR-016 §6). */
  resolveWorkspaceContext(): WorkspaceContext;
  now(): Date;
  nextIdempotencyKey(): string;
  /** Deadline offset in seconds from `now()`; overridable per call site, not per MCP request. */
  deadlineSeconds: number;
  /**
   * SPEC-108 §4.2/§8: Workspace-scoped Session Memory shared across calls to
   * this registry (unlike Working Memory, which is run-scoped and lives
   * inside a Skill's own construction — SPEC-108 §4.1). When provided, a
   * completed run's outcome is offered to Session Memory's §7.1 save
   * decision, keyed per tool per Workspace, so a later call in the same
   * Workspace MAY read a prior outcome summary through `get()`. Omitted by
   * default: no MCP entrypoint is required to carry Session Memory.
   */
  sessionMemory?: SessionMemory;
  sessionMemoryTtlSeconds?: number;
}>;

export const DEFAULT_SESSION_MEMORY_TTL_SECONDS = 60 * 60;

function sessionMemoryKey(toolName: string): string {
  return `${toolName}:last_outcome`;
}

/**
 * Translates MCP `tools/call` into the SPEC-508 Agent Runtime `start` +
 * `execute` sequence (ADR-016 §4, ADR-019 §5). This is the only module in
 * src/mcp that imports the Agent Runtime — the JSON-RPC/MCP protocol layers
 * (jsonrpc.ts, protocol.ts, mcp-server.ts, stdio-transport.ts) have no
 * reference to it, keeping the transport interchangeable and the domain
 * seam explicit.
 */
export class AgentRuntimeToolRegistry implements McpToolRegistry {
  readonly #dependencies: AgentRuntimeToolRegistryDependencies;
  readonly #byName: ReadonlyMap<string, AgentRuntimeToolDefinition>;

  constructor(dependencies: AgentRuntimeToolRegistryDependencies) {
    this.#dependencies = dependencies;
    this.#byName = new Map(dependencies.tools.map((tool) => [tool.name, tool]));
  }

  list(): readonly McpTool[] {
    return this.#dependencies.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async call(
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<McpToolCallOutcome> {
    const definition = this.#byName.get(name);
    if (definition === undefined) {
      return { ok: false, text: `Unknown tool: ${name}` };
    }
    if (signal.aborted) {
      return { ok: false, text: "Tool call was cancelled before it started." };
    }

    const context = this.#dependencies.resolveWorkspaceContext();
    const now = this.#dependencies.now();
    const deadline = new Date(now.valueOf() + this.#dependencies.deadlineSeconds * 1000).toISOString();
    const idempotencyKey = this.#dependencies.nextIdempotencyKey();

    const startRequest: AgentRunStartRequest = {
      schema_version: "1.0.0",
      operation_id: `mcp:${idempotencyKey}:start`,
      workspace_id: context.workspace_id,
      actor_id: context.actor_id,
      workspace_context: context,
      agent: definition.agent,
      purpose: definition.purpose,
      consequence_class: definition.consequence_class,
      input: definition.buildInput(args),
      policy_version: definition.policy_version,
      budgets: definition.budgets ?? resolveAgentRunBudgets(definition.consequence_class),
      deadline,
      idempotency_key: idempotencyKey,
      ...(definition.allowed_skills !== undefined ? { allowed_skills: definition.allowed_skills } : {}),
      ...(definition.allowed_tools !== undefined ? { allowed_tools: definition.allowed_tools } : {}),
    };

    const started = await this.#dependencies.runtime.start(startRequest);
    if (!started.ok) {
      return { ok: false, text: `Run could not start: ${started.failure.code} — ${started.failure.message}` };
    }

    const executed = await this.#dependencies.runtime.execute(started.value, {
      schema_version: "1.0.0",
      operation_id: `mcp:${idempotencyKey}:execute`,
      workspace_id: context.workspace_id,
      actor_id: context.actor_id,
      policy_version: context.policy_version,
      workspace_context: context,
      expected_revision: 3,
      idempotency_key: `${idempotencyKey}:execute`,
    });
    if (!executed.ok) {
      return { ok: false, text: `Run did not complete: ${executed.failure.code} — ${executed.failure.message}` };
    }

    this.#retainOutcomeInSessionMemory(context.workspace_id, definition, executed.value);

    return {
      ok: executed.value.outcome === "completed",
      text: JSON.stringify(executed.value, null, 2),
    };
  }

  /**
   * SPEC-108 §4.2 example: "a prior run's outcome summary for the same
   * Workspace" is the canonical Session Memory candidate. Every candidate
   * still passes through `SessionMemory.evaluate()`'s §7.1 save-decision
   * policy unchanged — this call never bypasses reuse-likelihood,
   * provenance, consequence-tier, or applicability-scope checks; a
   * non-`completed` outcome is simply not considered reuse-likely.
   */
  #retainOutcomeInSessionMemory(
    workspaceId: string,
    definition: AgentRuntimeToolDefinition,
    result: AgentRunResult,
  ): void {
    const sessionMemory = this.#dependencies.sessionMemory;
    if (sessionMemory === undefined) return;

    const sourceRef = result.evidence[0] ?? `agent-run:${result.run_id}`;
    sessionMemory.evaluate({
      workspace_id: workspaceId,
      key: sessionMemoryKey(definition.name),
      value: JSON.stringify({ run_id: result.run_id, outcome: result.outcome, output: result.output }),
      source_ref: sourceRef,
      consequence_class: definition.consequence_class,
      reuse_likely: result.outcome === "completed",
      ttl_seconds: this.#dependencies.sessionMemoryTtlSeconds ?? DEFAULT_SESSION_MEMORY_TTL_SECONDS,
    });
  }

  /**
   * Reads a prior retained outcome for one tool in one Workspace, if
   * Session Memory is configured and an unexpired entry exists (SPEC-108
   * §9 fail-safe read — never throws, never returns a cross-Workspace or
   * expired entry).
   */
  readSessionMemory(workspaceId: string, toolName: string): SessionMemoryEntry | undefined {
    return this.#dependencies.sessionMemory?.get(workspaceId, sessionMemoryKey(toolName));
  }
}

/** Convenience factory for a Workspace context resolver backed by a fixed identity. */
export function fixedWorkspaceContext(context: WorkspaceContext): () => WorkspaceContext {
  return () => context;
}

export function randomIdempotencyKeyFactory(): () => string {
  return () => randomUUID();
}
