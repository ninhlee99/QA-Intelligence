---
id: SPEC-207
title: Test Design
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
depends_on:
  - SPEC-101
  - SPEC-104
  - SPEC-202
  - SPEC-205
  - SPEC-206
  - GOV-006
related_adrs:
  - ADR-002
  - ADR-003
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-207: Test Design

## 1. Purpose

Test Design converts strategy, requirements, risks, workflows, and rules into executable-independent test cases and coverage models.

## 2. Test Case Contract

Every test case SHALL include:

- stable ID and version
- purpose
- traced requirements, risks, and rules
- preconditions
- actor and Workspace scope
- test data requirements
- actions expressed semantically
- expected results and evidence
- cleanup or state restoration
- priority and tags
- lifecycle status and owner

## 3. Design Principles

- expected results SHALL derive from authority
- tests SHALL validate behavior, not implementation accidents
- semantic actions SHALL be independent of selectors and tools
- each material assertion SHALL be observable
- normal, alternate, boundary, and failure behavior SHALL be considered
- test independence and state effects SHALL be explicit

## 4. Techniques

- equivalence partitioning
- boundary analysis
- decision tables
- state transition testing
- scenario and workflow testing
- pairwise or combinatorial coverage
- error guessing grounded in evidence
- property and invariant testing
- model-based testing
- exploratory charters

## 5. Workflow

```text
Select Requirement and Risk
↓
Resolve Governing Rules
↓
Model States, Inputs, and Decisions
↓
Select Technique
↓
Design Semantic Actions and Assertions
↓
Review Coverage and Independence
↓
Approve Test Case
```

## 6. AI-Generated Tests

AI MAY propose tests only from provided authoritative context.

Generated tests SHALL cite requirements and risks, label assumptions, avoid invented expected results, and receive applicable review.

## 7. Maintainability

Test cases SHALL separate intent, data, semantic actions, and implementation bindings.

Changes to UI selectors or execution providers SHOULD NOT require changes to test intent.

The same approved test intent MAY be executed manually, through an exploratory charter, or by automation. Each binding SHALL preserve authoritative expected results, evidence obligations, Workspace scope, and cleanup; a tool-specific implementation SHALL NOT become a second source of test meaning.

## 8. Quality Gates

A test case passes when traceability is valid, preconditions and assertions are explicit, expected results are authoritative, scope and data are known, and the design covers its intended risk.

## 9. Definition of Done

- test cases are versioned
- coverage relationships are machine-readable
- semantic steps are tool-independent
- review includes negative and boundary behavior
- automation can implement the case without inventing intent

## 10. Summary

Test Design preserves business meaning while creating precise, reviewable validation assets.
