import { createHash } from "node:crypto";

import type { JsonObject } from "../requirement-review/public.js";
import type { OutboxRecord } from "../evaluation/outbox-publisher.js";

/**
 * SPEC-505 (Platform Event Contract) §2's canonical envelope: "immutable
 * facts exchanged asynchronously across QA Intelligence components." Before
 * this module, the exact field set SPEC-505 §2 requires (event id/type,
 * schema version, occurred+recorded timestamps, producer identity+version,
 * Workspace/actor, correlation/causation ids, aggregate id+sequence,
 * payload, classification, integrity metadata) existed only inside
 * `OutboxRecord` (`src/evaluation/outbox-publisher.ts`) — a consumer-side
 * shape read back out of the transactional outbox, not a producer-facing
 * type any domain module could construct an event against before it
 * becomes an outbox row. `PlatformEvent` re-derives from that exact same
 * field set (proven correct against real SQLite/Postgres adapters and the
 * shared `runOutboxPublisherContract` suite) so a `PlatformEvent` is
 * trivially convertible to the `OutboxRecord` shape an
 * `OutboxPublisher`-backed producer needs, without a second, drifting
 * definition of what an event envelope contains.
 */
export type PlatformEventClassification = "public" | "internal" | "restricted" | "sensitive";

export type PlatformEvent = Readonly<{
  event_id: string;
  event_type: string;
  schema_version: string;
  occurred_at: string;
  recorded_at: string;
  producer_id: string;
  producer_version: string;
  /** SPEC-505 §2: "Workspace ID or explicit global scope." */
  workspace_id: string | "global";
  actor_id: string;
  correlation_id: string;
  causation_id: string;
  aggregate_id: string;
  aggregate_sequence: number;
  payload: JsonObject;
  classification: PlatformEventClassification;
  integrity_algorithm: "sha256";
  integrity_digest: string;
}>;

export type PlatformEventInput = Readonly<{
  event_id: string;
  event_type: string;
  schema_version: string;
  occurred_at: string;
  recorded_at: string;
  producer_id: string;
  producer_version: string;
  workspace_id: string | "global";
  actor_id: string;
  correlation_id: string;
  /** Defaults to `correlation_id` when omitted — a root event is its own cause (SPEC-505 §2). */
  causation_id?: string;
  aggregate_id: string;
  aggregate_sequence: number;
  payload: JsonObject;
  classification: PlatformEventClassification;
}>;

export type PlatformEventValidationFailure = Readonly<{
  code:
    | "missing_field"
    | "empty_field"
    | "invalid_timestamp_order"
    | "invalid_sequence"
    | "ambiguous_command_payload";
  field: string;
  message: string;
}>;

export type PlatformEventValidationResult =
  | Readonly<{ ok: true; value: PlatformEvent }>
  | Readonly<{ ok: false; failures: readonly PlatformEventValidationFailure[] }>;

const REQUIRED_STRING_FIELDS: readonly (keyof PlatformEventInput)[] = [
  "event_id",
  "event_type",
  "schema_version",
  "occurred_at",
  "recorded_at",
  "producer_id",
  "producer_version",
  "workspace_id",
  "actor_id",
  "correlation_id",
  "aggregate_id",
];

/**
 * Fields whose presence in a `command`-shaped payload signal the event is
 * being used as an ambiguous command rather than a completed fact (SPEC-505
 * §3: "Events describe completed facts and SHALL NOT be used as ambiguous
 * commands"). This is a heuristic guard against the most direct violation
 * (a payload that says "do X"), not a semantic proof of every possible
 * misuse.
 */
const COMMAND_SHAPED_PAYLOAD_KEYS = new Set(["command", "directive", "instruction", "requested_action"]);

/**
 * Constructs and validates a `PlatformEvent` from producer-supplied input,
 * computing its `integrity_digest` deterministically over every other
 * field so a consumer can independently verify the envelope was not
 * altered in transit (SPEC-505 §2 "integrity metadata"). Fails closed with
 * every violated rule reported at once rather than the first one found, so
 * a producer fixing a malformed event does not have to re-submit
 * repeatedly to discover each problem in turn.
 */
