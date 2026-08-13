export type QaFailureClass = "product_assertion" | "infrastructure" | "transient_dependency" | "policy" | "invalid_test" | "cancelled";

export function decideQaRetry(input: Readonly<{
  failure_class: QaFailureClass;
  attempt: number;
  max_attempts: number;
  critical_journey: boolean;
}>): Readonly<{ retry: boolean; action: "retry" | "stop" | "block_release"; reason: string }> {
  if (input.critical_journey && input.failure_class === "product_assertion") return { retry: false, action: "block_release", reason: "Critical product assertion failed." };
  if (input.failure_class !== "infrastructure" && input.failure_class !== "transient_dependency") return { retry: false, action: "stop", reason: `${input.failure_class} is not retry-eligible.` };
  if (input.attempt >= input.max_attempts) return { retry: false, action: "stop", reason: "Retry budget exhausted." };
  return { retry: true, action: "retry", reason: "Bounded retry for transient/infrastructure failure." };
}
