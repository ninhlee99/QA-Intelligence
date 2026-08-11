---
id: SPEC-208
title: Test Data
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Data Governance
depends_on:
  - SPEC-205
  - SPEC-206
  - SPEC-207
  - GOV-009
related_adrs:
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-208: Test Data

## 1. Purpose

Test Data defines governed creation, selection, isolation, use, reset, retention, and disposal of data used for validation.

## 2. Goals

- provide representative and reproducible data
- protect sensitive information
- preserve Workspace isolation
- support boundary, negative, migration, and AI evaluation cases
- make data provenance and lifecycle explicit

## 3. Data Classes

- synthetic
- generated from governed templates
- masked or transformed production-derived
- reference
- seeded environment
- ephemeral execution
- adversarial and boundary
- AI evaluation dataset

Raw production data SHALL NOT be used without explicit governance and necessity.

## 4. Data Contract

Every reusable dataset SHALL identify:

- ID and version
- owner
- purpose and traced tests
- schema
- source and generation method
- classification
- Workspace and environment scope
- validity and constraints
- setup and teardown
- retention and disposal

## 5. Principles

- least sensitive sufficient data SHALL be preferred
- data SHALL be deterministic where reproducibility matters
- uniqueness SHALL be controlled for parallel execution
- time, locale, and identity dependencies SHALL be explicit
- cleanup SHALL be verifiable
- datasets SHALL not couple tests through shared mutable state

## 6. Workspace Isolation

Test data SHALL never cross Workspace boundaries without governed anonymization and approval.

Identifiers, caches, backups, artifacts, and logs SHALL preserve scope.

Isolation tests SHALL include attempted cross-Workspace access.

## 7. Privacy and Security

Sensitive fields SHALL be minimized, masked, access-controlled, encrypted, and retained only as required.

Secrets SHALL be injected through approved secret management and SHALL not appear in datasets or evidence.

## 8. AI Evaluation Data

Evaluation datasets SHALL identify labels, provenance, representativeness, known bias, contamination risks, version, and protected-data authorization.

## 9. Quality Gates

A dataset passes when its purpose, schema, provenance, classification, scope, reproducibility, cleanup, and retention are valid; privacy and isolation tests pass; and consumers reference the exact version.

## 10. Definition of Done

- datasets and generators are versioned
- setup and teardown are repeatable
- protected data use is approved
- parallel and failure cleanup are tested
- stale or invalid datasets are retired safely

## 11. Summary

Test Data is a governed validation dependency, not disposable input.
