---
id: SPEC-606
title: Agent Execution Lifecycle
version: 1.0.0
status: accepted
owner:
  - Runtime Platform
depends_on:
  - SPEC-410
  - SPEC-508
  - SPEC-509
  - SPEC-510
  - SPEC-601
  - SPEC-605
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-010
  - ADR-011
  - ADR-012
  - ADR-013
  - ADR-014
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/RUNTIME_REVIEW.yaml
---

# SPEC-606: Agent Execution Lifecycle

## 1. Purpose

This specification defines the durable state, transition, approval, budget, cancellation, and recovery behavior of an Agent run.

## 2. States

```text
requested → resolving → awaiting_authorization → ready → running
running ↔ awaiting_approval
running ↔ suspended
running → validating → completed
any non-terminal → failed | cancelled | timed_out | blocked
```

Transitions are monotonic, version-checked, evented, and Workspace-scoped. `completed` requires output validation, evidence finalization, and cleanup outcome. `blocked` requires a concrete unmet dependency or authority, not ordinary uncertainty.

## 3. Step Lifecycle

Each step progresses through `proposed → authorized → executing → observed → validated → committed`. Denied proposals never execute. A side-effecting step is committed only after effect status is known. Unknown effect suspends the run.

## 4. Limits and Termination

Runtime enforces maximum steps, wall time, model usage/cost, Tool calls/cost, retries, repeated action fingerprints, and no-progress iterations. Reaching a limit terminates or escalates according to policy; prompts cannot extend budgets.

## 5. Recovery

Recovery reconstructs context from durable references, validates all pinned versions and policy, and resumes only after verifying outstanding side effects. Changes that invalidate authority or compatibility block resume and require a new run.

## 6. Required Evidence

Every terminal run records resolved versions, state transitions, approvals, externally explainable step decisions, rule results, Skill and Tool calls, observations, citations, budgets, failures, output validation, cleanup, and Knowledge Candidates proposed. Hidden reasoning is neither stored nor required.

## 7. Concurrency, Cancellation, and Failure Attribution

One version-checked writer advances a run revision. Duplicate commands are idempotent; stale workers and late observations cannot overwrite a newer or terminal state. Cancellation is monotonic, prevents new steps, revokes active leases, requests bounded provider/Tool cancellation, reconciles side effects, runs cleanup, and records any incomplete effect. Subject, policy, provider, Skill, Tool, infrastructure, evaluator, and orchestration failures remain distinct.

## 8. Observability and Quality Gates

Signals SHALL expose state and step age, progress, pending approval, consumed/remaining budgets, retries, denials, effect status, cancellation, recovery, cleanup, evidence completeness, and failure class with Workspace-safe correlation. The lifecycle passes state-machine, race, crash, replay, no-progress, budget, approval, timeout, cancellation, unknown-effect, cleanup, migration, and cross-Workspace tests. A completed run is impossible without contract-valid output and finalized evidence.

## 9. Definition of Done

- runtime transitions and terminal meanings are machine-testable and provider-neutral
- crash recovery does not duplicate unknown or non-idempotent effects
- all limits and approvals are enforced outside prompts
- exact versions and authority can be reconstructed for every run
- no unresolved lifecycle decision blocks implementation
