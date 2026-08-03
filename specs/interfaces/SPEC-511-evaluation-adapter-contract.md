---
id: SPEC-511
title: Evaluation Adapter Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Quality Engineering
depends_on:
  - SPEC-107
  - SPEC-310
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
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-511: Evaluation Adapter Contract

## 1. Purpose

This contract isolates sandbox, replay, Judge, and external evaluation providers without delegating QA verdict semantics to them.

## 2. Capabilities

Adapters MAY provide `prepare_environment`, `execute_trial`, `evaluate_rubric`, `collect_evidence`, `cleanup`, and `replay`. Each descriptor SHALL declare capability, versions, isolation level, determinism, supported limits, data residency, and evidence guarantees.

## 3. Requests and Results

Requests carry campaign, case, trial and Workspace identities; immutable subject and fixture references; policy; budgets; deadline; schemas; and evidence requirements. Results carry provider identity, normalized observations, raw-evidence references, usage, timing, uncertainty, failure class, cleanup status, and reproducibility limitations.

Judge results SHALL contain rubric criterion scores, anchored evidence, uncertainty, calibration version, and conflicts. Adapter scores are observations; the Evaluation Engine owns the final verdict.

## 4. Guarantees and Conformance

Adapters cannot access hidden cases outside their trial, retain data beyond policy, alter the subject, suppress failed attempts, or decide release. Production and deterministic/replay adapters SHALL pass the same contract tests for isolation, timeout, cancellation, partial failure, evidence integrity, calibration, injection, cleanup, and Workspace denial.

## 5. Compatibility and Operations

Capability, rubric observation, failure, cleanup, and evidence semantics SHALL be version-negotiated. A changed score scale, calibration meaning, isolation guarantee, or verdict-affecting field is breaking and requires baseline impact analysis. Adapters expose health, latency, usage, residency, determinism, evidence completeness, and cleanup through normalized fields. Retry never selects favorable trials or erases evaluator and infrastructure failures.
