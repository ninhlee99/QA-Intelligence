export type ResilienceProbe = Readonly<{ id: string; passed: boolean; duration_ms: number; evidence_ref: string; message?: string }>;

export function assessQaResilienceBenchmark(input: Readonly<{
  probes: readonly ResilienceProbe[];
  context_payload_bytes: number;
  max_context_payload_bytes: number;
}>): Readonly<{
  passed: boolean;
  probes_passed: number;
  probes_total: number;
  token_proxy: Readonly<{ estimated_tokens: number; method: string; within_budget: boolean }>;
  blockers: readonly string[];
}> {
  const blockers = input.probes.filter((probe) => !probe.passed).map((probe) => `${probe.id}: ${probe.message ?? "failed"}`);
  const withinBudget = input.context_payload_bytes <= input.max_context_payload_bytes;
  if (!withinBudget) blockers.push(`context-payload: ${input.context_payload_bytes} bytes exceeds ${input.max_context_payload_bytes}`);
  return {
    passed: blockers.length === 0,
    probes_passed: input.probes.filter((probe) => probe.passed).length,
    probes_total: input.probes.length,
    token_proxy: { estimated_tokens: Math.ceil(input.context_payload_bytes / 4), method: "UTF-8 bytes / 4; deterministic proxy, not provider billing", within_budget: withinBudget },
    blockers,
  };
}
