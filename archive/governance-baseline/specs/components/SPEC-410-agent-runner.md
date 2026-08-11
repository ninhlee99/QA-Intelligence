---
id: SPEC-410
title: Agent Runner Component
version: 1.0.0
status: accepted
owner:
  - Runtime Platform
depends_on:
  - SPEC-309
  - SPEC-508
  - SPEC-509
  - SPEC-510
related_adrs:
  - ADR-002
  - ADR-006
  - ADR-008
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
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-410: Agent Runner Component

## 1. Purpose

The Agent Runner implements SPEC-508 and coordinates one durable Agent run. It is the sole component allowed to advance the Agent run state machine.

## 2. Responsibilities

- resolve and pin definitions, policies, knowledge, rules, and contracts
- calculate effective authority and create the initial checkpoint
- assemble minimal context and execute the governed loop from SPEC-309
- invoke Skills through SPEC-509 and Tools through SPEC-510
- enforce approvals, budgets, progress detection, cancellation, and terminal states
- emit immutable events and evidence without exposing secrets or hidden reasoning

It SHALL NOT implement Skill-specific procedures, provider SDKs, product rules, knowledge promotion, or release decisions.

## 3. State and Recovery

State transitions use optimistic concurrency and an append-only attempt record. Resume validates the checkpoint, current policy, actor authority, and side-effect status. Unknown effects pause for inspection or human decision.

## 4. Operability and Tests

Metrics include active runs, step and Tool latency, budget consumption, denials, approvals, no-progress terminations, recovery outcomes, and isolation violations. Contract, state-machine, failure-injection, replay, cancellation, load, and Workspace-isolation tests are required before release.

## 5. Interfaces and Persistence

The component provides SPEC-508 and consumes SPEC-509, SPEC-510, SPEC-501, SPEC-502, SPEC-505, SPEC-506, and SPEC-507 without importing provider SDKs into its domain layer. Run aggregates, checkpoints, attempts, approvals, budget ledger, and effect ledger are durably persisted with optimistic concurrency and transactional event handoff. Conversation or model context is reconstructed and SHALL never be the sole durable state.

For the local profile, the parent Agent Runner is the only lifecycle writer and
persists through the Workspace SQLite repository. Sub-agents and test workers
do not receive database paths or direct persistence authority.

## 6. Failure and Recovery

Invalid definition, incompatible dependency, authorization denial, context contamination, provider/Skill/Tool failure, invalid output, budget exhaustion, no progress, cancellation, checkpoint corruption, cleanup failure, partial effect, and unknown effect remain distinct. Retry is policy- and effect-aware and retains every attempt. Recovery verifies pinned versions, leases, authority, and outstanding effects before the next step.

## 7. Configuration and Definition of Done

Configuration pins contract and policy versions and bounds concurrency, steps, time, tokens, cost, Tool calls, retries, evidence, and checkpoint size. The component is complete when deterministic/replay and production adapters pass the same contracts; state-machine invariants, crash recovery, idempotency, effect reconciliation, cancellation, observability, security, and Workspace isolation tests pass; and no product rule or accepted knowledge is hidden in implementation code.
