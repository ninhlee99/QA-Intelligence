---
id: SPEC-103
title: Knowledge Store
version: 1.1.0
status: accepted
owner:
  - Knowledge Governance
  - Platform Engineering
depends_on:
  - SPEC-101
  - SPEC-102
  - GOV-004
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-004
  - ADR-005
  - ADR-008
  - ADR-010
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-103: Knowledge Store

## 1. Purpose

This specification defines the semantic responsibilities and contracts of the Knowledge Store.

This Knowledge specification owns store semantics. SPEC-501 owns the public contract and SPEC-401 owns persistence implementation responsibility.

The Knowledge Store is the governed system of record for Knowledge Objects, Knowledge Candidates, provenance, relationships, and lifecycle events.

## 2. Goals

- persist exact knowledge identity and version
- preserve provenance and historical interpretation
- enforce Workspace isolation
- support semantic and relationship retrieval
- provide auditable lifecycle operations
- remain independent of storage vendors
- expose stable interfaces to downstream capabilities

## 3. Non-Goals

The Knowledge Store does not:

- decide business rules
- promote candidates autonomously
- treat ranking as authority
- own product workflows
- expose raw vendor primitives as domain contracts

## 4. Responsibilities

The Store SHALL own:

- durable Knowledge Object records
- durable Knowledge Candidate records
- immutable accepted versions
- claim and provenance links
- ontology relationship persistence
- lifecycle transition history
- Workspace-scoped indexing
- retrieval audit records where required
- optimistic concurrency and integrity controls

## 5. Logical Collections

The logical model SHALL support:

- knowledge objects
- knowledge versions
- knowledge candidates
- claims
- sources
- relationships
- lifecycle events
- reviews and approvals
- access policies
- retrieval indexes

Physical co-location or separation is an implementation choice.

## 6. Core Operations

The provider-independent interface SHALL support:

- create draft
- retrieve exact version
- retrieve current accepted version
- revise draft
- submit for review
- record decision
- promote candidate
- deprecate or supersede
- archive
- query by type and applicability
- traverse governed relationships
- search with Workspace context
- inspect provenance and history

All writes SHALL identify actor, Workspace, expected revision, and reason.

## 7. Consistency

The Store SHALL guarantee:

- unique logical identity
- immutable accepted versions
- atomic lifecycle transition records
- no dangling required provenance
- relationship referential integrity
- Workspace-consistent reads and writes
- idempotent handling of retried commands

Eventual consistency MAY be used for derived indexes, but authoritative reads SHALL identify index staleness when relevant.

## 8. Query Semantics

Queries SHALL distinguish:

- exact identity lookup
- accepted-current lookup
- historical lookup
- filtered semantic search
- relationship traversal
- candidate-only search
- combined search with explicit authority filters

Default authoritative retrieval SHALL exclude rejected, expired, and unpromoted candidates.

## 9. Ranking

Ranking MAY consider:

- authority
- applicability
- semantic relevance
- recency
- evidence quality
- review status

Ranking SHALL NOT change stored authority or hide a stronger contradictory source without explanation.

SPEC-108 (Memory Model) owns the bounded, corpus-scale candidate-set selection and reuse-within-a-run strategy built on top of this ranking. The Knowledge Store SHALL NOT itself bound or cache result sets across calls; that is Memory's responsibility.

## 10. Workspace Isolation

Every operation SHALL receive an authenticated Workspace context.

The Store SHALL enforce isolation in:

- primary storage
- relationship traversal
- semantic/vector indexes
- full-text indexes
- caches
- backups
- exports
- audit logs
- background maintenance

Missing Workspace context SHALL fail closed for Workspace-scoped operations.

## 11. Global Knowledge

Global knowledge SHALL be explicitly classified and governed.

Workspace content SHALL NOT become global through aggregation, embedding, model training, or administrative convenience.

Workspace overrides MAY coexist with global knowledge when applicability and precedence are explicit.

## 12. History and Temporal Queries

The Store SHALL support answering:

- what knowledge existed at a given time
- which version an execution used
- why a claim changed
- who approved a transition
- which object superseded another

Historical records SHALL remain interpretable under the ontology version used at the time.

## 13. Concurrency

Updates SHALL use revision checks or equivalent concurrency control.

Conflicting updates SHALL:

- preserve both proposed changes
- avoid last-write-wins data loss
- identify affected claims and relationships
- route unresolved semantic conflicts for review

## 14. Failure Handling

The Store SHALL distinguish:

- validation failure
- authorization failure
- conflict
- not found
- unavailable dependency
- stale index
- integrity violation
- unsupported transition

Failures SHALL be structured, explainable, and safe to retry only when idempotency is guaranteed.

## 15. Backup and Recovery

Recovery SHALL preserve:

- identity and versions
- provenance
- lifecycle history
- Workspace isolation
- relationship integrity
- audit evidence

Recovery tests SHALL verify both data restoration and semantic integrity.

## 16. Observability

The Store SHALL expose Workspace-safe signals for:

- request outcomes and latency
- conflicts
- authorization failures
- index freshness
- lifecycle transitions
- integrity violations
- backup and recovery status

Telemetry SHALL NOT contain protected knowledge bodies by default.

## 17. Security

- access SHALL be least-privileged
- service and human identities SHALL be attributable
- sensitive fields SHALL be encrypted as required
- secrets SHALL NOT be stored as knowledge content
- exports SHALL be authorized and audited
- administrative cross-scope operations SHALL be explicit

## 18. Quality Gates

The Store passes when:

- Knowledge Object contracts round-trip without semantic loss
- exact versions remain immutable
- candidate authority separation is enforced
- Workspace isolation tests pass across every index and cache
- concurrency and retry behavior are correct
- recovery preserves provenance and history
- vendor substitution does not change domain semantics

## 19. Definition of Done

- provider-independent interface is specified
- canonical schemas validate
- lifecycle operations are auditable
- isolation, conflict, recovery, and historical tests pass
- operational thresholds and owners exist
- migrations preserve identity and provenance

## 20. Summary

The Knowledge Store preserves governed meaning over time.

It stores authority; it does not invent authority.
