---
id: SPEC-206
title: Test Strategy
version: 1.1.0
status: accepted
owner:
  - Quality Engineering
depends_on:
  - SPEC-107
  - SPEC-202
  - SPEC-204
  - SPEC-205
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-009
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-206: Test Strategy

## 1. Purpose

Test Strategy defines how evidence will be obtained to evaluate requirements, risks, rules, interfaces, data, and runtime behavior.

## 2. Goals

- align validation effort with risk
- select appropriate test levels and techniques
- define environments, data, tooling, and evidence
- identify coverage, exclusions, and residual risk
- support release and operational gates

## 3. Strategy Contract

Every strategy SHALL identify:

- scope and objectives
- governing requirements and risks
- quality characteristics
- test levels and types
- techniques and coverage model
- environments and dependencies
- test data approach
- automation approach
- entry and exit criteria
- evidence and reporting
- roles and escalation
- exclusions, assumptions, and residual risk

## 4. Test Levels

- unit
- component
- contract
- integration
- system
- end-to-end
- acceptance
- production verification where governed

Each obligation SHOULD be validated at the lowest level that can prove it reliably.

## 5. Quality Characteristics

Applicable characteristics include correctness, security, privacy, isolation, compatibility, accessibility, usability, performance, resilience, recoverability, observability, and AI quality.

## 6. Risk-Based Selection

Test intensity SHALL consider consequence, likelihood, change impact, historical failure, uncertainty, and detectability.

Critical risks SHALL have explicit prevention and detection evidence.

## 7. Coverage

The strategy SHALL define coverage across requirements, risks, rules, workflows, states, interfaces, roles, Workspaces, data partitions, failure modes, providers, and migrations.

Line coverage MAY support but SHALL NOT replace obligation coverage.

## 8. Environments

Environment selection SHALL identify representativeness, controlled differences, credentials, data policy, dependencies, observability, and reset/recovery behavior.

The strategy SHALL combine the validation modes appropriate to the risk: human review, manual scripted testing, exploratory testing, deterministic checks, contract testing, automation, simulation, replay, sandbox execution, and governed production verification. Automation percentage SHALL NOT be used as a substitute for risk coverage or professional QA judgment.

## 9. AI Systems

AI validation SHALL apply the AI/Agent adversarial and coverage dimensions defined by SPEC-107 §5, the single source of truth for that list (task correctness, grounding, Tool-use safety, prompt injection, exfiltration, sensitive-data handling, drift, fallback, cost, and latency, among others). This section SHALL NOT independently enumerate that list.

## 10. Entry and Exit

Entry criteria SHALL ensure testable artifacts, environment readiness, data, access, and known versions.

Exit criteria SHALL define required evidence, allowed residual risk, unresolved defects, and approvals.

## 11. Quality Gates

A strategy passes when it covers material requirements and risks, defines reproducible evidence, addresses isolation and security, identifies exclusions, and has accountable approval.

## 12. Definition of Done

- traceability to requirements and risks exists
- techniques and test levels are justified
- environments and data are governed
- entry/exit criteria are measurable
- residual risks are owned
- manual, exploratory, and automated modes are selected by evidence and risk rather than automation targets

## 13. Summary

Test Strategy defines the most trustworthy and efficient path from risk to evidence.
