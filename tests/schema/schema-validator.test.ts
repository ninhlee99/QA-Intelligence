import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SchemaValidator } from "../../src/schema/schema-validator.js";

const USER_SCHEMA = {
  $id: "https://qa-intelligence.test/schemas/user",
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["name", "email"],
  properties: {
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email" },
  },
} as const;

interface User {
  readonly name: string;
  readonly email: string;
}

test("returns the original value when it conforms to the selected schema", () => {
  const validator = new SchemaValidator([USER_SCHEMA]);
  const value = { name: "Ada", email: "ada@example.com" };

  const result = validator.validate<User>(USER_SCHEMA.$id, value);

  assert.deepEqual(result, { ok: true, value });
});

test("returns provider-neutral paths and messages for every validation failure", () => {
  const validator = new SchemaValidator([USER_SCHEMA]);

  const result = validator.validate<User>(USER_SCHEMA.$id, {
    name: "",
    email: "not-an-email",
  });

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        path: "/name",
        keyword: "minLength",
        message: "Value is shorter than the allowed minimum.",
      },
      {
        path: "/email",
        keyword: "format",
        message: "Value does not match the required format.",
      },
    ],
  });
});

test("reports an unknown schema through the stable result instead of throwing", () => {
  const validator = new SchemaValidator([USER_SCHEMA]);

  const result = validator.validate("https://qa-intelligence.test/schemas/missing", {});

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        path: "",
        keyword: "unknown_schema",
        message:
          "Schema is not registered: https://qa-intelligence.test/schemas/missing",
      },
    ],
  });
});

test("rejects properties that the schema does not declare", () => {
  const validator = new SchemaValidator([USER_SCHEMA]);

  const result = validator.validate<User>(USER_SCHEMA.$id, {
    name: "Ada",
    email: "ada@example.com",
    role: "admin",
  });

  assert.deepEqual(result, {
    ok: false,
    errors: [
      {
        path: "/role",
        keyword: "additionalProperties",
        message: "Property is not allowed.",
      },
    ],
  });
});

test("governed schemas reject unresolved versions, unversioned event payloads, and contradictory evaluation recommendations", async () => {
  const paths = [
    "schemas/requirement-assessment.schema.json",
    "schemas/agent-run-event.schema.json",
    "schemas/agent-run-event-payload.schema.json",
    "schemas/evaluation-result.schema.json",
  ] as const;
  const schemas = await Promise.all(
    paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  const validator = new SchemaValidator(schemas);

  const assessment = JSON.parse(
    await readFile("examples/assessments/requirement-assessment.example.json", "utf8"),
  ) as Record<string, unknown>;
  assessment["resolved_versions"] = {
    ...(assessment["resolved_versions"] as Record<string, unknown>),
    policy: "latest",
  };
  const unresolved = validator.validate(
    "https://qa-intelligence.local/schemas/requirement-assessment.schema.json",
    assessment,
  );
  assert.equal(unresolved.ok, false);

  const unversionedEvent = validator.validate(
    "https://qa-intelligence.local/schemas/agent-run-event.schema.json",
    {
      schema_version: "1.0.0",
      event_id: "event-1",
      run_id: "run-1",
      workspace_id: "workspace-1",
      sequence: 1,
      type: "authorization_granted",
      occurred_at: "2026-08-03T00:00:00.000Z",
      payload: {},
    },
  );
  assert.equal(unversionedEvent.ok, false);

  const contradictoryEvaluation = validator.validate(
    "https://qa-intelligence.local/schemas/evaluation-result.schema.json",
    {
      schema_version: "1.0.0",
      run_id: "evaluation-1",
      workspace_id: "workspace-1",
      subject: { type: "skill", id: "skill-1", version: "1.0.0" },
      suite: { id: "suite-1", version: "1.0.0" },
      resolved_versions: { policy: "policy@1.0.0" },
      trial_results: [{ case_id: "case-1", trial_id: "trial-1", outcome: "failed", failure_class: "subject", evidence: ["evidence://1"] }],
      critical_invariants: [{ id: "workspace-isolation", passed: true }],
      metrics: { total_trials: 1, passed_trials: 0, failed_trials: 1, blocked_trials: 0, indeterminate_trials: 0, critical_invariants_total: 1, critical_invariants_passed: 1, evidence_reference_count: 1, invalid_test_reasons: [] },
      verdict: "failed",
      recommendation: "recommend_release",
      evidence: ["evidence://1"],
      started_at: "2026-08-03T00:00:00.000Z",
      completed_at: "2026-08-03T00:00:01.000Z"
    },
  );
  assert.equal(contradictoryEvaluation.ok, false);
});
