---
id: SPEC-406
title: Workspace Manager Component
version: 1.0.0
status: accepted
owner:
  - Security Platform
depends_on:
  - SPEC-306
  - SPEC-506
related_adrs:
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-406: Workspace Manager Component

## 1. Purpose

This component implements Workspace lifecycle, membership, roles, policy resolution, and immutable request context issuance.

It implements SPEC-506 and SHALL NOT introduce context fields, permissions, or lifecycle meaning absent from the governing Architecture and Interface specifications.

## 2. Owns

- Workspace aggregate
- membership and role assignments
- policy-version binding
- lifecycle transitions
- context issuance and validation
- administrative audit records

It does not own domain data or component-specific authorization decisions.

## 3. Operations

- provision, activate, suspend, retire, and archive
- add, update, and remove membership
- bind approved policy
- authorize and issue Workspace context
- validate active context
- retrieve audit history

## 4. Invariants

- every Workspace has one stable non-reused ID
- suspended Workspaces cannot issue normal contexts
- caller-supplied roles are never trusted
- context has bounded lifetime and policy version
- administrative paths are separate and audited

## 5. Verification

This critical component SHALL pass role escalation, stale context, suspension, confused-deputy, ID enumeration, background-job, export, and cross-Workspace tests.

## 6. Failure, Recovery, and Operability

Commands are idempotent and use optimistic concurrency. Unknown, suspended, expired, stale-policy, unauthorized, deletion-pending, and dependency-failure outcomes remain distinct and fail closed. Metrics SHALL expose authorization outcomes, context issuance/validation, policy propagation, suspension, lifecycle backlog, administrative access, and isolation attempts. Key rotation, backup, restore, export, retention, tombstone, and purge procedures SHALL be tested without ID reuse or scope loss.

## 7. Definition of Done

No Workspace-scoped operation can proceed from an unvalidated or ambiguous context.
