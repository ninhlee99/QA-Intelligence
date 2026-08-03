---
id: SPEC-408
title: Ontology Repository Component
version: 1.0.0
status: accepted
owner:
  - Ontology Steward
depends_on:
  - SPEC-101
  - SPEC-307
  - SPEC-501
  - SPEC-506
related_adrs:
  - ADR-001
  - ADR-004
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-408: Ontology Repository Component

## 1. Purpose

The Ontology Repository provides versioned access to canonical entity types, relationship types, constraints, enumerations, and ontology migrations defined by SPEC-101.

## 2. Responsibilities

- load and validate machine-readable ontology releases
- resolve exact and current accepted ontology versions
- expose types, relationships, constraints, and enumerations through stable contracts
- preserve compatibility and migration metadata
- support validation without depending on persistence-vendor models
- distinguish global ontology definitions from Workspace-scoped instances

It SHALL NOT own Knowledge Objects, graph projections, business rules, or provider-specific storage structures.

## 3. Operations

- retrieve an exact ontology release
- resolve canonical type or relationship definitions
- validate an ontology extension
- compare releases
- retrieve migration and deprecation information
- verify integrity and provenance

## 4. Invariants

- accepted ontology releases are immutable
- identifiers are stable and never reused
- deprecated terms remain interpretable historically
- extensions cannot weaken global Workspace or security constraints
- identical releases produce identical validation behavior

## 5. Failure Contract

Unknown version, unknown term, invalid extension, incompatible release, integrity failure, and unavailable source SHALL remain distinct.

## 6. Security and Isolation

Global definitions MAY be shared. Workspace-owned extensions require explicit authorization and SHALL never expose another Workspace's private vocabulary or evidence.

## 7. Verification

Contract tests SHALL cover exact-version retrieval, compatibility, extension validation, historical interpretation, integrity, caching, and Workspace isolation.

## 8. Acceptance Criteria

- machine-readable ontology artifacts validate
- the component depends only on ontology and platform contracts
- graph and knowledge components can resolve the same canonical identities
- rebuild and cache behavior preserve semantic equivalence
- all failure outcomes are structured and explainable

## 9. Implementation Baseline and Operability

The canonical ontology serialization is the versioned YAML structure under `ontology/`, indexed by `meta/ONTOLOGY_INDEX.yaml`; it defines semantics, not persistence layout. PostgreSQL from ADR-012 MAY materialize releases and lookup indexes, but repository callers depend only on SPEC-501. Releases are distributed by exact version and integrity digest; caches are invalidated by version, never by silent mutation. Metrics SHALL expose version resolution, cache freshness, validation failures, incompatible extensions, integrity failures, and Workspace denial. Alternative persistence or distribution requires contract conformance and migration evidence, not a change to ontology meaning.

No unresolved implementation decision blocks this accepted component contract.
