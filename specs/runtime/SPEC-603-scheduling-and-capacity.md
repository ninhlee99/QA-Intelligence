---
id: SPEC-603
title: Scheduling and Capacity Runtime
version: 1.0.0
status: accepted
owner:
  - Runtime Platform
depends_on:
  - SPEC-404
  - SPEC-504
  - SPEC-506
  - SPEC-601
  - SPEC-602
related_adrs:
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/RUNTIME_REVIEW.yaml
---

# SPEC-603: Scheduling and Capacity Runtime

## 1. Purpose

This specification governs admission, prioritization, fairness, dependency readiness, environment leases, capacity allocation, and queue behavior.

## 2. Scheduling Inputs

- Workspace and actor
- operation type and risk
- priority and deadline
- capability and environment requirements
- dependency readiness
- estimated resources
- quota and concurrency limits
- affinity or isolation constraints

## 3. Principles

- no Workspace may starve others through uncontrolled load
- critical governance and recovery work may use reserved capacity
- priority changes are authorized and auditable
- unavailable capability produces blocked or queued state, not silent fallback
- scheduling decisions are explainable

## 4. Admission Control

Admission SHALL validate authorization, quotas, supported capability, environment availability, deadline feasibility, and policy. Rejection and deferment SHALL be distinct.

## 5. Leases

Workers and environments SHALL use renewable bounded leases. Expired leases enable safe recovery. Lease identity SHALL prevent stale workers from finalizing current work.

## 6. Backpressure

The platform SHALL define queue bounds, per-Workspace limits, rate limits, load shedding, and client retry guidance.

## 7. Observability

Signals SHALL include queue depth and age, fairness, admission outcomes, capacity by capability, lease failures, saturation, deadline misses, and Workspace-safe resource use.

## 8. Quality Gates

Scheduling passes when fairness, priority inversion, quota, overload, lease expiry, duplicate dispatch, starvation, and Workspace isolation tests pass.

## 9. Configuration and Recovery

Priority classes, per-Workspace quotas, fairness weights, queue and concurrency bounds, lease duration, renewal, deadline policy, load shedding, and retry guidance SHALL be versioned configuration. Scheduler restart SHALL rebuild safe dispatch state from durable requests and leases; fencing prevents stale completion. Capacity changes and overload tests SHALL verify critical-path protection without indefinite starvation. Configuration changes retain audit, rollout, rollback, and impact evidence.

## 10. Summary

Scheduling allocates bounded shared capacity without weakening isolation or outcome honesty.
