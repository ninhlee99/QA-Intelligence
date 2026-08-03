---
id: SPEC-204
title: Business Analysis
version: 1.0.0
status: accepted
owner:
  - Business Analysis
depends_on:
  - SPEC-101
  - SPEC-201
  - SPEC-202
  - SPEC-203
  - GOV-006
related_adrs:
  - ADR-002
  - ADR-004
  - ADR-006
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-204: Business Analysis

## 1. Purpose

Business Analysis models actors, goals, capabilities, workflows, decisions, policies, data, constraints, and outcomes required to understand product behavior.

## 2. Goals

- connect stakeholder goals to requirements
- model current and desired business workflows
- identify decisions, rules, exceptions, and handoffs
- expose assumptions and unresolved policy
- preserve traceability to evidence
- provide inputs for risk and test analysis

## 3. Core Concepts

- Actor and Role
- Goal and Outcome
- Capability
- Process and Workflow
- State and Transition
- Decision and Business Rule
- Business Event
- Information Object
- Constraint
- Exception
- Dependency

Concepts SHALL align with SPEC-101.

## 4. Inputs

- Discovery Reports
- accepted and proposed requirements
- policies and rules
- stakeholder evidence
- product observations
- operational and defect evidence

## 5. Outputs

- Business Context Model
- Capability Map
- Actor and Responsibility Map
- Workflow and State Model
- Decision Catalog
- Business Rule Candidates
- Exception Catalog
- Assumption and Question Register
- Traceability Map

## 6. Workflow Analysis

Every modeled workflow SHOULD identify:

- trigger
- preconditions
- actors and permissions
- ordered activities
- decisions and rules
- data consumed and produced
- states and transitions
- alternate and failure paths
- outcome
- evidence

## 7. Current and Target State

Current-state observations and target-state requirements SHALL remain separate.

A desired behavior SHALL NOT be documented as current fact.

Gaps SHALL identify required change, affected owner, assumptions, and validation.

## 8. Rules

Business rules discovered during analysis SHALL be proposed to Rule Governance.

Prompts, code, and UI behavior SHALL NOT become the authoritative rule definition.

## 9. Ambiguity and Conflict

The analysis SHALL preserve conflicting stakeholder statements and identify:

- source
- authority
- applicability
- affected workflow
- decision owner
- resolution status

## 10. Quality Gates

Business Analysis passes when:

- scope and actors are explicit
- workflows include normal, alternate, and failure paths
- decisions trace to rules or unresolved questions
- current and target state are distinguishable
- assumptions and conflicts are visible
- outputs support risk and test analysis

## 11. Definition of Done

- business model is versioned and owned
- canonical concepts are used
- requirements trace to workflows and outcomes
- unresolved policy is routed
- downstream impacts are identifiable

## 12. Summary

Business Analysis turns fragmented product evidence into a coherent, governed model of intent and behavior.
