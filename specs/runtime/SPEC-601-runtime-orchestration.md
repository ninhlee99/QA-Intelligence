---
id: SPEC-601
title: Runtime Orchestration
version: 1.0.0
status: accepted
owner:
  - Runtime Platform
depends_on:
  - SPEC-304
  - SPEC-404
  - SPEC-503
  - SPEC-505
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-017
  - ADR-013
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/RUNTIME_REVIEW.yaml
---

# SPEC-601: Runtime Orchestration

## 1. Purpose

Runtime Orchestration defines how commands, workflows, plugins, jobs, events, human approvals, and evidence collaborate during live operation.

## 2. Runtime Principles

- every operation has identity, Workspace context, owner, deadline, and outcome
- durable workflow state precedes external side effects
- commands are idempotent and events are immutable facts
- retries preserve attempt evidence
- policy and domain decisions remain outside orchestration code
- unknown state fails safe

## 3. Request Flow

```text
Authenticate and Authorize
↓
Validate Workspace and Input
↓
Create Durable Operation
↓
Resolve Workflow and Capabilities
↓
Dispatch Idempotent Work
↓
Consume Correlated Events
↓
Evaluate Transition Rules
↓
Finalize Outcome and Evidence
```

## 4. Delivery

Runtime SHALL define delivery semantics per boundary. Duplicate delivery is expected; consumers SHALL be idempotent. Ordering SHALL not be assumed without an explicit aggregate sequence.

## 5. Side Effects

External side effects SHALL use transactional outbox, durable intent, or equivalent consistency pattern. Irreversible actions require stronger approval and compensation planning.

## 6. Isolation

Workspace context SHALL propagate through queues, timers, workers, plugins, callbacks, events, telemetry, and evidence.

The default local profile binds each Workspace to one user-owned SQLite file
and one active parent runtime owner. Multiple host bridges converge on that
owner; child workers have no direct database authority. The shared profile may
use PostgreSQL and distributed workers only through the same runtime contracts.

## 7. Overload

The runtime SHALL apply admission control, bounded queues, backpressure, per-Workspace quotas, fair scheduling, and load shedding that protects critical operations.

## 8. Quality Gates

Runtime passes when duplicate delivery, worker loss, partial failure, policy denial, backpressure, cancellation, recovery, auditability, and Workspace isolation tests pass.

## 9. Configuration, Compatibility, and Observability

Runtime configuration SHALL pin workflow, contract, policy, plugin, schema, and event versions and define deadlines, retry, queue, quota, payload, evidence, and retention limits. In-flight operations retain resolved versions across compatible deployments; incompatible migrations use drain, coexistence, or explicit state migration with rollback evidence. Correlated metrics and traces SHALL expose admission, dispatch, queueing, state transitions, side effects, retry, cancellation, overload, cleanup, and terminal outcomes without exposing secrets or protected Workspace content.

## 10. Summary

Orchestration coordinates governed work durably without becoming the owner of domain meaning.