export function buildPlatformEvent(input: PlatformEventInput): PlatformEventValidationResult {
  const failures: PlatformEventValidationFailure[] = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) {
      failures.push({ code: "missing_field", field, message: `${field} is required.` });
    } else if (typeof value === "string" && value.trim().length === 0) {
      failures.push({ code: "empty_field", field, message: `${field} SHALL NOT be empty.` });
    }
  }

  if (!Number.isInteger(input.aggregate_sequence) || input.aggregate_sequence < 0) {
    failures.push({
      code: "invalid_sequence",
      field: "aggregate_sequence",
      message: "aggregate_sequence SHALL be a non-negative integer.",
    });
  }

  if (
    typeof input.occurred_at === "string" &&
    typeof input.recorded_at === "string" &&
    input.occurred_at.length > 0 &&
    input.recorded_at.length > 0 &&
    !Number.isNaN(Date.parse(input.occurred_at)) &&
    !Number.isNaN(Date.parse(input.recorded_at)) &&
    Date.parse(input.recorded_at) < Date.parse(input.occurred_at)
  ) {
    failures.push({
      code: "invalid_timestamp_order",
      field: "recorded_at",
      message: "recorded_at SHALL NOT be earlier than occurred_at — an event cannot be recorded before it occurred.",
    });
  }

  for (const key of Object.keys(input.payload)) {
    if (COMMAND_SHAPED_PAYLOAD_KEYS.has(key)) {
      failures.push({
        code: "ambiguous_command_payload",
        field: `payload.${key}`,
        message: `payload.${key} makes this event read as a command, not a completed fact (SPEC-505 §3).`,
      });
    }
  }

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const causationId = input.causation_id ?? input.correlation_id;
  const withoutDigest = {
    event_id: input.event_id,
    event_type: input.event_type,
    schema_version: input.schema_version,
    occurred_at: input.occurred_at,
    recorded_at: input.recorded_at,
    producer_id: input.producer_id,
    producer_version: input.producer_version,
    workspace_id: input.workspace_id,
    actor_id: input.actor_id,
    correlation_id: input.correlation_id,
    causation_id: causationId,
    aggregate_id: input.aggregate_id,
    aggregate_sequence: input.aggregate_sequence,
    payload: input.payload,
    classification: input.classification,
  };

  return {
    ok: true,
    value: {
      ...withoutDigest,
      integrity_algorithm: "sha256",
      integrity_digest: platformEventDigest(withoutDigest),
    },
  };
}

/** Recomputes the digest over an event's non-digest fields; a consumer compares this against `integrity_digest` to detect tampering. */
export function platformEventDigest(event: Omit<PlatformEvent, "integrity_algorithm" | "integrity_digest">): string {
  return `sha256:${createHash("sha256").update(stableStringify(event)).digest("hex")}`;
}

/** Independently re-verifies a constructed event's own digest (SPEC-505 §2 integrity metadata) — never trusts the stored digest without recomputing. */
export function verifyPlatformEventIntegrity(event: PlatformEvent): boolean {
  const { integrity_algorithm: _algorithm, integrity_digest: digest, ...rest } = event;
  return digest === platformEventDigest(rest);
}

/**
 * Converts a validated `PlatformEvent` into the exact `OutboxRecord` shape
 * `OutboxPublisher` (SPEC-505 §7's transactional-outbox delivery half)
 * requires — proving the "same field set" claim above by construction
 * rather than leaving it as an unverified comment. `attempt_count` is not
 * part of a domain event's own identity; it is outbox delivery state a
 * producer sets to `0` for a first attempt.
 */
export function toOutboxRecord(event: PlatformEvent, attemptCount = 0): OutboxRecord {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    producer_id: event.producer_id,
    producer_version: event.producer_version,
    workspace_id: event.workspace_id,
    actor_id: event.actor_id,
    correlation_id: event.correlation_id,
    causation_id: event.causation_id,
    aggregate_id: event.aggregate_id,
    aggregate_sequence: event.aggregate_sequence,
    payload: event.payload,
    classification: event.classification,
    integrity_algorithm: event.integrity_algorithm,
    integrity_digest: event.integrity_digest,
    attempt_count: attemptCount,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}
