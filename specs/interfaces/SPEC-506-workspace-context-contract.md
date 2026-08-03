---
id: SPEC-506
title: Workspace Context Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Security
depends_on:
  - SPEC-306
related_adrs:
  - ADR-008
  - ADR-014
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-506: Workspace Context Contract

## 1. Purpose

This contract defines the trusted context required by every Workspace-scoped operation.

This specification is the single source of truth for Workspace context fields and validation semantics. Architecture and component specifications SHALL reference rather than redefine it.

## 2. Fields

Context SHALL contain:

- Workspace ID
- authenticated actor ID and type
- authorized roles and permissions
- policy version
- request and correlation IDs
- environment
- issued and expiry times
- issuer and integrity proof
- explicit administrative scope when applicable

## 3. Rules

- context is immutable after issuance
- consumers validate integrity, expiry, audience, and required permissions
- caller-provided Workspace or role fields do not replace trusted context
- context SHALL propagate through jobs, events, plugins, evidence, and AI retrieval
- logging SHALL retain identity without exposing credentials

## 4. Administrative Context

Cross-Workspace operations require a distinct explicit administrative purpose, bounded target set, elevated approval, and audit trail.

## 5. Failure

Missing, expired, invalid, wrong-audience, stale-policy, suspended-Workspace, and insufficient-permission outcomes SHALL fail closed and remain distinct.

## 6. Conformance

Every component SHALL pass tampering, replay, expiry, privilege escalation, confused-deputy, background propagation, plugin propagation, and cross-Workspace tests.

## 7. Compatibility and Key Lifecycle

The context format SHALL carry an explicit schema and policy version, audience, issuance, and expiry semantics. Required authority-field or validation changes require a major version and migration overlap; no compatibility mode may weaken isolation. Signing or verification keys support rotation, revocation, and audit. Deterministic identity fixtures and the production identity adapter SHALL pass the same validation vectors.
