---
id: ADR-012
title: PostgreSQL Persistence and Transactional Outbox Baseline
status: superseded
version: 1.0.0
date: 2026-08-03
decision_owners:
  - Architecture
  - Knowledge Governance
  - Runtime Platform
related_specs:
  - SPEC-103
  - SPEC-105
  - SPEC-309
  - SPEC-310
  - SPEC-601
  - SPEC-606
  - SPEC-607
related_adrs:
  - ADR-001
  - ADR-004
  - ADR-005
  - ADR-008
  - ADR-010
  - ADR-011
supersedes: []
superseded_by: ADR-017
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/OWNER_APPROVAL.yaml
---

# ADR-012: PostgreSQL Persistence and Transactional Outbox Baseline

> Superseded by ADR-017. This decision remains the baseline only for the
> optional shared/team server profile; it is no longer the default local
> runtime persistence decision.

## 1. Context

The first tracer bullet requires durable knowledge metadata, Workspace isolation, version resolution, Agent checkpoints, evaluation evidence, idempotency, and event publication. Introducing separate databases, graph stores, vector stores, and message brokers before measured need would enlarge failure and consistency surfaces.

## 2. Decision

Use PostgreSQL 18, on the current supported minor, as the initial transactional system of record. Use:

- relational tables for identity, ownership, lifecycle, Workspace, version, relationship, operation, and gate state
- JSONB only for schema-validated payloads whose fields are not transactional join keys
- append-only records for events, attempts, policy decisions, evidence metadata, and audit history
- a transactional outbox for publication after committed state changes
- database-backed bounded work claiming for the initial worker queue
- object storage through an interface for large immutable evidence; PostgreSQL stores integrity and location metadata

Graph and vector indexes are derived projections of governed Knowledge Store content. They SHALL be rebuildable and SHALL NOT become the source of truth.

## 3. Consistency and Isolation

- Every Workspace-scoped row includes immutable Workspace identity and is protected by application authorization plus database isolation controls.
- State mutation and outbox intent commit in one transaction.
- Consumers are idempotent and preserve attempt evidence.
- Knowledge promotion remains a governed domain transition, not a database write shortcut.

## 4. Module and Adapter Design

Persistence details remain inside repository adapters. Domain modules consume SPEC-501, SPEC-505, and runtime interfaces. The test counterparts are transactionally accurate local PostgreSQL or an explicitly limited in-memory adapter where transaction semantics are not under test.

## 5. Consequences

- Initial operations avoid distributed transaction and broker administration.
- Queue throughput and scheduling fairness are bounded by PostgreSQL capacity and must be measured.
- Large evidence never bloats transactional tables.
- A future broker, graph database, or vector engine requires an accepted ADR and must consume outbox or rebuildable projections.

## 5.1 Alternatives Considered

- **Separate relational, graph, vector, and event stores immediately** was rejected because it creates consistency and operational failure modes before representative workload evidence exists.
- **External message broker from the first slice** was rejected because the initial advisory workload does not justify another durable system; the transactional outbox preserves an extraction path.
- **Document or in-memory storage as the production source** was rejected because Workspace isolation, transactions, lifecycle history, recovery, and auditability require stronger guarantees.

## 6. Reversal and Extraction Criteria

Extract messaging only when measured throughput, latency, retention, fan-out, or independent availability cannot be met safely. Extract graph or vector storage only when representative query evidence shows PostgreSQL projections cannot meet approved SLOs. Extraction must preserve ordering, idempotency, provenance, Workspace, and replay contracts.

## 7. Validation

- migration, rollback, backup and restore tests
- transactional outbox atomicity and duplicate-delivery tests
- concurrent work-claim, worker-loss and retry tests
- row-level Workspace isolation and cross-Workspace denial tests
- projection rebuild and evidence integrity tests

## 8. Reference

- https://www.postgresql.org/support/versioning/
