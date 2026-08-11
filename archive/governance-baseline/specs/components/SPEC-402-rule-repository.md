---
id: SPEC-402
title: Rule Repository Component
version: 1.0.0
status: accepted
owner:
  - Rule Platform
depends_on:
  - SPEC-104
  - SPEC-306
  - SPEC-502
  - SPEC-506
related_adrs:
  - ADR-002
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-402: Rule Repository Component

## 1. Purpose

The Rule Repository stores immutable accepted rule versions, rule sets, authority links, effective periods, tests, and lifecycle history.

## 2. Owns

- rule and rule-set persistence
- exact-version and effective-time resolution
- integrity and concurrency
- Workspace-scoped rule overrides
- lifecycle history

It does not evaluate rules or approve them.

## 3. Operations

- save draft rule
- retrieve exact version
- resolve applicable rule set
- list history and dependencies
- record acceptance, supersession, or retirement
- validate package integrity

## 4. Invariants

- accepted versions are immutable
- global non-overridable controls cannot be weakened by Workspace rules
- effective periods do not create ambiguous equal-precedence versions
- test and authority links remain intact
- evaluation can reproduce historical rule resolution

## 5. Verification

Tests SHALL cover effective-time boundaries, precedence resolution inputs, concurrency, package integrity, Workspace isolation, and historical retrieval.

## 6. Failure and Operability

Unknown package, incompatible version, invalid signature, conflicting effective range, unauthorized override, storage failure, and stale cache SHALL remain distinct. Accepted rule packages are immutable; activation and retirement are transactional, attributable, and recoverable. Metrics SHALL expose resolution latency, package/version usage, conflict, integrity failure, cache freshness, and denied overrides. Restore and migration SHALL preserve historical evaluation.

## 7. Definition of Done

The component provides provider-independent rule persistence while all decision authority remains in SPEC-104 and Rule Governance.
