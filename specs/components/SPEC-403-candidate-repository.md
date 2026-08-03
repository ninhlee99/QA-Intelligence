---
id: SPEC-403
title: Candidate Repository Component
version: 1.0.0
status: accepted
owner:
  - Knowledge Platform
depends_on:
  - SPEC-102
  - SPEC-105
  - SPEC-306
  - SPEC-501
  - SPEC-506
related_adrs:
  - ADR-005
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-403: Candidate Repository Component

## 1. Purpose

The Candidate Repository persists non-authoritative Knowledge Candidates and Improvement Proposals throughout discovery, validation, promotion, rejection, and expiry.

## 2. Owns

- candidate aggregate persistence
- evidence and counterevidence links
- lifecycle history
- validation task references
- expiration and ownership indexes
- Workspace isolation

It SHALL NOT promote candidates or expose them as accepted knowledge.

## 3. Operations

- create candidate idempotently
- revise proposal
- append evidence
- record validation result
- transition lifecycle with authorization
- query by owner, status, type, and expiry
- link promotion result without mutating history

## 4. Invariants

- candidate status remains visibly non-authoritative
- provenance is never removed during promotion or rejection
- accepted knowledge receives a distinct governed version
- expired candidates cannot re-enter validation without explicit revival
- cross-Workspace search is denied by default

## 5. Verification

Tests SHALL cover promotion separation, expiry, duplicate observations, conflicting evidence, lifecycle authorization, and isolation.

## 6. Failure and Operability

Invalid evidence, conflict, duplicate observation, expired candidate, unauthorized transition, unavailable storage, and retention failure SHALL remain distinct. Observation ingestion is idempotent and never converts status to accepted. Metrics SHALL expose candidate age, lifecycle distribution, duplicate/conflict rate, review backlog, expiry, rejected promotion attempts, and isolation denial. Retention and purge SHALL preserve required audit evidence and legal holds.

## 7. Definition of Done

The component enables controlled learning while making accidental authority promotion structurally impossible.
