---
id: SPEC-502
title: Rule Engine Interface
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Rule Platform
depends_on:
  - SPEC-104
  - SPEC-506
related_adrs:
  - ADR-002
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-502: Rule Engine Interface

## 1. Purpose

This interface defines deterministic, versioned rule evaluation independent of rule-engine technology.

## 2. Request

An evaluation request SHALL include evaluation ID, Workspace context, rule-set selector or exact version, effective time, typed facts with provenance, requested decisions, and trace level.

## 3. Response

The response SHALL include:

- outcome: `satisfied`, `not_satisfied`, `indeterminate`, `not_applicable`, or `error`
- exact rules and rule-set versions
- matched conditions and relevant facts
- outputs
- conflicts and missing facts
- deterministic explanation trace
- timing and policy identity

## 4. Guarantees

- identical governed inputs produce identical semantic outputs
- evaluation does not persist authority changes
- missing facts do not become positive decisions
- Workspace rules cannot weaken non-overridable global controls

## 5. Errors

Invalid facts, unknown rule set, incompatible version, authorization denial, conflict, unsafe expression, timeout, and unavailable repository SHALL be distinct.

## 6. Conformance

Implementations SHALL pass boundary, precedence, historical time, missing-input, conflict, explanation, determinism, and isolation tests.

## 7. Compatibility and Operations

Requests and responses SHALL be schema-versioned, size-bounded, attributable, cancellable, and observable without logging protected facts. For identical facts, rules, effective time, and engine version, results SHALL be reproducible. Rule or explanation semantic changes require impact analysis and version migration. A deterministic reference adapter and each production adapter SHALL pass the same golden-vector contract suite.
