---
id: SPEC-508
title: Agent Runtime Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Runtime Platform
depends_on:
  - SPEC-309
  - SPEC-505
  - SPEC-506
  - SPEC-507
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-010
  - ADR-011
  - ADR-014
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-508: Agent Runtime Contract

## 1. Purpose

This contract is the test surface for starting, observing, controlling, and completing a governed Agent run independent of model and Tool providers.

## 2. Operations

- `start(request) -> run_reference`
- `inspect(run_reference) -> run_snapshot`
- `approve(run_reference, approval) -> transition`
- `resume(run_reference, checkpoint) -> transition`
- `cancel(run_reference, reason) -> transition`
- `stream_events(run_reference, cursor) -> events`

## 3. Start Request

The request SHALL contain operation and Workspace identity, actor authority, exact Agent version, task purpose and consequence class, inputs by reference, allowed Skill/Tool constraints, policy version, budgets, deadline, evidence requirements, and idempotency key.

## 4. Snapshot and Result

Snapshots SHALL expose lifecycle state, current externally explainable objective, consumed budgets, pending approval, checkpoint, failure class, and evidence references. Final results SHALL include validated output, outcome, exact resolved versions, rule decisions, Skill and Tool usage, citations, uncertainty, policy events, usage, timings, and cleanup status.

Hidden chain-of-thought is excluded. Auditable decisions, observations, citations, and validation outcomes are required.

## 5. Guarantees

Duplicate starts with the same scope and idempotency key resolve to the same run. Cancellation is monotonic. The runtime cannot widen permissions. Events are ordered per run or carry an explicit sequence gap. A terminal run is immutable except for append-only audit annotations.

## 6. Conformance

Implementations SHALL pass contract tests for duplicate start, policy denial, approval, budget exhaustion, no progress, timeout, cancellation, resume, provider failure, Tool failure, invalid output, event replay, evidence completeness, and cross-Workspace denial.

## 7. Compatibility and Operations

Operations and envelopes SHALL be schema-versioned and size-bounded. Additive optional observations may be compatible; changed lifecycle, authority, budget, effect, or verdict semantics require a major version and migration. Streaming or polling are transport choices and SHALL preserve the same canonical state. Metrics and traces expose correlation, resolved versions, lifecycle, budget, approval, failure, and cleanup without exposing secrets or hidden reasoning.
