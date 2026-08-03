---
id: SPEC-401
title: Knowledge Repository Component
version: 1.0.0
status: accepted
owner:
  - Knowledge Platform
depends_on:
  - SPEC-102
  - SPEC-103
  - SPEC-306
  - SPEC-307
  - SPEC-501
  - SPEC-506
related_adrs:
  - ADR-001
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-401: Knowledge Repository Component

## 1. Purpose

The Knowledge Repository implements governed persistence and retrieval ports for accepted Knowledge Objects, versions, claims, provenance, and relationships.

## 2. Owns

- aggregate persistence and optimistic concurrency
- immutable accepted versions
- exact and current-version retrieval
- Workspace-scoped queries
- transaction and integrity boundaries
- persistence-to-domain mapping

## 3. Does Not Own

- candidate promotion decisions
- semantic ranking policy
- rule evaluation
- product workflows
- storage-vendor contracts exposed to consumers

## 4. Provided Operations

- save draft with expected revision
- get exact version
- get current accepted version
- list history
- query by governed filters
- traverse validated relationships
- append lifecycle event

## 5. Invariants

- all operations require Workspace context or explicit global authority
- accepted versions are immutable
- required provenance is referentially intact
- retries are idempotent
- domain objects round-trip without semantic loss

## 6. Failure Contract

Not found, conflict, authorization denial, validation error, integrity violation, unavailable storage, and stale projection SHALL remain distinct.

## 7. Verification

Contract tests SHALL cover concurrency, history, isolation, idempotency, recovery, and vendor substitution.

## 8. Persistence and Operability

The component SHALL implement SPEC-501 behind a transaction boundary and use ADR-012 persistence without exposing database schemas to callers. Writes use optimistic concurrency and transactional event handoff; retry cannot duplicate revisions or lifecycle effects. Metrics SHALL expose command/query latency, conflict, integrity failure, projection lag, recovery, and isolation denial. Backup, restore, retention, migration, and index rebuild SHALL preserve stable IDs, versions, provenance, and Workspace scope.

## 9. Definition of Done

The component is complete when it satisfies SPEC-103 without leaking persistence primitives or weakening Workspace boundaries.
