/**
 * SPEC-604 (Observability and Monitoring Runtime): "defines logs, metrics,
 * traces, audit events, service indicators, alerts, dashboards, and
 * evidence required to understand runtime health and decisions" (§1).
 * `src/memory/observability.ts` reports two SPEC-108-specific counters —
 * a legitimate, narrower report, but not the system-wide primitive §3's
 * five signal types require. This module is that primitive: any component
 * can emit into it, none of them own it.
 */
export type TelemetrySignalType = "log" | "metric" | "trace" | "audit_event" | "evidence";

/** SPEC-604 §2: request/workflow/execution/attempt/Workspace/component/release/evidence identities. */
export type TelemetryCorrelation = Readonly<{
  request_id?: string;
  workflow_id?: string;
  execution_id?: string;
  attempt_id?: string;
  workspace_id: string;
  component: string;
  release: string;
  evidence_refs: readonly string[];
}>;

export type LogSignal = Readonly<{
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
  correlation: TelemetryCorrelation;
  occurred_at: string;
}>;

export type MetricSignal = Readonly<{
  type: "metric";
  name: string;
  kind: "counter" | "gauge" | "histogram";
  value: number;
  unit: string;
  correlation: TelemetryCorrelation;
  occurred_at: string;
}>;

export type TraceSpanSignal = Readonly<{
  type: "trace";
  span_id: string;
  parent_span_id: string | null;
  operation_name: string;
  duration_ms: number;
  correlation: TelemetryCorrelation;
  occurred_at: string;
}>;

/** SPEC-604 §3: "immutable audit events for authority and access decisions" — the generalized shape `WorkspaceAuditRecord` is one domain-specific instance of. */
export type AuditEventSignal = Readonly<{
  type: "audit_event";
  actor_id: string;
  action: string;
  outcome: "allowed" | "denied";
  correlation: TelemetryCorrelation;
  occurred_at: string;
}>;

/** SPEC-604 §3/§9: "execution evidence for domain conclusions" — distinct from an audit event or a metric; observability, not authority. */
export type EvidenceSignal = Readonly<{
  type: "evidence";
  evidence_ref: string;
  conclusion: string;
  correlation: TelemetryCorrelation;
  occurred_at: string;
}>;

export type TelemetrySignal = LogSignal | MetricSignal | TraceSpanSignal | AuditEventSignal | EvidenceSignal;

/** SPEC-604 §6: "minimize content, redact secrets and personal data." */
export type TelemetryRedactionPolicy = Readonly<{
  redact_fields: readonly string[];
}>;

/** SPEC-604 §5: "missing telemetry for a critical signal SHALL itself alert." */
export type MissingTelemetryAlert = Readonly<{
  signal_type: TelemetrySignalType;
  component: string;
  window_seconds: number;
  reason: string;
}>;

export type TelemetryQueryFilter = Readonly<{
  workspace_id: string;
  types?: readonly TelemetrySignalType[];
  component?: string;
  correlation_id?: Readonly<Partial<Pick<TelemetryCorrelation, "request_id" | "workflow_id" | "execution_id" | "attempt_id">>>;
}>;

export interface TelemetryEmitter {
  emit(signal: TelemetrySignal): void;
  query(filter: TelemetryQueryFilter): readonly TelemetrySignal[];
}
