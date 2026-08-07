import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { InMemoryRuleRepository } from "../../src/adapters/memory/in-memory-rule-repository.js";
import { stableStringify } from "../../src/shared/stable-stringify.js";
import type { Rule } from "../../src/rule-repository/public.js";
import type { WorkspaceContext } from "../../src/requirement-review/public.js";

function workspaceContext(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    schema_version: "1.0.0",
    workspace_id: "workspace-alpha",
    actor_id: "actor-rule-001",
    actor_type: "human",
    roles: ["rule-editor"],
    permissions: ["rule:write"],
    policy_version: "policy@1.0.0",
    request_id: "request-rule-001",
    correlation_id: "correlation-rule-001",
    audience: ["qa-intelligence"],
    environment: "test",
    issued_at: "2026-08-07T09:00:00.000Z",
    expires_at: "2026-08-07T11:00:00.000Z",
    issuer: "identity-test",
    integrity_proof: "signed-context",
    ...overrides,
  };
}

function draft(overrides: Partial<Omit<Rule, "status">> = {}): Omit<Rule, "status"> {
  return {
    id: "risk-has-controls",
    version: "1.0.0",
    title: "Risk must have recorded controls",
    authority: ["Rule Governance"],
    owner: "actor-rule-001",
    workspace_scope: "global",
    applies_when: "risk.controls.length === 0",
    inputs: ["risk.controls"],
    decision: "critical",
    outputs: ["finding:treatment_governance"],
    priority: 0,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_until: null,
    explanation_template: "The risk has no recorded controls.",
    tests: ["test:risk-has-controls-missing"],
    ...overrides,
  };
}

function makeRepository(): InMemoryRuleRepository {
  return new InMemoryRuleRepository({ now: () => new Date("2026-08-07T09:30:00.000Z") });
}

test("saveDraft creates a new draft Rule at revision 1", async () => {
  const repository = makeRepository();
  const result = await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "draft");
});

test("saveDraft is idempotent under the same idempotency_key", async () => {
  const repository = makeRepository();
  const first = await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });
  const second = await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first, second);
});

test("saveDraft rejects a Workspace-scoped draft outside the trusted Workspace context", async () => {
  const repository = makeRepository();
  const result = await repository.saveDraft({
    context: workspaceContext({ workspace_id: "workspace-beta" }),
    draft: draft({ workspace_scope: "workspace-alpha" }),
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unauthorized_override");
});

test("saveDraft rejects a conflicting effective range", async () => {
  const repository = makeRepository();
  const result = await repository.saveDraft({
    context: workspaceContext(),
    draft: draft({ effective_from: "2026-06-01T00:00:00.000Z", effective_until: "2026-01-01T00:00:00.000Z" }),
    idempotency_key: "idem-1",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "conflicting_effective_range");
});

test("recordLifecycleTransition with a stale expected_revision is rejected (concurrency)", async () => {
  const repository = makeRepository();
  await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });

  const result = await repository.recordLifecycleTransition({
    context: workspaceContext(),
    id: "risk-has-controls",
    expected_revision: 99,
    to_status: "in_review",
    actor_id: "actor-rule-001",
    reason: "submit for review",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "conflict");
});

test("recordLifecycleTransition follows draft -> in_review -> accepted", async () => {
  const repository = makeRepository();
  await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });

  const inReview = await repository.recordLifecycleTransition({
    context: workspaceContext(),
    id: "risk-has-controls",
    expected_revision: 1,
    to_status: "in_review",
    actor_id: "actor-rule-001",
    reason: "submit for review",
    policy_version: "policy@1.0.0",
  });
  assert.equal(inReview.ok, true, JSON.stringify(inReview));
  if (!inReview.ok) return;

  const accepted = await repository.recordLifecycleTransition({
    context: workspaceContext(),
    id: "risk-has-controls",
    expected_revision: 2,
    to_status: "accepted",
    actor_id: "actor-rule-001",
    reason: "approved",
    policy_version: "policy@1.0.0",
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  if (!accepted.ok) return;
  assert.equal(accepted.value.status, "accepted");
});

test("recordLifecycleTransition rejects an illegal jump from draft to accepted", async () => {
  const repository = makeRepository();
  await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });

  const result = await repository.recordLifecycleTransition({
    context: workspaceContext(),
    id: "risk-has-controls",
    expected_revision: 1,
    to_status: "accepted",
    actor_id: "actor-rule-001",
    reason: "skip review",
    policy_version: "policy@1.0.0",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.code, "unsupported_transition");
});

test("resolveApplicableRuleSet excludes a rule outside its effective period (historical time)", async () => {
  const repository = makeRepository();
  await repository.saveDraft({
    context: workspaceContext(),
    draft: draft({ effective_from: "2020-01-01T00:00:00.000Z", effective_until: "2021-01-01T00:00:00.000Z" }),
    idempotency_key: "idem-1",
  });
  await acceptDraft(repository, "risk-has-controls", 1);

  const result = await repository.resolveApplicableRuleSet({
    context: workspaceContext(),
    rule_set_id: "risk-has-controls",
    effective_at: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 0);
});

test("resolveApplicableRuleSet returns candidates without ranking them (SPEC-402 §2)", async () => {
  const repository = makeRepository();
  await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });
  await acceptDraft(repository, "risk-has-controls", 1);

  const result = await repository.resolveApplicableRuleSet({
    context: workspaceContext(),
    rule_set_id: "risk-has-controls",
    effective_at: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0]?.id, "risk-has-controls");
});

