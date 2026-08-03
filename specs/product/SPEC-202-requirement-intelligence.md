---
id: SPEC-202
title: Requirement Intelligence
version: 1.0.0
status: accepted
owner:
  - Product Requirements
depends_on:
  - SPEC-101
  - SPEC-104
  - SPEC-201
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-002
  - ADR-006
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-202: Requirement Intelligence

## 1. Purpose

Requirement Intelligence converts product intent and discovery evidence into structured, testable, traceable requirements without inventing authority.

## 2. Goals

- normalize requirement meaning
- identify ambiguity, contradiction, duplication, and gaps
- connect requirements to capabilities, rules, risks, and evidence
- preserve source intent and revision history
- support human review and approval

## 3. Inputs

- accepted product intent
- Discovery Reports
- specifications and policies
- approved Knowledge Objects and rules
- stakeholder statements
- existing requirements, tests, defects, and release evidence

## 4. Requirement Contract

Every requirement SHALL include:

- stable ID and version
- title and normative statement
- source and authority
- accountable owner
- primary capability
- scope and applicability
- rationale
- acceptance criteria
- assumptions and dependencies
- related rules and risks
- lifecycle status
- traceability relationships

## 5. Requirement Types

- business
- stakeholder
- functional
- quality attribute
- constraint
- compliance
- data
- interface
- operational
- security and privacy

Type SHALL describe intent, not repository location.

## 6. Workflow

```text
Collect Sources
↓
Preserve Original Statements
↓
Normalize Concepts
↓
Classify and Decompose
↓
Detect Gaps, Conflicts, and Duplicates
↓
Draft Testable Requirements
↓
Trace Rules, Risks, and Criteria
↓
Human Review and Acceptance
```

## 7. Decomposition

Requirements SHALL be split when statements have different owners, applicability, lifecycle, or validation methods.

Decomposition SHALL preserve a trace to the original intent.

## 8. AI Assistance

AI MAY extract, classify, compare, and propose wording.

AI SHALL:

- cite sources
- label assumptions
- retain uncertainty
- avoid adding unstated obligations
- submit generated requirements for human approval

## 9. Conflict Handling

Conflicts SHALL retain all source statements, authority levels, applicability, affected artifacts, and owner decisions.

The platform SHALL NOT silently merge conflicting requirements.

## 10. Lifecycle

```text
draft → in_review → accepted → implemented → verified → deprecated | superseded
```

Transitions SHALL record actor, reason, evidence, and affected versions.

## 11. Traceability

Every accepted requirement SHALL trace upstream to intent and downstream to applicable risk, design, rule, test, automation, execution evidence, defect, and release.

## 12. Quality Gates

A requirement passes when:

- source and owner are known
- one primary obligation is stated unambiguously
- applicability and exclusions are explicit
- acceptance criteria are observable
- conflicts and dependencies are resolved or visible
- traceability is complete for its lifecycle stage
- AI-generated content has human approval

## 13. Definition of Done

- requirement objects are versioned
- source wording remains recoverable
- acceptance criteria are testable
- downstream impact is known
- accepted status is authorized

## 14. Summary

Requirement Intelligence makes intent precise and testable while preserving authority, provenance, and uncertainty.
