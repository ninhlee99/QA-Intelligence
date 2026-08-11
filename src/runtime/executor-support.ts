/**
 * Every `AgentRunExecutor` in this repository (Requirement Review,
 * Discovery, Test Design, Execution) built its own byte-for-byte identical
 * copy of an `AgentRunFailure` constructor and a `unique(string[])`
 * deduplicator. Neither has any domain-specific logic — they are pure,
 * mechanical helpers over `AgentRunFailure`'s shape (`executor.ts`) — so
 * they belong in one place, the same way `src/shared/rule-engine-support.ts`
 * already centralizes the equivalent primitives shared across every
 * `DeterministicRuleEngine`.
 */
import type { AgentRunFailure } from "./public.js";

export function failure(
  failureClass: AgentRunFailure["class"],
  code: AgentRunFailure["code"],
  message: string,
  retryable = false,
  evidence: readonly string[] = [],
): AgentRunFailure {
  return { class: failureClass, code, message, retryable, evidence: [...evidence] };
}

export function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export type BasicAuthCredentials = Readonly<{ username: string; password: string }>;

/** Both `basic_auth_username`/`basic_auth_password` required together or neither — a partial pair is a caller configuration error, not "no basic auth." */
export function readBasicAuthFields(input: Readonly<Record<string, unknown>>): BasicAuthCredentials | "partial" | undefined {
  const username = input["basic_auth_username"];
  const password = input["basic_auth_password"];
  const hasUsername = typeof username === "string" && username.length > 0;
  const hasPassword = typeof password === "string" && password.length > 0;
  if (!hasUsername && !hasPassword) return undefined;
  if (!hasUsername || !hasPassword) return "partial";
  return { username: username as string, password: password as string };
}
