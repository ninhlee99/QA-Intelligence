import assert from "node:assert/strict";
import test from "node:test";

import {
  AssessReportQuality,
  ReportQualityRuleEngine,
  type Clock,
  type IdFactory,
  type ReportReviewConfiguration,
  type ReportReviewRequest,
} from "../../src/reporting/assess-report-quality.js";
import type {
  KnowledgeSearch,
  KnowledgeSearchResult,
  WorkspaceAuthorizer,
  WorkspaceAuthorizationResult,
} from "../../src/requirement-review/public.js";
import type { Report } from "../../src/reporting/public.js";

class FixedClock implements Clock {
  now(): Date {
    return new Date("2026-08-05T08:00:00.000Z");
  }
}

class SequenceIds implements IdFactory {
  #next = 0;
  next(scope: "assessment" | "finding"): string {
    this.#next += 1;
    return `${scope}-${this.#next}`;
  }
}

class AllowingAuthorizer implements WorkspaceAuthorizer {
  authorize(): Promise<WorkspaceAuthorizationResult> {
    return Promise.resolve({
      ok: true,
      value: {
        policy_version: "policy-3",
        effective_permissions: ["report:read", "knowledge:read", "assessment:create"],
        authorized_resource_refs: ["workspace:workspace-alpha", "RPT-1@1.0.0"],
        decision_evidence: ["policy:allow-report-assessment"],
      },
    });
  }
}

class EmptyKnowledgeSearch implements KnowledgeSearch {
  search(): Promise<KnowledgeSearchResult> {
    return Promise.resolve({
      ok: true,
      value: { hits: [], knowledge_snapshot: "1.0.0", projection_freshness: "current", warnings: [] },
    });
  }
}

const configuration: ReportReviewConfiguration = {
  resolved_versions: {
    agent: "reporting-agent@1.0.0",
    skill: "assess-report-quality@1.0.0",
    rule_set: "report-quality@1.0.0",
    knowledge_snapshot: "1.0.0",
    policy: "policy@3.0.0",
    input_schema: "report.schema.json@1.0.0",
    output_schema: "report-assessment.schema.json@1.0.0",
  },
  limits: { knowledge_hits: 5 },
};

function completeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "RPT-1",
    version: "1.0.0",
    report_type: "release_readiness",
    audience: "Release approvers",
    purpose: "Assess release readiness for the 2026.08.1 cut.",
    workspace_scope: "workspace-alpha",
    reporting_period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-05T00:00:00.000Z" },
    generated_at: "2026-08-05T08:00:00.000Z",
    source_artifact_refs: ["EXEC-1@1.0.0"],
    metrics: [
      {
        id: "pass-rate",
        owner: "Quality Engineering",
        definition: "Percentage of executions that passed.",
        numerator: "count(passed)",
        denominator: "count(total)",
        source_ref: "EXEC-1@1.0.0",
        update_cadence: "per release",
      },
    ],
    findings: ["Overall pass rate is 98%."],
    drill_down_refs: ["EXEC-1@1.0.0#outcome"],
    ...overrides,
  };
}

function reviewRequest(report: Report = completeReport()): ReportReviewRequest {
  return {
    operation_id: "operation-1",
    workspace_id: "workspace-alpha",
    context: {
      schema_version: "1.0.0",
      workspace_id: "workspace-alpha",
      actor_id: "reviewer-1",
      actor_type: "human",
      roles: ["quality-governance"],
      permissions: ["report:read", "knowledge:read", "assessment:create"],
      policy_version: "policy-3",
      request_id: "request-1",
      correlation_id: "correlation-1",
      audience: ["qa-intelligence"],
      environment: "test",
      issued_at: "2026-08-05T07:00:00.000Z",
      expires_at: "2026-08-05T09:00:00.000Z",
      issuer: "identity-test",
      integrity_proof: "signed-test-context",
    },
    report,
  };
}

function reviewer(): AssessReportQuality {
  return new AssessReportQuality({
    authorizer: new AllowingAuthorizer(),
    knowledge: new EmptyKnowledgeSearch(),
    rules: new ReportQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  });
}

test("a complete report passes with no findings", async () => {
  const result = await reviewer().review(reviewRequest());

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "pass");
  assert.equal(result.value.findings.length, 0);
});

test("a hidden critical exception is rejected", async () => {
  const result = await reviewer().review(
    reviewRequest(completeReport({ critical_exceptions: ["Cross-Workspace data leak in staging"] })),
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "rejected");
});

test("a report with no source artifacts blocks without a false rejected label", async () => {
  const result = await reviewer().review(reviewRequest(completeReport({ source_artifact_refs: [] })));

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.verdict, "changes_required");
});

test("rejects a review whose report Workspace scope does not match the requested Workspace", async () => {
  const result = await reviewer().review(reviewRequest(completeReport({ workspace_scope: "workspace-other" })));

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "workspace_scope_mismatch");
});

test("rejects an unauthorized review before discovery or rules run", async () => {
  const deniedAuthorizer: WorkspaceAuthorizer = {
    authorize: () =>
      Promise.resolve({
        ok: false,
        failure: { code: "insufficient_permission", message: "denied", retryable: false, evidence: [] },
      }),
  };
  const result = await new AssessReportQuality({
    authorizer: deniedAuthorizer,
    knowledge: new EmptyKnowledgeSearch(),
    rules: new ReportQualityRuleEngine(),
    clock: new FixedClock(),
    ids: new SequenceIds(),
    configuration,
  }).review(reviewRequest());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.class, "authorization");
  assert.equal(result.failure.outcome, "blocked");
});
