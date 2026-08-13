export type HistoricalOutcome = "passed" | "failed" | "flaky" | "blocked";
export function assessFlakeGovernance(input: Readonly<{ case_id: string; critical: boolean; recent_outcomes: readonly HistoricalOutcome[]; owner: string; quarantine_expires_at?: string; now?: string }>): Readonly<{ action: "observe" | "quarantine" | "block_release"; reason: string }> {
  const flakes = input.recent_outcomes.filter((outcome) => outcome === "flaky").length;
  if (flakes < 2) return { action: "observe", reason: "Flake recurrence threshold not reached." };
  if (input.critical) return { action: "block_release", reason: "Critical journey cannot be hidden by quarantine." };
  if (!input.owner.trim()) return { action: "block_release", reason: "Quarantine requires a remediation owner." };
  if (input.quarantine_expires_at !== undefined && Date.parse(input.quarantine_expires_at) <= Date.parse(input.now ?? new Date().toISOString())) return { action: "block_release", reason: "Quarantine expired without remediation." };
  return { action: "quarantine", reason: `Repeated flake owned by ${input.owner}; exclude only from non-critical gate while remediation is active.` };
}
