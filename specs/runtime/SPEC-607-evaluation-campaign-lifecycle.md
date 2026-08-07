---
id: SPEC-607
title: Evaluation Campaign Lifecycle
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Runtime Platform
depends_on:
  - SPEC-411
  - SPEC-508
  - SPEC-511
  - SPEC-606
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-017
  - ADR-013
  - ADR-014
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/RUNTIME_REVIEW.yaml
---

# SPEC-607: Evaluation Campaign Lifecycle

## 1. Purpose

This specification defines the reproducible lifecycle for evaluating and releasing an Agent or Skill version.

## 2. States

```text
draft → validating → ready → running → analyzing → awaiting_review
awaiting_review → approved | conditionally_approved | rejected | indeterminate
any non-terminal → blocked | cancelled | failed
```

`approved` is an evaluation outcome only; the release governance gate remains separate.

## 3. Trial Scheduling

Ready campaigns pin every version and create the declared trial matrix. Trials are isolated, receive stable identities and budgets, and retain all attempts. Fail-fast is allowed only for a blocking invariant; remaining cases are marked not executed, never passed.

## 4. Analysis

Analysis validates evidence completeness, classifies failures, executes deterministic oracles, applies eligible Judges, calculates dispersion, checks critical invariants, compares the baseline, and identifies all changed conditions. Missing evidence or unresolved Judge disagreement produces `indeterminate`.

## 5. Approval and Override

An authorized reviewer receives the full report, critical failures, uncertainty, and changed conditions. Overrides require scope, justification, compensating control, expiry, and approval; they cannot override Workspace isolation, unauthorized destructive action, evidence tampering, or critical security failure.

## 6. Retention and Learning

Campaign definitions, reports, verdicts, and gate evidence follow governance retention. Sensitive fixtures and raw traces follow stricter data policy. Observed improvements become Knowledge Candidates and cannot directly alter Agent, Skill, rules, prompts, or accepted knowledge.

## 7. Concurrency, Recovery, and Cancellation

Campaign and trial transitions use optimistic revisions and idempotency. Duplicate dispatch does not count as an additional trial; stale workers cannot finalize current trials. Recovery validates all pinned versions, evaluator health, leases, isolation, and cleanup before resuming. Cancellation prevents new trials, cancels bounded active work, performs cleanup, and retains partial results without issuing a favorable recommendation.

## 8. Observability and Quality Gates

Signals SHALL expose campaign/trial state age, queueing, outcome and failure classification, variance, critical assertions, evaluator disagreement/error, contamination, baseline condition changes, cost, cleanup, evidence completeness, adjudication, and overrides. The lifecycle passes deterministic/replay, repeated-trial, concurrency, critical-invariant, evaluator-outage, injected-Judge, incomplete-evidence, comparison, cancellation, recovery, retention, and Workspace-isolation tests.

## 9. Definition of Done

- every outcome traces to exact subject, suite, case, trial, evaluator, environment, policy, and evidence versions
- subject, evaluator, infrastructure, and invalid-test failures cannot be conflated
- critical invariants cannot be averaged away or overridden
- evaluation approval remains separate from release approval
- no unresolved lifecycle decision blocks implementation
