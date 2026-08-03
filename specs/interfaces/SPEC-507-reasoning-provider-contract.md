---
id: SPEC-507
title: Reasoning Provider Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - AI Governance
depends_on:
  - SPEC-004
  - SPEC-503
  - SPEC-506
related_adrs:
  - ADR-002
  - ADR-006
  - ADR-007
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-507: Reasoning Provider Contract

## 1. Purpose

This contract isolates AI model providers behind stable structured-generation, tool, safety, usage, and provenance semantics.

## 2. Request

Requests SHALL include operation ID, Workspace context, task purpose and consequence class, model capability constraints, versioned prompt, authorized context references, output schema, allowed tools, limits, and safety policy.

## 3. Response

Responses SHALL include structured output, provider/model identity, finish status, safety outcomes, tool calls/results, token or cost usage, latency, citations supplied by the orchestrator, and provider diagnostics.

Provider-generated citations SHALL be validated before presentation as evidence.

## 4. Guarantees

- providers cannot widen tools or context
- output schema failure is explicit
- retry preserves attempt history
- safety refusal is distinct from service failure
- provider output is non-authoritative by default

## 5. Conformance

Implementations SHALL pass schema failure, timeout, refusal, tool denial, prompt injection, context leakage, provider substitution, usage limit, cancellation, and provenance tests.

## 6. Compatibility and Operations

Providers SHALL declare supported models, structured-output, Tool, cancellation, residency, context, rate, and usage-accounting capabilities. The adapter rejects unsupported combinations before sending content. Retry is bounded and records every attempt; provider identifiers, latency, usage, finish state, and safety outcome remain observable through normalized fields. A deterministic stub/replay provider and each live provider SHALL pass identical response-mapping and failure tests.
