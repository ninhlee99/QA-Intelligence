---
id: SPEC-304
title: Workflow Engine Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Platform Engineering
depends_on:
  - SPEC-104
  - SPEC-201
  - SPEC-202
  - SPEC-210
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-304: Workflow Engine Architecture

## 1. Purpose

The Workflow Engine coordinates long-running product and governance processes through explicit, resumable, observable state machines.

## 2. Responsibilities

- instantiate versioned workflow definitions
- evaluate deterministic transition rules
- dispatch commands through interfaces
- persist state and transition evidence
- manage timers, retries, cancellation, compensation, and human tasks
- preserve Workspace and actor context

It SHALL NOT embed domain policy that belongs in specifications or rules.

## 3. Workflow Definition

Definitions SHALL contain identity, version, states, transitions, triggers, guards, actions, timeouts, retry policy, compensation, permissions, outputs, and terminal outcomes.

## 4. Runtime Model

Each instance SHALL identify definition version, Workspace, correlation ID, state, history, pending work, actor, input/output references, deadlines, and failure context.

## 5. Guarantees

- transition commands are idempotent
- completed history is immutable
- duplicate events do not duplicate effects
- external actions use explicit delivery semantics
- recovery resumes from durable state
- cancellation and compensation are observable

## 6. Human Tasks

Human approval tasks SHALL identify authority, assignee or role, evidence, allowed outcomes, deadline, and separation-of-duties constraints.

## 7. Failure Behavior

The engine SHALL distinguish domain rejection, transient dependency failure, permanent dependency failure, timeout, cancellation, conflict, and orchestration defect.

Retries SHALL not bypass policy or repeat unsafe non-idempotent actions.

## 8. Quality Gates

Architecture passes when recovery, duplicate delivery, cancellation, compensation, authorization, history integrity, and Workspace isolation are proven.

## 9. Interface and Operability

The engine SHALL expose a small provider-neutral interface for starting, signaling, approving, cancelling, inspecting, and resuming a workflow. Persistence, queues, clocks, and external actions remain adapters; production adapters and deterministic clock/queue/action substitutes SHALL pass the same transition and failure contract tests. Configuration SHALL bound attempts, elapsed time, pending human tasks, history size, and concurrency. Metrics SHALL expose transition latency, stuck instances, retries, compensation, policy denial, duplicate delivery, and terminal outcomes.

## 10. Summary

The Workflow Engine owns coordination state, not business authority.
