---
id: SPEC-501
title: Knowledge Store Interface
version: 1.1.0
status: accepted
owner:
  - Architecture
  - Knowledge Platform
depends_on:
  - SPEC-103
  - SPEC-108
  - SPEC-506
related_adrs:
  - ADR-001
  - ADR-008
  - ADR-017
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-501: Knowledge Store Interface

## 1. Purpose

This interface defines provider-independent commands and queries for governed knowledge persistence and retrieval.

This specification is the single source of truth for the public Knowledge Store contract; it SHALL not depend on or expose SPEC-401 implementation details.

Callers seeking bounded, run-scoped reuse of query results, or a corpus-scale selection strategy for large result sets, SHALL consult SPEC-108 (Memory Model), which is the canonical owner of that behavior. This interface remains the single source of truth for the underlying commands and queries themselves.

## 2. Commands

- `CreateKnowledgeDraft`
- `ReviseKnowledgeDraft`
- `SubmitKnowledgeReview`
- `RecordKnowledgeDecision`
- `DeprecateKnowledgeVersion`
- `ArchiveKnowledge`

Commands SHALL contain operation ID, Workspace context, actor, aggregate ID, expected revision, payload, and reason.

## 3. Queries

- `GetKnowledgeVersion`
- `GetCurrentAcceptedKnowledge`
- `ListKnowledgeHistory`
- `SearchKnowledge`
- `TraverseKnowledgeRelationships`
- `GetKnowledgeProvenance`

Queries SHALL require scope, authority/status filters, applicability, page limits, and consistency preference where relevant.

## 4. Result Envelope

Results SHALL expose outcome, value, revision, projection freshness, evidence references, warnings, and structured error.

## 5. Error Categories

`not_found`, `conflict`, `invalid`, `unauthorized`, `forbidden`, `integrity_failure`, `stale_projection`, and `unavailable`.

## 6. Compatibility

Additive optional fields are backward compatible. Changed meaning, required fields, authority behavior, or isolation semantics require a major version.

## 7. Conformance

Every implementation SHALL pass exact-version, concurrency, provenance, lifecycle, pagination, and cross-Workspace contract tests.

## 8. Operational Semantics

Commands are idempotent within operation and Workspace scope; optimistic revision conflicts never become silent last-write-wins. Queries SHALL define bounded pagination and freshness behavior. Timeouts, cancellation, retry eligibility, tracing, audit identity, and redaction are provider-neutral. Production and deterministic in-memory/replay implementations SHALL pass the same contract suite; storage errors SHALL not leak vendor exceptions into consumers.
