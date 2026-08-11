---
id: SPEC-212
title: Reporting
version: 1.0.0
status: accepted
owner:
  - Product Governance
  - Quality Engineering
depends_on:
  - SPEC-101
  - SPEC-102
  - SPEC-205
  - SPEC-206
  - SPEC-210
  - SPEC-211
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-004
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-212: Reporting

## 1. Purpose

Reporting produces audience-appropriate, traceable views of quality, risk, coverage, execution, defects, releases, governance, and learning.

## 2. Principles

- every material claim SHALL trace to evidence
- report time, scope, policy, and data freshness SHALL be visible
- unknown and not-applicable SHALL remain distinct from zero and pass
- aggregate metrics SHALL not hide critical failures
- historical reports SHALL remain reproducible
- Workspace access SHALL be enforced in every view and export

## 3. Report Types

- executive quality and risk
- requirement and risk coverage
- test strategy and design readiness
- execution and evidence
- defect and escape analysis
- release readiness
- operational quality
- governance and quality-gate status
- knowledge and learning
- Workspace-specific audit

## 4. Report Contract

Every report SHALL identify:

- report ID and version
- audience and purpose
- Workspace and access scope
- reporting period and generated time
- source artifacts and versions
- metric definitions
- filters and exclusions
- freshness and completeness
- findings, uncertainty, and limitations
- drill-down evidence links

## 5. Metrics

Metrics SHALL have an owner, definition, numerator, denominator, dimensions, source, update cadence, interpretation, and known limitations.

Metric definitions SHALL be versioned.

## 6. Aggregation

Critical failures, expired exceptions, cross-Workspace incidents, and blocked mandatory gates SHALL remain visible regardless of overall score.

Comparisons SHALL use compatible definitions and populations.

## 7. Narrative Summaries

AI MAY draft summaries from structured results.

Summaries SHALL cite underlying facts, distinguish inference, expose missing data, and never fabricate causality.

## 8. Exports

Exports SHALL retain scope, provenance, generation time, classification, and access controls.

Sensitive evidence SHALL be redacted or excluded according to purpose.

## 9. Quality Gates

A report passes when sources are attributable, metrics are defined, scope and freshness are visible, critical exceptions cannot be hidden, isolation passes, and conclusions are supported.

## 10. Definition of Done

- report contracts are versioned
- drill-down reaches authoritative evidence
- historical reproduction is supported
- metric changes trigger impact analysis
- access and export tests pass

## 11. Summary

Reporting converts governed evidence into decisions without converting presentation into authority.
