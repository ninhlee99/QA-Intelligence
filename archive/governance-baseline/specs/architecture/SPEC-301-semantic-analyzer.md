---
id: SPEC-301
title: Semantic Analyzer Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Knowledge Engineering
depends_on:
  - SPEC-101
  - SPEC-104
  - SPEC-201
  - SPEC-202
related_adrs:
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-301: Semantic Analyzer Architecture

## 1. Purpose

The Semantic Analyzer converts governed source material into typed semantic observations, mappings, conflicts, and candidates aligned with SPEC-101.

## 2. Responsibilities

- normalize authorized source content
- resolve canonical concepts and relationships
- apply deterministic rules before AI inference
- distinguish facts, derived observations, and hypotheses
- preserve source spans and provenance
- report ambiguity and conflict

It SHALL NOT approve requirements, promote knowledge, or persist provider-specific output as canonical meaning.

## 3. Inputs and Outputs

Inputs are source references, Workspace context, ontology version, applicable rules, and analysis purpose.

Outputs are semantic observations containing type, normalized value, source spans, relationships, confidence, authority, applicability, and diagnostics.

## 4. Processing Pipeline

```text
Authorize and Classify Source
↓
Normalize Representation
↓
Apply Deterministic Extraction
↓
Resolve Ontology Concepts
↓
Perform Bounded AI Analysis
↓
Validate Relationships and Scope
↓
Emit Observations, Conflicts, and Candidates
```

## 5. Interfaces

The module depends on source adapters, Ontology service, Rule Engine, optional AI provider abstraction, and provenance recorder.

Consumers receive provider-independent semantic results.

## 6. Failure Behavior

Unsupported format, missing ontology, ambiguous Workspace, invalid rule set, provider failure, and unresolvable meaning SHALL be distinct outcomes.

Partial results SHALL expose coverage and uncertainty.

## 7. Quality Attributes

- semantic fidelity
- source traceability
- deterministic reproducibility where applicable
- Workspace isolation
- provider substitutability
- bounded latency and resource use
- explainability

## 8. Quality Gates

Architecture passes when ontology alignment, provenance, isolation, deterministic-first processing, provider independence, and ambiguity handling are validated.

## 9. Operability and Boundaries

Configuration SHALL version source-size limits, supported formats, ontology and rule versions, inference thresholds, provider budgets, timeouts, and redaction policy. Metrics SHALL expose throughput, coverage, deterministic and inferred finding counts, ambiguity, conflicts, provider failures, latency, and cost by Workspace without recording protected content. The public analyzer interface SHALL remain provider-neutral; parsers and model providers are adapters and SHALL be replaceable by deterministic fixtures or replay adapters in conformance tests.

## 10. Summary

The Semantic Analyzer interprets evidence without turning interpretation into authority.
