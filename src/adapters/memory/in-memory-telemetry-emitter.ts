import type {
  MissingTelemetryAlert,
  TelemetryEmitter,
  TelemetryQueryFilter,
  TelemetryRedactionPolicy,
  TelemetrySignal,
  TelemetrySignalType,
} from "../../observability/public.js";

const REDACTED = "[REDACTED]";

/**
 * SPEC-604's required reference collector: an in-process, deterministic
 * `TelemetryEmitter` proving signal-type distinctness (§3), correlation
 * (§2), redaction (§6), and Workspace-scoped query access (§6) — the same
 * "deterministic reference adapter" pattern every other in-memory store
 * this session built. Redaction applies at write time, not read time
 * (mirrors `GitPlugin`'s sensitive-path policy applying before content
 * reaches context, not after) — a redacted secret is never retrievable
 * even by a caller with full query access. Audit events are never dropped
 * by this adapter regardless of volume (§8: "critical audit and evidence
 * signals SHALL not rely solely on sampled telemetry") — this reference
 * adapter has no sampling at all, so that guarantee holds trivially; a
 * real backend would need to preserve it explicitly. Durable/queryable
 * storage (SQLite/Postgres, a real metrics backend) is separate, larger
 * scope, not attempted here.
 */
export class InMemoryTelemetryEmitter implements TelemetryEmitter {
  readonly #redactFields: readonly string[];
  readonly #signals: TelemetrySignal[] = [];

  constructor(redactionPolicy: TelemetryRedactionPolicy = { redact_fields: [] }) {
    this.#redactFields = redactionPolicy.redact_fields;
  }

  emit(signal: TelemetrySignal): void {
    this.#signals.push(redact(signal, this.#redactFields));
  }

  query(filter: TelemetryQueryFilter): readonly TelemetrySignal[] {
    // Workspace scope is mandatory on every filter — there is no query
    // path that can retrieve another Workspace's signals (§6: "enforce
    // Workspace-aware access" enforced structurally, not by a check that
    // could be forgotten).
    return this.#signals
      .filter((signal) => signal.correlation.workspace_id === filter.workspace_id)
      .filter((signal) => filter.types === undefined || filter.types.includes(signal.type))
      .filter((signal) => filter.component === undefined || signal.correlation.component === filter.component)
      .filter((signal) => matchesCorrelationId(signal, filter.correlation_id))
      // A fresh array of the same immutable signal objects — the caller
      // can never mutate this collector's internal store through the
      // returned reference (§7 audit integrity).
      .slice();
  }

  /** SPEC-604 §5: "missing telemetry for a critical signal SHALL itself alert" — made testable without a real timer. */
  detectMissingTelemetry(
    component: string,
    signalType: TelemetrySignalType,
    windowSeconds: number,
    now: Date,
  ): MissingTelemetryAlert | undefined {
    const windowStartMs = now.valueOf() - windowSeconds * 1000;
    const present = this.#signals.some(
      (signal) =>
        signal.type === signalType &&
        signal.correlation.component === component &&
        Date.parse(signal.occurred_at) >= windowStartMs,
    );
    if (present) return undefined;
    return {
      signal_type: signalType,
      component,
      window_seconds: windowSeconds,
      reason: `No "${signalType}" signal observed for component "${component}" in the last ${windowSeconds}s.`,
    };
  }
}

function matchesCorrelationId(
  signal: TelemetrySignal,
  correlationFilter: TelemetryQueryFilter["correlation_id"],
): boolean {
  if (correlationFilter === undefined) return true;
  return (
    (correlationFilter.request_id === undefined || signal.correlation.request_id === correlationFilter.request_id) &&
    (correlationFilter.workflow_id === undefined || signal.correlation.workflow_id === correlationFilter.workflow_id) &&
    (correlationFilter.execution_id === undefined || signal.correlation.execution_id === correlationFilter.execution_id) &&
    (correlationFilter.attempt_id === undefined || signal.correlation.attempt_id === correlationFilter.attempt_id)
  );
}

function redact(signal: TelemetrySignal, redactFields: readonly string[]): TelemetrySignal {
  if (redactFields.length === 0) return signal;
  switch (signal.type) {
    case "log":
      return { ...signal, message: redactText(signal.message, redactFields) };
    case "audit_event":
      return { ...signal, action: redactText(signal.action, redactFields) };
    case "evidence":
      return { ...signal, conclusion: redactText(signal.conclusion, redactFields) };
    case "metric":
    case "trace":
      return signal;
  }
}

function redactText(text: string, redactFields: readonly string[]): string {
  let redacted = text;
  for (const field of redactFields) {
    if (field.length === 0) continue;
    redacted = redacted.split(field).join(REDACTED);
  }
  return redacted;
}