test("Workspace isolation: a Workspace-scoped rule is invisible to another Workspace", async () => {
  const repository = makeRepository();
  await repository.saveDraft({
    context: workspaceContext(),
    draft: draft({ workspace_scope: "workspace-alpha" }),
    idempotency_key: "idem-1",
  });
  await acceptDraft(repository, "risk-has-controls", 1);

  const result = await repository.resolveApplicableRuleSet({
    context: workspaceContext({ workspace_id: "workspace-beta" }),
    rule_set_id: "risk-has-controls",
    effective_at: "2026-06-01T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.length, 0);
});

test("getExactVersion reproduces a historical version after a rule is accepted (historical retrieval)", async () => {
  const repository = makeRepository();
  await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });
  await acceptDraft(repository, "risk-has-controls", 1);

  const result = await repository.getExactVersion(workspaceContext(), "risk-has-controls", "1.0.0");

  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.value.status, "accepted");
});

test("validatePackageIntegrity confirms a matching digest and rejects a wrong one", async () => {
  const repository = makeRepository();
  const saved = await repository.saveDraft({ context: workspaceContext(), draft: draft(), idempotency_key: "idem-1" });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;

  const expectedDigest = `sha256:${createHash("sha256").update(stableStringify(saved.value)).digest("hex")}`;
  const matching = await repository.validatePackageIntegrity({
    context: workspaceContext(),
    id: "risk-has-controls",
    version: "1.0.0",
    expected_digest: expectedDigest,
  });
  assert.equal(matching.ok, true, JSON.stringify(matching));
  if (matching.ok) assert.equal(matching.value.matches, true);

  const mismatched = await repository.validatePackageIntegrity({
    context: workspaceContext(),
    id: "risk-has-controls",
    version: "1.0.0",
    expected_digest: "sha256:wrong",
  });
  assert.equal(mismatched.ok, false);
  if (mismatched.ok) return;
  assert.equal(mismatched.failure.code, "invalid_signature");
});

async function acceptDraft(repository: InMemoryRuleRepository, id: string, revision: number): Promise<void> {
  const inReview = await repository.recordLifecycleTransition({
    context: workspaceContext({ workspace_id: "workspace-alpha" }),
    id,
    expected_revision: revision,
    to_status: "in_review",
    actor_id: "actor-rule-001",
    reason: "submit for review",
    policy_version: "policy@1.0.0",
  });
  assert.equal(inReview.ok, true, JSON.stringify(inReview));
  const accepted = await repository.recordLifecycleTransition({
    context: workspaceContext({ workspace_id: "workspace-alpha" }),
    id,
    expected_revision: revision + 1,
    to_status: "accepted",
    actor_id: "actor-rule-001",
    reason: "approved",
    policy_version: "policy@1.0.0",
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
}
