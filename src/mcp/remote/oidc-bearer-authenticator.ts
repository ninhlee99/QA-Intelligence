import { randomUUID } from "node:crypto";

import type { AgentRuntime } from "../../runtime/public.js";
import type { WorkspaceContextIssuer } from "../../requirement-review/public.js";
import type { SessionMemory } from "../../memory/session-memory.js";
import type { MistakeRecurrenceTracker } from "../../learning-engine/mistake-recurrence.js";
import type { CandidateRepository } from "../../candidate-repository/public.js";
import { AgentRuntimeToolRegistry, type AgentRuntimeToolDefinition } from "../agent-runtime-tool-registry.js";
import type { SdkMcpServerDependencies } from "../sdk-mcp-server.js";
import type { BearerAuthenticationResult, BearerAuthenticator } from "./streamable-http-transport.js";

export type OidcBearerAuthenticatorOptions = Readonly<{
  issuer: WorkspaceContextIssuer;
  runtime: AgentRuntime;
  tools: readonly AgentRuntimeToolDefinition[];
  serverInfo: SdkMcpServerDependencies["serverInfo"];
  /** Deployment environment recorded on every issuance request (SPEC-506 §2). */
  environment: string;
  deadlineSeconds: number;
  now?(): Date;
  /**
   * SPEC-108 §4.2/§8: shared across every authenticated request this
   * authenticator serves (not one per request) so a prior call's retained
   * outcome is actually readable by a later call in the same Workspace —
   * unlike the per-request `AgentRuntimeToolRegistry` itself, Session
   * Memory's whole purpose is to outlive one request within a Workspace.
   */
  sessionMemory?: SessionMemory;
  sessionMemoryTtlSeconds?: number;
  /** SPEC-105 §9a: shared recurrence tracker across requests in this process. */
  mistakeRecurrenceTracker?: MistakeRecurrenceTracker;
  candidateRepository?: CandidateRepository;
  /** Optional language instruction injected into every tool response payload. */
  resolveLanguageInstruction?: () => string | undefined;
}>;

/**
 * The `BearerAuthenticator` ADR-020 §3.3 requires: turns one HTTP request's
 * bearer token into a per-request `AgentRuntimeToolRegistry` bound to the
 * `WorkspaceContext` `WorkspaceContextIssuer.issue()` returns for that token
 * — the exact seam a local `stdio` caller's `resolveWorkspaceContext()`
 * would otherwise short-circuit with a fixture. This class has no allow/deny
 * logic of its own: every denial reason it returns is `issue()`'s own
 * failure code, translated to an HTTP-appropriate message, never a locally
 * invented rule (ADR-020 §4).
 */
export class OidcBearerAuthenticator implements BearerAuthenticator {
  readonly #options: OidcBearerAuthenticatorOptions;

  constructor(options: OidcBearerAuthenticatorOptions) {
    this.#options = options;
  }

  async authenticate(bearerToken: string | undefined): Promise<BearerAuthenticationResult> {
    if (bearerToken === undefined || bearerToken.length === 0) {
      return { ok: false, failure: { status: 401, message: "Missing bearer token." } };
    }

    const now = this.#options.now?.() ?? new Date();
    const requestId = randomUUID();
    const issued = await this.#options.issuer.issue({
      id_token: bearerToken,
      operation_id: `mcp-remote:${requestId}`,
      request_id: requestId,
      correlation_id: requestId,
      environment: this.#options.environment,
    });

    if (!issued.ok) {
      return { ok: false, failure: { status: 401, message: `${issued.failure.code}: ${issued.failure.message}` } };
    }

    const context = issued.value;
    let idempotencySequence = 0;

    return {
      ok: true,
      sessionKey: `${context.workspace_id}:${context.actor_id}`,
      buildServerDependencies: () => ({
        serverInfo: this.#options.serverInfo,
        tools: new AgentRuntimeToolRegistry({
          runtime: this.#options.runtime,
          tools: this.#options.tools,
          resolveWorkspaceContext: () => context,
          now: () => now,
          nextIdempotencyKey: () => `mcp-remote-${requestId}-${++idempotencySequence}`,
          deadlineSeconds: this.#options.deadlineSeconds,
          ...(this.#options.sessionMemory !== undefined ? { sessionMemory: this.#options.sessionMemory } : {}),
          ...(this.#options.sessionMemoryTtlSeconds !== undefined
            ? { sessionMemoryTtlSeconds: this.#options.sessionMemoryTtlSeconds }
            : {}),
          ...(this.#options.mistakeRecurrenceTracker !== undefined
            ? { mistakeRecurrenceTracker: this.#options.mistakeRecurrenceTracker }
            : {}),
          ...(this.#options.candidateRepository !== undefined
            ? { candidateRepository: this.#options.candidateRepository }
            : {}),
          ...(this.#options.resolveLanguageInstruction !== undefined
            ? { resolveLanguageInstruction: this.#options.resolveLanguageInstruction }
            : {}),
        }),
      }),
    };
  }
}
