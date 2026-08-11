---
id: SPEC-602
title: Execution Lifecycle Runtime
version: 1.0.0
status: accepted
owner:
  - Execution Platform
depends_on:
  - SPEC-210
  - SPEC-404
  - SPEC-504
  - SPEC-601
related_adrs:
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/RUNTIME_REVIEW.yaml
---

# SPEC-602: Execution Lifecycle Runtime

## 1. Purpose

This specification defines authoritative runtime states, transitions, timers, retries, cancellation, cleanup, and finalization for test executions.

This specification is the single source of truth for runtime execution transitions. SPEC-210 owns product outcomes; SPEC-504 owns the provider contract; SPEC-404 implements lifecycle coordination.

## 2. States

```text
planned → queued → preparing → running → collecting_evidence
   ↓         ↓          ↓          ↓              ↓
cancelled  blocked   failed     timed_out      completed | failed
```

Terminal states are `completed`, `failed`, `cancelled`, `timed_out`, and `blocked` when policy declares it terminal.

## 3. Transition Rules

Every transition SHALL validate current revision, triggering actor/event, Workspace, permitted source state, required evidence, and side-effect status.

Late or duplicate transitions SHALL be idempotently ignored or recorded as conflicts.

## 4. Attempts

Retries create distinct attempts under one execution. Original results and evidence remain immutable. Eligibility depends on classified failure, risk, limits, and state reset.

## 5. Cancellation and Timeout

Cancellation is cooperative but bounded. Timeout initiates termination and cleanup. Late provider completion SHALL not replace the terminal platform outcome.

## 6. Cleanup

Environment leases, browser sessions, temporary data, credentials, and artifacts SHALL be released or moved to governed retention. Cleanup failure is observable and owned.

## 7. Finalization

Final outcome SHALL include exact inputs, attempts, assertions, evidence completeness, infrastructure status, timing, and traceability.

## 8. Quality Gates

Lifecycle passes when all state paths, races, retries, late events, cancellation, timeout, cleanup, and recovery paths are verified.

## 9. Persistence, Recovery, and Observability

The lifecycle revision, attempt history, effect status, evidence references, leases, and cleanup outcome SHALL be durable. Transactional event handoff prevents committed state without its notification. Recovery validates version, lease fencing, authorization, and unknown effects before resuming. Metrics SHALL expose state age, transition conflicts, retries, late events, cancellation/timeout latency, worker loss, cleanup failure, infrastructure outcomes, and evidence completeness.

## 10. Summary

The execution lifecycle makes every attempt and outcome explicit, durable, and explainable.
