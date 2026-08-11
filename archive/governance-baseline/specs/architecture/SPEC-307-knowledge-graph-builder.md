---
id: SPEC-307
title: Knowledge Graph Builder Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Knowledge Engineering
depends_on:
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - SPEC-303
related_adrs:
  - ADR-001
  - ADR-004
  - ADR-005
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-307: Knowledge Graph Builder Architecture

## 1. Purpose

The Knowledge Graph Builder materializes validated ontology entities and relationships into navigable, version-aware, Workspace-safe graph views.

## 2. Responsibilities

- consume approved objects and candidate observations
- validate nodes and edges against SPEC-101
- preserve identity, version, authority, provenance, and applicability
- build derived navigation and impact views
- detect dangling, duplicate, conflicting, and prohibited relationships
- maintain incremental updates and rebuild capability

It SHALL NOT redefine source authority or silently merge candidates with accepted knowledge.

## 3. Graph Layers

- authoritative graph
- candidate graph
- runtime evidence graph
- derived navigation and impact projections

Layers SHALL remain distinguishable in query results.

## 4. Build Pipeline

```text
Read Versioned Source Changes
↓
Validate Ontology and Workspace
↓
Resolve Identity and Relationships
↓
Apply Graph Constraints
↓
Materialize Versioned Projection
↓
Verify Counts, Links, and Provenance
↓
Publish Atomically
```

## 5. Incremental Consistency

Derived projections MAY be eventually consistent. Query results SHALL expose projection version and freshness when it can affect decisions.

Full rebuild SHALL produce semantically equivalent results from the same sources.

## 6. Quality Gates

Architecture passes when rebuild determinism, source provenance, candidate separation, temporal queries, impact traversal, and cross-Workspace negative tests pass.

## 7. Failure, Recovery, and Operability

The builder SHALL distinguish invalid source, ontology incompatibility, dangling reference, projection lag, partial batch, storage failure, and unauthorized scope. Checkpoints and idempotent writes SHALL allow restart without duplicate nodes or edges; a failed incremental build SHALL not replace the last known-good projection. Configuration SHALL version batch and traversal limits, freshness thresholds, ontology, and retention. Metrics SHALL expose build lag, invalid relationships, candidate/accepted separation, rebuild equivalence, query truncation, and Workspace isolation failures.

## 8. Summary

The Graph Builder creates useful projections of governed knowledge without becoming a second source of truth.
