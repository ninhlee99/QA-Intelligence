---
id: SPEC-503
title: Plugin Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Platform Engineering
depends_on:
  - SPEC-305
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-503: Plugin Contract

## 1. Purpose

This contract defines common lifecycle, capability, permission, health, invocation, and evidence semantics for all plugins.

This specification is the single source of truth for the provider-neutral plugin protocol.

## 2. Descriptor

A plugin SHALL declare identity, version, interface versions, capabilities, permissions, configuration schema, environments, compatibility, integrity digest, owner, and support lifecycle.

## 3. Lifecycle Operations

- validate configuration
- initialize scoped instance
- report health and capabilities
- invoke typed operation
- cancel operation
- dispose resources

Initialization SHALL receive only approved Workspace-scoped configuration and secret references.

## 4. Invocation Envelope

Every invocation SHALL include operation ID, Workspace context, interface version, capability, typed input, deadline, evidence policy, and cancellation token.

## 5. Response Envelope

Responses SHALL contain stable outcome, typed output, provider-neutral diagnostics, evidence references, retry classification, and plugin version.

## 6. Prohibitions

Plugins SHALL NOT own business policy, access unrelated credentials, widen permissions, return unscoped evidence, or require consumers to understand provider exceptions.

## 7. Conformance

Certification SHALL cover lifecycle, capability negotiation, schema validation, timeout, cancellation, cleanup, permission denial, failure mapping, evidence redaction, and isolation.

## 8. Evolution and Operations

Invocation is idempotent only when declared by the implemented capability; unknown or partial effects block automatic retry. Major interface incompatibility SHALL be rejected before initialization. Health, latency, usage, failure class, and cleanup SHALL be observable through provider-neutral fields. Every production plugin SHALL have a deterministic fake or replay adapter exercising the same contract; plugin removal requires consumer impact analysis, migration, and rollback.
