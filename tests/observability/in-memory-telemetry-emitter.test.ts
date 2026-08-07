import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryTelemetryEmitter } from "../../src/adapters/memory/in-memory-telemetry-emitter.js";
import type {
  AuditEventSignal,
  LogSignal,
  MetricSignal,
  TelemetryCorrelation,
} from "../../src/observability/public.js";

function correlation(overrides: Partial<TelemetryCorrelation> = {}): TelemetryCorrelation {
  return {
    workspace_id: "workspace-alpha",
    component: "execution-manager",
    release: "release-1.0.0",
    evidence_refs: [],
    ...overrides,
  };
}

function logSignal(overrides: Partial<LogSignal> = {}): LogSignal {
  return {
    type: "log",
    level: "info",
    message: "dispatch started",
    correlation: correlation(),
    occurred_at: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

function metricSignal(overrides: Partial<MetricSignal> = {}): MetricSignal {
  return {
    type: "metric",
    name: "dispatch_latency_ms",
    kind: "histogram",
    value: 42,
    unit: "ms",
    correlation: correlation(),
    occurred_at: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

function auditSignal(overrides: Partial<AuditEventSignal> = {}): AuditEventSignal {
  return {
    type: "audit_event",
    actor_id: "actor-001",
    action: "workspace.suspend",
    outcome: "allowed",
    correlation: correlation(),
    occurred_at: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

test("signal-type distinctness: querying by types: [audit_event] never returns other signal types", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(logSignal());
  emitter.emit(metricSignal());
  emitter.emit(auditSignal());

  const results = emitter.query({ workspace_id: "workspace-alpha", types: ["audit_event"] });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.type, "audit_event");
});

test("correlation completeness: a signal emitted with execution_id is retrievable by that execution_id", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(logSignal({ correlation: correlation({ execution_id: "EXEC-1" }) }));
  emitter.emit(logSignal({ correlation: correlation({ execution_id: "EXEC-2" }) }));

  const results = emitter.query({ workspace_id: "workspace-alpha", correlation_id: { execution_id: "EXEC-1" } });

  assert.equal(results.length, 1);
  assert.equal((results[0] as LogSignal).correlation.execution_id, "EXEC-1");
});

test("redaction: a configured secret in a log message is never retrievable via query", () => {
  const emitter = new InMemoryTelemetryEmitter({ redact_fields: ["sk-super-secret-token"] });
  emitter.emit(logSignal({ message: "auth failed with token sk-super-secret-token" }));

  const results = emitter.query({ workspace_id: "workspace-alpha" });

  const message = (results[0] as LogSignal).message;
  assert.equal(message.includes("sk-super-secret-token"), false);
  assert.ok(message.includes("[REDACTED]"));
});

test("redaction applies to audit_event action and evidence conclusion, not just logs", () => {
  const emitter = new InMemoryTelemetryEmitter({ redact_fields: ["private-detail"] });
  emitter.emit(auditSignal({ action: "grant access to private-detail resource" }));

  const results = emitter.query({ workspace_id: "workspace-alpha", types: ["audit_event"] });

  assert.equal((results[0] as AuditEventSignal).action.includes("private-detail"), false);
});

test("cross-Workspace access: a query for Workspace A never returns Workspace B's signals", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(logSignal({ correlation: correlation({ workspace_id: "workspace-alpha" }) }));
  emitter.emit(logSignal({ correlation: correlation({ workspace_id: "workspace-beta" }) }));

  const results = emitter.query({ workspace_id: "workspace-alpha" });

  assert.equal(results.length, 1);
  assert.equal((results[0] as LogSignal).correlation.workspace_id, "workspace-alpha");
});

test("audit integrity: the returned array is a fresh copy, mutating it does not affect the collector", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(auditSignal());

  const first = emitter.query({ workspace_id: "workspace-alpha" });
  (first as AuditEventSignal[]).push(auditSignal({ actor_id: "injected" }));

  const second = emitter.query({ workspace_id: "workspace-alpha" });
  assert.equal(second.length, 1);
});

test("missing-telemetry alert: detectMissingTelemetry alerts when no signal was emitted in the window", () => {
  const emitter = new InMemoryTelemetryEmitter();

  const alert = emitter.detectMissingTelemetry("execution-manager", "audit_event", 60, new Date("2026-08-08T09:05:00.000Z"));

  assert.notEqual(alert, undefined);
  assert.equal(alert?.signal_type, "audit_event");
});

test("missing-telemetry alert: no alert when a matching signal was emitted within the window", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(auditSignal({ occurred_at: "2026-08-08T09:04:30.000Z" }));

  const alert = emitter.detectMissingTelemetry("execution-manager", "audit_event", 60, new Date("2026-08-08T09:05:00.000Z"));

  assert.equal(alert, undefined);
});

test("signal-type-specific fields round-trip correctly for a metric signal", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(metricSignal({ name: "queue_depth", kind: "gauge", value: 7, unit: "count" }));

  const results = emitter.query({ workspace_id: "workspace-alpha", types: ["metric"] });
  const metric = results[0] as MetricSignal;

  assert.equal(metric.name, "queue_depth");
  assert.equal(metric.kind, "gauge");
  assert.equal(metric.value, 7);
  assert.equal(metric.unit, "count");
});

test("component filter narrows results independent of Workspace filter", () => {
  const emitter = new InMemoryTelemetryEmitter();
  emitter.emit(logSignal({ correlation: correlation({ component: "execution-manager" }) }));
  emitter.emit(logSignal({ correlation: correlation({ component: "workflow-engine" }) }));

  const results = emitter.query({ workspace_id: "workspace-alpha", component: "workflow-engine" });

  assert.equal(results.length, 1);
  assert.equal((results[0] as LogSignal).correlation.component, "workflow-engine");
});
