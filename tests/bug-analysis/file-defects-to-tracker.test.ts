import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildTrackerPayloads, fileDefectsToTracker } from "../../src/bug-analysis/file-defects-to-tracker.js";
import type { Defect } from "../../src/bug-analysis/public.js";
import { FileBackedKnowledgeSearch } from "../../src/knowledge/file-backed-knowledge-search.js";

const defect: Defect = {
  id: "DEF-1",
  version: "1.0.0",
  status: "draft",
  summary: "Login fails on valid credentials",
  observed_behavior: "Error toast",
  expected_behavior: "Welcome",
  expected_behavior_authority: "REQ-1@1.0.0#AC-1",
  workspace_scope: "ws-1",
  environment_ref: "env:test",
  reproduction_conditions: ["Open login", "Submit valid user"],
  evidence: ["capture:1"],
  severity: "high",
  severity_rationale: "Blocks sign-in",
  priority: "p1",
  classification: "product_defect",
  suspected_cause: "Auth handler rejects valid token",
  owner: "qa",
};

test("buildTrackerPayloads shapes jira and linear bodies", () => {
  const jira = buildTrackerPayloads({
    defects: [defect],
    provider: "jira_rest",
    base_url: "https://example.atlassian.net",
    project_or_team: "QA",
  });
  assert.equal(jira[0]?.url, "https://example.atlassian.net/rest/api/2/issue");
  const linear = buildTrackerPayloads({
    defects: [defect],
    provider: "linear_graphql",
    base_url: "https://api.linear.app",
    project_or_team: "team-1",
  });
  assert.equal(linear[0]?.url, "https://api.linear.app/graphql");
});

test("fileDefectsToTracker dry-run does not call fetch", async () => {
  let calls = 0;
  const result = await fileDefectsToTracker({
    defects: [defect],
    provider: "webhook",
    base_url: "https://hooks.example/qa",
    bearer_token: "token",
    project_or_team: "",
    confirm_file: false,
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dry_run, true);
  assert.equal(calls, 0);
  assert.equal(result.value.payloads.length, 1);
});

test("fileDefectsToTracker confirm_file posts once", async () => {
  let calls = 0;
  const result = await fileDefectsToTracker({
    defects: [defect],
    provider: "webhook",
    base_url: "https://hooks.example/qa",
    bearer_token: "token",
    project_or_team: "",
    confirm_file: true,
    fetchImpl: (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.dry_run, false);
  assert.equal(calls, 1);
  assert.equal(result.value.results[0]?.ok, true);
});

test("FileBackedKnowledgeSearch upserts and reloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qa-knowledge-"));
  try {
    const first = new FileBackedKnowledgeSearch({
      rootDir: dir,
      workspace_id: "ws-1",
      knowledge_snapshot: "0.1.0",
      projection_freshness: "2026-08-11T00:00:00.000Z",
    });
    const upserted = first.upsertRecord({
      workspace_id: "ws-1",
      knowledge_snapshot: "0.1.0",
      knowledge_ref: "knowledge:login",
      title: "Login",
      excerpt: "Users sign in with email",
      authority_status: "accepted",
      scopes: ["product-context"],
      applicability: { workspace_id: "ws-1" },
      provenance: ["test"],
      evidence: [],
    });
    assert.equal(upserted.ok, true);

    const second = new FileBackedKnowledgeSearch({
      rootDir: dir,
      workspace_id: "ws-1",
      knowledge_snapshot: "0.1.0",
      projection_freshness: "2026-08-11T00:00:00.000Z",
    });
    assert.equal(second.listRecords().length, 1);
    assert.equal(second.listRecords()[0]?.knowledge_ref, "knowledge:login");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
