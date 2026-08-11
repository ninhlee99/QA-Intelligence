---
id: SPEC-405
title: Plugin Registry Component
version: 1.0.0
status: accepted
owner:
  - Platform Engineering
depends_on:
  - SPEC-305
  - SPEC-306
  - SPEC-503
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-405: Plugin Registry Component

## 1. Purpose

The Plugin Registry stores validated descriptors, versions, capabilities, compatibility, integrity, configuration references, and enablement scope.

## 2. Owns

- descriptor validation and persistence
- capability indexes
- interface compatibility records
- enabled/disabled state by governed scope
- integrity and provenance
- retirement records

It SHALL NOT invoke plugins, store secrets, or choose policy based on provider preference.

## 3. Operations

- register validated descriptor
- resolve compatible candidates
- enable or disable within authorized scope
- retrieve configuration schema
- report health metadata
- deprecate and retire

## 4. Invariants

- plugin ID and version are immutable
- descriptors implement known interface versions
- requested permissions are explicit
- secrets are referenced, never stored in descriptors
- disabled or retired plugins cannot be resolved
- Workspace enablement cannot widen global authorization

## 5. Verification

Tests SHALL cover descriptor integrity, compatibility, capability resolution, concurrent enablement, permission bounds, and retirement.

## 6. Failure and Operability

Unknown plugin, invalid signature, incompatible contract, unhealthy provider, configuration error, permission denial, quarantine, and retired version SHALL remain distinct. Enablement and configuration are versioned Workspace-scoped records; secret values are never stored in descriptors. Metrics SHALL expose resolution, health, compatibility rejection, quarantine, enable/disable changes, and permission denials. Rollback SHALL restore the prior compatible binding without rewriting historical invocations.

## 7. Definition of Done

The registry makes plugin availability explainable and governed without coupling core domains to providers.
