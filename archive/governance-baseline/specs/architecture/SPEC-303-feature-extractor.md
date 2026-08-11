---
id: SPEC-303
title: Feature Extractor Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - UI Intelligence
depends_on:
  - SPEC-101
  - SPEC-201
  - SPEC-301
  - SPEC-302
related_adrs:
  - ADR-002
  - ADR-003
  - ADR-004
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-303: Feature Extractor Architecture

## 1. Purpose

The Feature Extractor identifies semantic UI features, actions, states, validations, navigation, permissions, and workflow evidence from cleaned observations.

## 2. Responsibilities

- detect candidate Page, Region, Feature, Field, Action, and State entities
- correlate labels, roles, hierarchy, and interaction evidence
- apply deterministic patterns and governed rules
- use AI only for bounded semantic resolution
- produce confidence and source mapping
- identify changes relative to prior feature maps

It SHALL NOT approve Knowledge Objects or create raw selectors as product meaning.

## 3. Output

Each candidate feature SHALL include semantic type, proposed identity, name, purpose, containment, actions, states, permissions, evidence nodes, confidence, conflicts, and applicability.

## 4. Extraction Pipeline

```text
Load Cleaned Capture and Ontology
↓
Detect Structural Candidates
↓
Apply Rule-Based Classification
↓
Resolve Semantic Relationships
↓
Compare Existing Feature Graph
↓
Emit New, Changed, Conflicting, and Missing Candidates
```

## 5. Identity

Feature identity SHOULD use semantic anchors and historical correspondence, not fragile DOM position.

Identity uncertainty SHALL produce candidates rather than destructive merges.

## 6. Change Detection

The module SHALL distinguish presentation-only change, binding change, semantic change, permission change, workflow change, and unresolvable change.

## 7. Quality Gates

Architecture passes when feature candidates trace to evidence, ontology types validate, selector independence is maintained, identity collisions are safe, and Workspace boundaries pass.

## 8. Failure, Operability, and Limits

The module SHALL distinguish invalid cleaned input, incompatible ontology, missing accessibility semantics, identity collision, contradictory evidence, provider failure, and incomplete extraction. Configuration SHALL version extraction rules, confidence bands, identity thresholds, maximum graph size, provider budgets, and timeout. Metrics SHALL expose candidate counts, evidence coverage, collision/conflict rates, semantic-change classifications, latency, cost, and deterministic-versus-inferred origin. Reprocessing the same inputs and versions SHALL produce equivalent deterministic candidates.

## 9. Summary

The Feature Extractor bridges sanitized UI evidence and the governed semantic UI graph.
