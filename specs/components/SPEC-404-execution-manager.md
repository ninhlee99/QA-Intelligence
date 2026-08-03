---
id: SPEC-404
title: Execution Manager Component
version: 1.0.0
status: accepted
owner:
  - Execution Platform
depends_on:
  - SPEC-210
  - SPEC-304
  - SPEC-305
  - SPEC-306
  - SPEC-504
  - SPEC-505
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-404: Execution Manager Component

## 1. Purpose

The Execution Manager owns execution planning, state transitions, dispatch, cancellation, retry classification, and result aggregation.

## 2. Owns

- execution aggregate and attempt identity
- valid lifecycle transitions
- capability-based engine resolution requests
- environment and data lease coordination
- dispatch and callback correlation
- timeout and cancellation
- result and evidence references

It does not implement provider engines or redefine test outcomes.

## 3. Operations

- plan and queue execution
- start preparation
- dispatch attempt
- record progress and evidence
- complete, fail, block, cancel, or time out
- retry eligible attempts
- retrieve execution history

## 4. Invariants

- commands are idempotent
- one terminal state is final
- attempts remain visible
- infrastructure error is not product failure
- Workspace context is immutable
- exact asset and engine versions are retained

## 5. Verification

Tests SHALL cover duplicate commands, race conditions, late callbacks, cancellation, timeout, retry, worker loss, evidence ordering, and Workspace isolation.

## 6. Persistence and Operability

The manager persists authoritative lifecycle revisions and uses transactional event handoff. Engine callbacks are untrusted until schema, execution, attempt, sequence, and Workspace validation pass. Unknown side effects and cleanup failure remain visible and block unsafe retry. Metrics SHALL expose lifecycle latency, stuck attempts, duplicate/late callbacks, cancellation races, engine failures, evidence completeness, and cleanup outcomes. Migration SHALL preserve in-flight version bindings.

## 7. Definition of Done

The component provides reproducible lifecycle control independent of any execution provider.
