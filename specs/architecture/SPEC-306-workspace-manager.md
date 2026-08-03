---
id: SPEC-306
title: Workspace Manager Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Security
  - Platform Engineering
depends_on:
  - SPEC-101
  - SPEC-103
  - SPEC-210
related_adrs:
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-306: Workspace Manager Architecture

## 1. Purpose

The Workspace Manager establishes and enforces the isolation, identity, configuration, policy, membership, and lifecycle boundary for every Workspace.

This Architecture specification owns the boundary and collaboration model. SPEC-506 is the normative context contract and SPEC-406 is its implementing component.

## 2. Responsibilities

- create and identify Workspaces
- manage lifecycle and ownership
- resolve membership, roles, and policy
- issue immutable Workspace execution context
- namespace storage, queues, caches, evidence, and integrations
- authorize administrative operations
- coordinate export, suspension, and retirement

## 3. Workspace Context

Context SHALL include Workspace ID, actor, roles, policy version, request/correlation ID, environment, authorization decision, and expiration.

Missing or ambiguous context SHALL fail closed.

## 4. Lifecycle

```text
provisioning → active → suspended → retiring → archived
```

Transitions SHALL be authorized, auditable, and reversible where policy permits.

## 5. Isolation

Every Workspace-scoped component SHALL derive storage, cache, queue, index, telemetry, secret, and artifact access from validated context.

Caller-provided identifiers SHALL never be trusted without authorization.

## 6. Global Operations

Cross-Workspace administration SHALL use a separate explicit authority path, declare purpose and scope, produce audit evidence, and avoid exposing protected content unnecessarily.

## 7. Failure Behavior

Unknown Workspace, suspended Workspace, unauthorized actor, stale policy, expired context, and dependency failure SHALL be distinct.

## 8. Quality Gates

This architecture is a critical independent gate. It passes only when positive and negative isolation tests cover storage, caches, queues, indexes, AI context, plugins, logs, exports, and background jobs.

## 9. Reliability and Operability

Workspace creation and lifecycle commands SHALL be idempotent. Suspension SHALL fail new work closed and define treatment of in-flight work; deletion SHALL use governed retention, legal-hold, export, tombstone, and purge stages rather than an untraceable hard delete. Context signing and validation keys SHALL support rotation without accepting stale policy indefinitely. Metrics SHALL expose authorization denial, stale/expired context, suspension enforcement, cross-Workspace attempts, administrative access, lifecycle backlog, and propagation failure.

## 10. Summary

Workspace identity is an enforced security boundary, not a filtering convention.
