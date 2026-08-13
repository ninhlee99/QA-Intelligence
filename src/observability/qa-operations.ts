export type QaOperationalEvent = "run_started" | "run_passed" | "run_failed" | "retry" | "recovered" | "evidence_partial" | "kill_switch_blocked";

export class QaOperationsMonitor {
  readonly #counts = new Map<QaOperationalEvent, number>();
  record(event: QaOperationalEvent): void { this.#counts.set(event, (this.#counts.get(event) ?? 0) + 1); }
  snapshot(): Readonly<{ counts: Readonly<Record<QaOperationalEvent, number>>; failure_rate: number }> {
    const count = (event: QaOperationalEvent): number => this.#counts.get(event) ?? 0;
    const completed = count("run_passed") + count("run_failed");
    return { counts: Object.freeze({ run_started: count("run_started"), run_passed: count("run_passed"), run_failed: count("run_failed"), retry: count("retry"), recovered: count("recovered"), evidence_partial: count("evidence_partial"), kill_switch_blocked: count("kill_switch_blocked") }), failure_rate: completed === 0 ? 0 : count("run_failed") / completed };
  }
}

export class QaExecutionKillSwitch {
  constructor(private readonly read: () => string | undefined = () => process.env["QA_INTELLIGENCE_EXECUTION_DISABLED"]) {}
  state(): Readonly<{ disabled: boolean; reason: string }> {
    const value = this.read()?.trim();
    return value === undefined || value === "" || value === "0" || value.toLowerCase() === "false"
      ? { disabled: false, reason: "enabled" }
      : { disabled: true, reason: value };
  }
}

export function assessQaProductionReadiness(signals: Readonly<Record<"security" | "evidence_lifecycle" | "resumable_recovery" | "chaos_benchmark" | "browser_parity" | "monitoring" | "kill_switch" | "rollback" | "incident_owner" | "token_budget", boolean>>): Readonly<{ ready: boolean; blockers: readonly string[] }> {
  const blockers = Object.entries(signals).filter(([, ready]) => !ready).map(([name]) => name);
  return { ready: blockers.length === 0, blockers };
}
