export type CanaryObservation = Readonly<{ total: number; failed: number; rollback_triggered: boolean; restoration_seconds: number | null; semantic_verification_passed: boolean }>;

export function assessCanaryRecovery(input: Readonly<{ observation: CanaryObservation; max_failure_rate: number; max_restoration_seconds: number }>): Readonly<{ passed: boolean; failure_rate: number; blockers: readonly string[] }> {
  const rate = input.observation.total === 0 ? 1 : input.observation.failed / input.observation.total;
  const blockers: string[] = [];
  if (input.observation.total === 0) blockers.push("canary has no completed observations");
  if (rate > input.max_failure_rate && !input.observation.rollback_triggered) blockers.push("failure threshold exceeded without rollback");
  if (input.observation.rollback_triggered && (input.observation.restoration_seconds === null || input.observation.restoration_seconds > input.max_restoration_seconds)) blockers.push("rollback restoration objective missed");
  if (!input.observation.semantic_verification_passed) blockers.push("post-canary semantic verification failed");
  return { passed: blockers.length === 0, failure_rate: rate, blockers };
}

export function assessReleaseCandidate(input: Readonly<{ regression: boolean; resilience: boolean; browser_parity: boolean; production_config: boolean; monitoring_healthy: boolean; attestations: boolean; canary_recovery: boolean }>): Readonly<{ ready: boolean; blockers: readonly string[] }> {
  const blockers = Object.entries(input).filter(([, pass]) => !pass).map(([name]) => name);
  return { ready: blockers.length === 0, blockers };
}
