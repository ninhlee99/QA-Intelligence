---
id: ADR-013
title: Modular Monolith and Worker Deployment Baseline
status: accepted
version: 1.0.0
date: 2026-08-03
decision_owners:
  - Architecture
  - Runtime Platform
  - Security
related_specs:
  - SPEC-304
  - SPEC-306
  - SPEC-309
  - SPEC-310
  - SPEC-601
  - SPEC-603
  - SPEC-604
  - SPEC-605
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-011
  - ADR-012
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/OWNER_APPROVAL.yaml
---

# ADR-013: Modular Monolith and Worker Deployment Baseline

## 1. Context

The platform needs durable asynchronous work and sandboxed evaluation, but the first advisory tracer bullet does not justify independently deployed microservices for each domain capability.

## 2. Decision

Start as one modular codebase with two production process roles built from the same versioned release:

1. control process for commands, queries, approvals, configuration, and reports
2. worker process for Agent runs, evaluation trials, outbox delivery, and scheduled work

Processes deploy as immutable containers. A development profile runs them locally with PostgreSQL and deterministic adapters. Sandbox execution MAY use a separate constrained container or process while remaining governed by the Agent Runtime and Evaluation interfaces.

## 3. Module Rules

Knowledge, Rule, Agent Runtime, Evaluation Engine, Workspace, and Plugin modules retain explicit interfaces and dependency direction inside the monolith. They SHALL NOT communicate through loopback network calls merely to imitate microservices. Deployment topology cannot redefine module ownership.

## 4. Reliability and Scaling

- all durable work is recoverable from PostgreSQL checkpoints and outbox state
- workers are stateless between checkpoints and scale horizontally
- per-Workspace quotas, admission control, fair work claiming, cancellation, and kill switches are mandatory
- control and worker roles expose health, readiness, metrics, logs, and trace correlation
- deployment supports backward-compatible rolling migration or explicit maintenance mode

## 5. Consequences

This reduces operational complexity and preserves locality while allowing control and worker capacity to scale independently. A process failure has a wider initial blast radius than mature microservices, so resource limits and sandbox isolation are mandatory.

## 5.1 Alternatives Considered

- **Microservice per domain module** was rejected because network seams, distributed failure, and independent deployment provide no proven leverage for the first slice.
- **Single synchronous process** was rejected because durable Agent runs, cancellation, retries, evaluation trials, and worker recovery require an asynchronous process role.
- **Provider-specific serverless workflows** were rejected because they would leak deployment technology into runtime semantics and weaken local reproducibility.

## 6. Extraction Criteria

Create a remote seam only when a module requires independent scaling, security isolation, availability, release cadence, or ownership demonstrated by operational evidence. Extraction requires a production transport adapter and in-memory/replay test adapter through the same interface.

## 7. Validation

- local deterministic environment starts without cloud services
- worker loss, duplicate delivery, cancellation, rolling deployment, migration, and recovery tests pass
- sandbox cannot reach unauthorized network, credentials, filesystem, or Workspace data
- independent control and worker scaling preserves fairness and evidence
