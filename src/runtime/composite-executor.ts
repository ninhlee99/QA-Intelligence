import type { AgentRunExecutor, AgentRunExecutorInput, AgentRunExecutorResult } from "./executor.js";

/**
 * `InMemoryAgentRuntime` binds to exactly one `AgentRunExecutor` (SPEC-508's
 * lifecycle writer). An MCP entrypoint exposing more than one Agent (e.g.
 * Requirement Review and Browser Test Execution) over one runtime instance
 * needs a single executor that fans out by the retained exact Agent
 * identity — this is that seam. It performs no domain logic itself; an
 * unmatched Agent id/version is an orchestration failure, not a silent
 * fallback to the wrong executor.
 */
export class CompositeAgentRunExecutor implements AgentRunExecutor {
  readonly #byAgentId: ReadonlyMap<string, AgentRunExecutor>;

  constructor(byAgentId: ReadonlyMap<string, AgentRunExecutor>) {
    this.#byAgentId = byAgentId;
  }

  async execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult> {
    const executor = this.#byAgentId.get(input.start_request.agent.id);
    if (executor === undefined) {
      return {
        ok: false,
        failure: {
          class: "orchestration",
          code: "invalid_definition",
          message: `No executor is registered for Agent "${input.start_request.agent.id}".`,
          retryable: false,
          evidence: [],
        },
      };
    }
    return executor.execute(input);
  }
}
