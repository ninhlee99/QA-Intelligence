import type { StableResult } from "../requirement-review/public.js";
import type {
  AgentRunExecution,
  AgentRunFailure,
  AgentRunReference,
  AgentRunResultUsage,
  AgentRunStartRequest,
  AgentRunUncertainty,
  CleanupStatus,
} from "./public.js";
import type { JsonObject } from "../requirement-review/public.js";

export type AgentRunExecutorInput = Readonly<{
  reference: AgentRunReference;
  start_request: AgentRunStartRequest;
  execution: AgentRunExecution;
}>;

/**
 * Provider- and Skill-neutral observation returned to the runtime. The runtime,
 * not the executor, owns lifecycle state and the authoritative final result.
 */
export type AgentRunExecutorValue = Readonly<{
  output: JsonObject;
  output_validated: boolean;
  satisfied_evidence_requirements: readonly string[];
  resolved_versions: Readonly<Record<string, string>>;
  rule_results: readonly string[];
  skill_usage: readonly string[];
  tool_usage: readonly string[];
  citations: readonly string[];
  uncertainty: AgentRunUncertainty;
  policy_events: readonly string[];
  usage: AgentRunResultUsage;
  evidence: readonly string[];
  cleanup_status: CleanupStatus;
}>;

export type AgentRunExecutorResult = StableResult<
  AgentRunExecutorValue,
  AgentRunFailure
>;

/** Internal execution seam consumed by the Agent Runtime implementation. */
export interface AgentRunExecutor {
  execute(input: AgentRunExecutorInput): Promise<AgentRunExecutorResult>;
}
