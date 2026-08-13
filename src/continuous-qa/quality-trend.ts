export type QualityWindow = Readonly<{ release: string; pass_rate: number; flake_rate: number; escaped_defects: number }>;
export function assessQualityTrend(input: Readonly<{ windows: readonly QualityWindow[]; max_pass_rate_drop: number; max_flake_rate: number; max_escaped_defects: number }>): Readonly<{ healthy: boolean; blockers: readonly string[]; latest?: QualityWindow }> {
  const latest = input.windows.at(-1); const previous = input.windows.at(-2); const blockers: string[] = [];
  if (!latest) return { healthy: false, blockers: ["quality history is empty"] };
  if (previous && previous.pass_rate - latest.pass_rate > input.max_pass_rate_drop) blockers.push("pass-rate regression");
  if (latest.flake_rate > input.max_flake_rate) blockers.push("flake-rate SLO exceeded");
  if (latest.escaped_defects > input.max_escaped_defects) blockers.push("escaped-defect SLO exceeded");
  return { healthy: blockers.length === 0, blockers, latest };
}
