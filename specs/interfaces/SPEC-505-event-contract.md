---
id: SPEC-505
title: Platform Event Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Platform Engineering
depends_on:
  - SPEC-101
  - SPEC-506
related_adrs:
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-505: Platform Event Contract

## 1. Purpose

This contract defines immutable facts exchanged asynchronously across QA Intelligence components.

## 2. Envelope

Every event SHALL include:

- event ID and type
- schema version
- occurred and recorded timestamps
- producer identity and version
- Workspace ID or explicit global scope
- actor and correlation/causation IDs
- aggregate ID and sequence where applicable
- payload
- classification and integrity metadata

## 3. Semantics

Events describe completed facts and SHALL NOT be used as ambiguous commands.

Consumers SHALL be idempotent. Ordering is guaranteed only where explicitly declared by aggregate or partition.

## 4. Evolution

Additive optional fields MAY be compatible. Removed fields, changed meaning, changed scope, or changed ordering require a new major schema version and migration plan.

## 5. Security

Sensitive payloads SHALL be minimized. Workspace authorization SHALL be enforced at publish and consume boundaries. Dead-letter handling SHALL preserve classification.

## 6. Conformance

Tests SHALL cover schema compatibility, duplicate delivery, reordering, replay, poison events, authorization, redaction, and unknown versions.

## 7. Delivery and Operability

Publishers SHALL use a transactional outbox or an equivalently proven atomic handoff where an event represents a committed state change. Consumers persist idempotency and checkpoints before acknowledging delivery. Retry, dead-letter, replay, retention, payload-size, and ordering policies are explicit per event type. Metrics SHALL expose lag, duplicate, retry, poison, dead-letter, authorization denial, and schema rejection without treating transport delivery as domain success.
