---
id: SPEC-210
title: Test Execution
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Platform Engineering
depends_on:
  - SPEC-208
  - SPEC-209
  - GOV-009
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-210: Test Execution

## 1. Purpose

Test Execution plans, schedules, runs, observes, and records validation through provider-independent execution contracts.

This Product specification owns user-visible execution intent and canonical result meaning. SPEC-504 owns the engine protocol, SPEC-404 owns component responsibility, and SPEC-602 owns authoritative runtime transitions. State diagrams here are explanatory projections and SHALL NOT redefine SPEC-602.

## 2. Execution Contract

Every execution SHALL identify:

- execution ID
- Workspace and actor
- requested test and automation versions
- engine and plugin versions
- environment and configuration identity
- dataset versions
- schedule or trigger
- lifecycle state
- results and evidence
- timing and resource usage
- cancellation, retry, and parent relationships

## 3. Lifecycle

```text
planned → queued → preparing → running → collecting_evidence
                                      ↓
                     completed | failed | cancelled | timed_out | blocked
```

Every transition SHALL be attributable and idempotent.

## 4. Result Model

Canonical test outcomes are:

- passed
- failed
- blocked
- skipped with governed reason
- cancelled
- infrastructure_error
- indeterminate

Infrastructure errors and flaky retries SHALL NOT be reported as product passes.

## 5. Scheduling and Concurrency

Scheduling SHALL respect priority, dependency, capacity, isolation, environment leases, data conflicts, timeouts, and cancellation.

Parallel runs SHALL not share mutable state unless explicitly coordinated.

## 6. Evidence

Evidence SHALL link to the exact execution, step, assertion, asset, environment, and capture time.

Redaction SHALL preserve diagnostic meaning while protecting sensitive content.

## 7. Retry and Recovery

Retry policy SHALL identify eligible failure types, maximum attempts, backoff, state reset, and evidence retention.

Every attempt SHALL remain visible.

## 8. Workspace Isolation

Queues, workers, artifacts, caches, credentials, logs, and callbacks SHALL preserve Workspace identity and authorization.

## 9. Observability

The platform SHALL expose queue time, preparation time, run duration, result distribution, infrastructure failures, flakiness, cancellation, evidence completeness, and resource saturation.

## 10. Quality Gates

Execution passes when exact inputs are known, lifecycle transitions are valid, outcomes are honest, required evidence is complete, isolation passes, and recovery behavior is tested.

## 11. Definition of Done

- provider-independent execution interface exists
- duplicate commands are idempotent
- every attempt and state transition is auditable
- cancellation and timeout terminate safely
- results trace back to requirements and risks

## 12. Summary

Execution turns approved tests into attributable runtime evidence without conflating product, test, and infrastructure failure.
