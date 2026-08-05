import type { AgentRunBudgets } from "./public.js";
import type { ConsequenceClass } from "../requirement-review/public.js";

/**
 * SPEC-508 §3.1 default budget table (AP-064, ADR-018): concrete ceilings
 * keyed by consequence class, replacing the unquantified "budgets SHALL
 * exist" vocabulary the contract carried before ADR-018.
 *
 * `max_duration_seconds` mirrors the table's wall-clock deadline column.
 * `max_tokens` mirrors the reasoning input+output token budget column.
 * `max_steps` mirrors the Plan→Act→Observe→Validate iteration ceiling.
 */
const DEFAULT_BUDGETS_BY_CONSEQUENCE_CLASS: Readonly<Record<ConsequenceClass, AgentRunBudgets>> =
  Object.freeze({
    advisory: Object.freeze({
      max_steps: 8,
      max_duration_seconds: 120,
      max_tool_calls: 10,
      max_retries: 1,
      max_tokens: 40_000,
    }),
    reversible: Object.freeze({
      max_steps: 20,
      max_duration_seconds: 600,
      max_tool_calls: 40,
      max_retries: 3,
      max_tokens: 150_000,
    }),
    controlled_side_effect: Object.freeze({
      max_steps: 20,
      max_duration_seconds: 600,
      max_tool_calls: 40,
      max_retries: 3,
      max_tokens: 150_000,
    }),
    high_consequence: Object.freeze({
      max_steps: 40,
      max_duration_seconds: 1_800,
      max_tool_calls: 100,
      max_retries: 5,
      max_tokens: 400_000,
    }),
  });

/**
 * Returns the SPEC-508 §3.1 default budget for a consequence class. Callers
 * MAY declare a stricter (lower) override on any field; declaring a looser
 * value than the default requires an explicit, evidenced override recorded
 * at authorization time — this function does not perform that override
 * itself, it only resolves the unmodified default so a caller has a
 * concrete starting point instead of inventing numbers per request.
 */
export function defaultAgentRunBudgets(consequenceClass: ConsequenceClass): AgentRunBudgets {
  return DEFAULT_BUDGETS_BY_CONSEQUENCE_CLASS[consequenceClass];
}

/**
 * Resolves budgets for a start request: any field explicitly supplied in
 * `overrides` wins verbatim (the caller's declared value, whether stricter
 * or an evidenced looser override — this function does not adjudicate
 * that), and any field left unset falls back to the SPEC-508 §3.1 default
 * for the given consequence class.
 */
export function resolveAgentRunBudgets(
  consequenceClass: ConsequenceClass,
  overrides: Partial<AgentRunBudgets> = {},
): AgentRunBudgets {
  const defaults = defaultAgentRunBudgets(consequenceClass);
  return Object.freeze({
    max_steps: overrides.max_steps ?? defaults.max_steps,
    max_duration_seconds: overrides.max_duration_seconds ?? defaults.max_duration_seconds,
    max_tool_calls: overrides.max_tool_calls ?? defaults.max_tool_calls,
    max_retries: overrides.max_retries ?? defaults.max_retries,
    ...(overrides.max_tokens !== undefined
      ? { max_tokens: overrides.max_tokens }
      : defaults.max_tokens !== undefined
        ? { max_tokens: defaults.max_tokens }
        : {}),
    ...(overrides.max_cost !== undefined ? { max_cost: overrides.max_cost } : {}),
    ...(overrides.max_tool_cost !== undefined ? { max_tool_cost: overrides.max_tool_cost } : {}),
    ...(overrides.max_repeated_action_fingerprints !== undefined
      ? { max_repeated_action_fingerprints: overrides.max_repeated_action_fingerprints }
      : {}),
    ...(overrides.max_no_progress_iterations !== undefined
      ? { max_no_progress_iterations: overrides.max_no_progress_iterations }
      : {}),
  });
}
