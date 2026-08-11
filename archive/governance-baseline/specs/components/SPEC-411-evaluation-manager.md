---
id: SPEC-411
title: Evaluation Manager Component
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Runtime Platform
depends_on:
  - SPEC-310
  - SPEC-508
  - SPEC-511
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-017
  - ADR-013
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-411: Evaluation Manager Component

## 1. Purpose

The Evaluation Manager implements campaign validation, isolated trial coordination, oracle and Judge execution, aggregation, comparison, and recommendation production from SPEC-310.

## 2. Responsibilities

- pin suite, case, subject, dataset, policy, evaluator, and environment versions
- statically validate definitions, coverage, thresholds, and critical invariants
- schedule quota-bound trials through SPEC-508 and evaluation adapters through SPEC-511
- retain every attempt and classify subject, evaluator, infrastructure, and test failures
- apply deterministic oracles first and dispatch only eligible rubric criteria to Judges
- calculate variance, regressions, condition changes, and gate outcomes
- produce signed, immutable reports and escalation packages

It SHALL NOT edit the subject under test, expose hidden holdouts, accept knowledge, or approve release.

## 3. Operability and Tests

Metrics include queue time, trial completion, infrastructure error rate, Judge disagreement and drift, contamination events, coverage, variance, critical failures, and cleanup failures. Tests SHALL cover replay, concurrency isolation, biased or injected Judge output, partial evidence, changing baselines, cancellation, quota exhaustion, and cross-Workspace access.

## 4. Interfaces and Persistence

The component consumes SPEC-508 and SPEC-511 and persists campaign, trial, attempt, observation, evaluator-health, aggregation, comparison, adjudication, and recommendation records with exact versions and append-only evidence. Adapters return observations and failure classes; the manager alone applies canonical gate and verdict semantics. Transactional event handoff and idempotency prevent duplicate trials from becoming additional favorable evidence.

## 5. Failure and Recovery

Invalid suite, incompatible contract, subject failure, evaluator failure, infrastructure failure, policy denial, timeout, cancellation, contamination, incomplete evidence, cleanup failure, and indeterminate judgment remain distinct. Recovery resumes at trial boundaries, never suppresses failed attempts, and never reruns unknown side effects without reconciliation or approval. A Judge outage or disagreement cannot become a subject pass or fail.

## 6. Configuration and Definition of Done

Configuration pins subject, suite, case, dataset, rubric, Oracle/Judge, adapter, environment, baseline, aggregation, and policy versions and bounds trials, concurrency, time, cost, Tool use, retries, and evidence. Completion requires deterministic/replay and production adapter conformance, isolation and cleanup proof, calibrated Judge tests, critical-invariant dominance, reproducible comparison, signed evidence, and explicit human release authority outside the component.
