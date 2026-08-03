---
id: SPEC-201
title: Discovery
version: 1.0.0
status: accepted
owner:
  - Product Discovery
depends_on:
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - SPEC-105
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-003
  - ADR-004
  - ADR-006
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-201: Discovery

## 1. Purpose

Discovery builds an evidence-backed semantic understanding of a product, Workspace, or feature before the platform asks users for information or generates downstream artifacts.

## 2. Goals

- discover existing authoritative artifacts and runtime evidence
- understand UI features semantically rather than as raw DOM
- reduce redundant questions
- identify gaps, conflicts, and uncertainty
- create traceable discovery findings
- preserve Workspace isolation and source provenance

## 3. Non-Goals

Discovery does not approve requirements, promote knowledge, invent business rules, or treat external content as authority.

## 4. Inputs

- Workspace and authorization context
- product references and specifications
- approved Knowledge Objects
- applications or environments explicitly in scope
- existing requirements, tests, executions, and defects
- user-provided objectives and exclusions

## 5. Outputs

- Discovery Report
- Product Surface Map
- Semantic UI Map
- Evidence Inventory
- Known/Unknown Register
- Conflict Register
- Clarification Questions
- Knowledge Candidates

All outputs SHALL distinguish fact, inference, assumption, and question.

## 6. Workflow

```text
Confirm Scope and Access
↓
Search Existing Knowledge
↓
Inspect Authoritative Sources
↓
Observe Product Surface
↓
Extract Semantic Features and Workflows
↓
Correlate with Existing Artifacts
↓
Identify Gaps and Conflicts
↓
Ask Only Unresolved High-Value Questions
↓
Publish Discovery Evidence
```

## 7. Discovery Rules

- repository and Knowledge Store discovery SHALL precede user questioning
- sources SHALL be ranked by authority and applicability
- raw UI selectors SHALL be evidence, not product meaning
- unsupported inference SHALL be labeled
- access failure SHALL NOT be interpreted as feature absence
- dynamic and role-dependent behavior SHALL be recorded with context
- discovery SHALL be repeatable against identified source versions

## 8. Semantic UI Discovery

UI discovery SHALL identify Page, Region, Feature, Field, Action, Validation, Navigation, State, Permission, and Workflow concepts from SPEC-101.

Each semantic element SHOULD include:

- stable semantic identity
- visible purpose
- location and containment
- permitted actions
- relevant states
- source observations
- confidence
- role and environment applicability

## 9. Questions

A clarification question SHALL be asked only when:

- the answer cannot be discovered from authorized sources
- the uncertainty materially changes scope, risk, or outcome
- a reasonable assumption would be unsafe
- the question identifies why the answer is needed

## 10. Failure Handling

Discovery SHALL distinguish unavailable source, unauthorized source, inconsistent source, unsupported environment, stale evidence, and unresolved ambiguity.

Partial discovery MAY complete with explicit coverage and limitations.

## 11. Security and Workspace Isolation

All sources, caches, screenshots, DOM captures, summaries, and AI context SHALL remain Workspace-scoped.

Credentials, secrets, and unnecessary personal data SHALL not be retained in discovery artifacts.

## 12. Quality Gates

Discovery passes when:

- scope and coverage are explicit
- authoritative sources were searched first
- every material finding has provenance
- facts and inferences are distinguishable
- semantic UI meaning is independent of selectors
- uncertainties and conflicts are visible
- isolation and privacy checks pass

## 13. Definition of Done

- Discovery Report is versioned and owned
- evidence is attributable
- unresolved questions are prioritized
- candidate knowledge remains non-authoritative
- downstream product specs can cite exact findings

## 14. Summary

Discovery minimizes guessing by converting authorized evidence into a semantic, traceable product understanding.
