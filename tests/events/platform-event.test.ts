import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlatformEvent,
  platformEventDigest,
  toOutboxRecord,
  verifyPlatformEventIntegrity,
  type PlatformEventInput,
} from "../../src/events/public.js";

function validInput(overrides: Partial<PlatformEventInput> = {}): PlatformEventInput {
  return {
    event_id: "event-001",
    event_type: "requirement.reviewed",
    schema_version: "1.0.0",
    occurred_at: "2026-08-06T09:00:00.000Z",
    recorded_at: "2026-08-06T09:00:00.100Z",
    producer_id: "requirement-review-agent",
    producer_version: "0.1.0",
    workspace_id: "workspace-events-001",
    actor_id: "actor-001",
    correlation_id: "correlation-001",
    aggregate_id: "REQ-1@1.0.0",
    aggregate_sequence: 1,
    payload: { verdict: "pass" },
    classification: "internal",
    ...overrides,
  };
}

test("a complete event builds successfully with a deterministic integrity digest (SPEC-505 §2)", () => {
  const result = buildPlatformEvent(validInput());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.integrity_algorithm, "sha256");
  assert.match(result.value.integrity_digest, /^sha256:[0-9a-f]{64}$/);
});

test("causation_id defaults to correlation_id when omitted (SPEC-505 §2, a root event is its own cause)", () => {
  const result = buildPlatformEvent(validInput());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.causation_id, result.value.correlation_id);
});

test("an explicit causation_id is preserved when a different one is supplied", () => {
  const result = buildPlatformEvent(validInput({ causation_id: "causation-999" }));

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.causation_id, "causation-999");
});

test("building is deterministic: identical input produces an identical digest", () => {
  const first = buildPlatformEvent(validInput());
  const second = buildPlatformEvent(validInput());

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value.integrity_digest, second.value.integrity_digest);
});

test("a missing required field fails closed, reporting every violation at once", () => {
  const result = buildPlatformEvent(
    validInput({ producer_id: "", actor_id: undefined as unknown as string }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  const codes = result.failures.map((failure) => failure.field).sort();
  assert.deepEqual(codes, ["actor_id", "producer_id"]);
});

test("a negative or non-integer aggregate_sequence fails closed", () => {
  const negative = buildPlatformEvent(validInput({ aggregate_sequence: -1 }));
  const fractional = buildPlatformEvent(validInput({ aggregate_sequence: 1.5 }));

  assert.equal(negative.ok, false);
  assert.equal(fractional.ok, false);
});

test("recorded_at earlier than occurred_at fails closed — a fact cannot be recorded before it happened", () => {
  const result = buildPlatformEvent(
    validInput({ occurred_at: "2026-08-06T09:00:00.000Z", recorded_at: "2026-08-06T08:59:59.000Z" }),
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failures[0]?.code, "invalid_timestamp_order");
});

test("a command-shaped payload is rejected — events describe facts, not commands (SPEC-505 §3)", () => {
  const result = buildPlatformEvent(validInput({ payload: { command: "cancel_run" } }));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failures[0]?.code, "ambiguous_command_payload");
});

test("a fact-shaped payload with a field that merely contains the word is not penalized", () => {
  const result = buildPlatformEvent(validInput({ payload: { command_history_ref: "evidence://run-1" } }));

  assert.equal(result.ok, true, JSON.stringify(result));
});

test("verifyPlatformEventIntegrity accepts an untampered event and rejects a tampered one", () => {
  const built = buildPlatformEvent(validInput());
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.equal(verifyPlatformEventIntegrity(built.value), true);

  const tampered = { ...built.value, payload: { verdict: "fail" } };
  assert.equal(verifyPlatformEventIntegrity(tampered), false);
});

test("platformEventDigest is stable regardless of caller field ordering", () => {
  const built = buildPlatformEvent(validInput());
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const { integrity_algorithm: _a, integrity_digest: _d, event_id, ...rest } = built.value;
  const reordered = { ...rest, event_id };
  assert.equal(platformEventDigest(reordered), built.value.integrity_digest);
});

test("toOutboxRecord converts a built event into the exact OutboxPublisher shape (SPEC-505 §7 delivery)", () => {
  const built = buildPlatformEvent(validInput());
  assert.equal(built.ok, true);
  if (!built.ok) return;

  const record = toOutboxRecord(built.value, 2);

  assert.equal(record.event_id, built.value.event_id);
  assert.equal(record.integrity_digest, built.value.integrity_digest);
  assert.equal(record.attempt_count, 2);
});

test("toOutboxRecord defaults attempt_count to 0 for a first attempt", () => {
  const built = buildPlatformEvent(validInput());
  assert.equal(built.ok, true);
  if (!built.ok) return;

  assert.equal(toOutboxRecord(built.value).attempt_count, 0);
});

test("a global-scope event (workspace_id: 'global') builds successfully (SPEC-505 §2)", () => {
  const result = buildPlatformEvent(validInput({ workspace_id: "global" }));

  assert.equal(result.ok, true, JSON.stringify(result));
});
