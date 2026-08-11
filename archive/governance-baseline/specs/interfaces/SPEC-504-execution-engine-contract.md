---
id: SPEC-504
title: Execution Engine Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Execution Platform
depends_on:
  - SPEC-210
  - SPEC-503
  - SPEC-505
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-504: Execution Engine Contract

## 1. Purpose

This contract allows execution providers to run approved assets through stable lifecycle, progress, cancellation, result, and evidence semantics.

## 2. Required Capabilities

- validate execution request
- prepare isolated execution
- start attempt idempotently
- stream or publish progress
- capture evidence under policy
- cancel cooperatively
- finalize and clean up
- report health and capacity

## 3. Request

Requests SHALL identify execution and attempt IDs, Workspace context, asset and test versions, environment, data references, configuration, deadline, evidence policy, and callback/event contract version.

## 4. Events

Engines SHALL emit accepted, preparing, started, progress, evidence-created, assertion-result, completed, failed, cancelled, and cleanup-completed events as applicable.

Events SHALL be ordered per attempt, idempotent, and correlated.

## 5. Result

Results SHALL distinguish product/test failure, blocked precondition, cancellation, timeout, infrastructure failure, and plugin error.

## 6. Conformance

Certification SHALL cover duplicate start, worker loss, late events, cancellation races, timeout, partial evidence, cleanup failure, schema evolution, and cross-Workspace attempts.

## 7. Compatibility and Operations

Start SHALL be idempotent within execution-attempt scope. Cancellation is monotonic, terminal outcomes are immutable, and late events cannot rewrite a terminal verdict. Requests, results, and events SHALL be version-negotiated and bounded; incompatible engines fail before work begins. Production engines and a deterministic simulator/replay engine SHALL pass identical lifecycle, result-mapping, and evidence contract tests.
