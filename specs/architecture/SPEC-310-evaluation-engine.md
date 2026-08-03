---
id: SPEC-310
title: Evaluation Engine Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Quality Engineering
depends_on:
  - SPEC-107
  - SPEC-205
  - SPEC-206
  - SPEC-207
  - SPEC-210
  - SPEC-213
  - SPEC-309
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-012
  - ADR-013
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-310: Evaluation Engine Architecture

## 1. Purpose

The Evaluation Engine is the deep module that validates suites, schedules isolated trials, applies oracle and Judge policies, aggregates measurements, diagnoses regressions, and produces auditable recommendations behind a stable evaluation contract.

## 2. Responsibilities

- resolve immutable subject, suite, dataset, evaluator, policy, and environment versions
- statically validate Agent/Skill definitions and suite coverage
- create isolated, quota-bound trials using the Agent Runtime contract
- provide deterministic fakes, simulations, recordings, and replay adapters
- capture outputs, step traces, Tool evidence, policy decisions, and cleanup outcomes
- execute oracle checks before Judge evaluation
- calibrate Judges and detect disagreement, drift, leakage, or self-evaluation
- aggregate repeated trials without masking critical failures
- compare baselines while attributing changed conditions
- issue evidence-backed recommendations, never self-approval

## 3. Isolation Architecture

Every trial receives a clean Workspace-scoped sandbox, explicit fixtures, network and Tool policy, credentials with minimum authority, usage budgets, and deterministic cleanup. Evaluation dependencies SHALL not share mutable state between trials unless the case explicitly tests concurrency.

## 4. Evaluation Adapter Seam

External sandboxes, Judges, execution providers, and telemetry stores connect only through SPEC-511. Each remote adapter SHALL have a local deterministic or replay counterpart. Product verdict semantics remain inside the Evaluation Engine, not adapters.

SPEC-511 is the complete external Interface at this seam. Provider SDK objects, transport status codes, provider-specific lifecycle states, and provider-specific score meanings SHALL be normalized inside an Adapter and SHALL NOT leak into the Evaluation Engine. The Engine may use internal seams for orchestration, aggregation, or persistence, but those internal seams are not part of the Evaluation Adapter Contract.

## 5. Fault Classification

Failures SHALL be classified as subject, evaluator, infrastructure, invalid test, policy denial, or indeterminate. Retry policy is class-specific. Retrying SHALL not discard failed-attempt evidence or silently select only favorable trials.

## 6. Security

Candidate outputs and fixtures are untrusted. Judge prompts SHALL isolate rubric authority from candidate content. Hidden holdout access is restricted and audited. Live-system tests require explicit authorization, narrow targets, rollback or compensation, and stronger approval.

## 7. Quality Gates

The architecture passes when deterministic cases run offline; repeated trials expose variance; critical assertions dominate aggregate scores; evaluator failures cannot fail the subject; contamination changes invalidate comparison; all dependencies are replayable or explicitly non-reproducible; and the release recommendation traces to retained evidence.

## 8. Campaign State and Recovery

SPEC-607 is the single canonical source for campaign lifecycle states and transition semantics. The Evaluation Engine SHALL use exactly these campaign transitions:

```text
draft → validating → ready → running → analyzing → awaiting_review
awaiting_review → approved | conditionally_approved | rejected | indeterminate
any non-terminal → blocked | cancelled | failed
```

The Engine SHALL NOT introduce aliases or parallel campaign states such as `aggregating`, `awaiting_adjudication`, or `completed`. Aggregation is work performed while the campaign is `analyzing`; adjudication is work performed while it is `awaiting_review`. `approved` remains an evaluation outcome and SHALL NOT be interpreted as release approval.

Every transition is attributable and idempotent. Recovery resumes from retained trial boundaries; it SHALL not rerun a trial with possible unknown side effects without compensation or approval. Cancellation revokes leases, prevents new trials, runs bounded cleanup, and retains evidence. Adapter operation state is subordinate execution detail and SHALL NOT mutate or extend the SPEC-607 campaign lifecycle.

## 9. Configuration and Observability

Configuration SHALL pin suite, case, subject, Oracle/Judge, adapter, rubric, environment, dataset, policy, and aggregation versions and bound trials, concurrency, time, cost, Tool use, retries, and evidence volume. Metrics SHALL expose queue and trial latency, outcome distribution, variance, critical failures, evaluator disagreement/error, infrastructure failure, cleanup, cost, and evidence completeness without exposing hidden cases or protected data.

## 10. Definition of Done

- a stable evaluation interface hides sandbox, Judge, provider, and telemetry implementation
- production and deterministic/replay adapters pass identical contract tests
- failure attribution and aggregation invariants are machine-testable
- historical recommendations retain exact versions and reproducibility limits
- suite policy SHALL resolve from accepted authority rather than caller-provided thresholds
- trial results, critical invariants, and evidence SHALL be accepted only after integrity/provenance verification through the Evaluation Adapter or retained evidence store
- no unresolved architecture decision blocks component implementation
