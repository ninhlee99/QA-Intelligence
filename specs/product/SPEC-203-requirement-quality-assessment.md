---
id: SPEC-203
title: Requirement Quality Assessment
version: 1.0.0
status: accepted
owner:
  - Product Requirements
  - Quality Engineering
depends_on:
  - SPEC-104
  - SPEC-202
  - GOV-008
  - GOV-009
related_adrs:
  - ADR-002
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-203: Requirement Quality Assessment

## 1. Purpose

This capability evaluates whether requirements are clear, complete, consistent, feasible, testable, traceable, and appropriately governed.

## 2. Assessment Dimensions

- atomicity
- clarity
- completeness
- consistency
- correctness against authority
- feasibility
- necessity
- testability
- traceability
- applicability
- security and privacy
- Workspace safety

## 3. Inputs and Outputs

Inputs are requirement versions, sources, related rules, architecture, risks, and existing validation evidence.

Outputs are:

- dimension findings
- rule results
- evidence references
- severity
- overall outcome
- remediation suggestions
- unresolved questions

## 4. Assessment Order

```text
Validate Identity and Source
↓
Apply Deterministic Rules
↓
Check Semantic Consistency
↓
Evaluate Traceability and Risk
↓
Use AI for Bounded Ambiguity Analysis
↓
Produce Explainable Findings
↓
Human Decision
```

## 5. Deterministic Checks

The platform SHOULD deterministically detect:

- missing metadata
- undefined canonical terms
- multiple uncontrolled obligations
- unverifiable acceptance criteria
- missing owner or source
- invalid lifecycle transition
- broken links
- duplicate IDs
- explicit conflict with accepted rules

## 6. AI-Assisted Checks

AI MAY propose findings about ambiguity, implied assumptions, missing scenarios, or inconsistent semantics.

Such findings SHALL cite exact text and governing context and SHALL remain recommendations until reviewed.

## 7. Outcomes

- pass
- pass with recommendations
- changes required
- blocked by missing authority or context
- rejected due to conflict or unsafe intent

A score SHALL NOT override a critical finding.

## 8. Severity

- Critical: unsafe, unauthorized, cross-Workspace, or fundamentally contradictory
- High: materially ambiguous, untestable, or incompatible
- Medium: meaningful quality gap with bounded effect
- Low: clarity or maintainability improvement

## 9. Quality Gates

Assessment passes when:

- exact requirement version was evaluated
- applicable deterministic rules ran
- findings cite evidence and authority
- missing context is not treated as success
- critical failures block acceptance
- AI judgments are distinguishable from deterministic results

## 10. Definition of Done

- all applicable dimensions have outcomes
- findings are owned and traceable
- false-positive review is supported
- assessment policy version is retained
- re-evaluation occurs after material requirement change

## 11. Summary

Requirement quality is an explainable decision based on authority and evidence, not a stylistic score.
