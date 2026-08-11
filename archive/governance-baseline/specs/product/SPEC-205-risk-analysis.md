---
id: SPEC-205
title: Risk Analysis
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Product Governance
depends_on:
  - SPEC-104
  - SPEC-202
  - SPEC-204
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-205: Risk Analysis

## 1. Purpose

Risk Analysis identifies, evaluates, prioritizes, and traces conditions that could prevent intended product, quality, security, data, AI, or operational outcomes.

## 2. Risk Model

Every risk SHALL identify:

- stable ID and version
- risk statement using cause, event, and consequence
- affected capability, requirement, Workspace, and consumer
- category
- likelihood and impact rationale
- detectability where applicable
- evidence and assumptions
- owner
- controls
- residual risk
- lifecycle status

## 3. Categories

- product and business
- functional quality
- security and privacy
- Workspace isolation
- data integrity
- AI and model behavior
- compatibility and migration
- performance and resilience
- operability
- compliance

## 4. Workflow

```text
Establish Context
↓
Identify Assets and Intended Outcomes
↓
Discover Threats, Failures, and Uncertainty
↓
Estimate Likelihood and Impact
↓
Identify Controls and Tests
↓
Evaluate Residual Risk
↓
Assign Owner and Treatment
↓
Monitor Evidence
```

## 5. Prioritization

Scoring SHALL use governed scales and retain rationales.

Aggregate score SHALL NOT hide:

- cross-Workspace exposure
- unauthorized behavior
- irreversible data loss
- evidence falsification
- unbounded AI autonomy

These risks require independent critical treatment.

## 6. Treatments

- avoid
- reduce
- transfer
- accept
- monitor

Risk acceptance SHALL come from the accountable risk owner and SHALL include duration and review triggers.

## 7. Traceability

Every material risk SHALL trace to affected requirements, controls, test strategy, test cases, executions, defects, and acceptance decisions.

## 8. AI Assistance

AI MAY suggest risks and scenarios but SHALL cite sources, declare uncertainty, and not accept residual risk.

## 9. Quality Gates

Risk Analysis passes when scope, evidence, owner, controls, residual risk, and treatment are explicit; critical categories are independently assessed; and test planning can consume the results.

## 10. Definition of Done

- risk register is versioned
- scoring policy is identified
- critical risks have specialist review
- accepted risks have current approval
- changes and incidents trigger reassessment

## 11. Summary

Risk Analysis directs validation and governance toward the failures with the greatest consequence.
