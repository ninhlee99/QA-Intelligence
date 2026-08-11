---
id: SPEC-509
title: Skill Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - AI Governance
depends_on:
  - SPEC-106
  - SPEC-309
  - SPEC-506
related_adrs:
  - ADR-002
  - ADR-006
  - ADR-008
  - ADR-011
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-509: Skill Contract

## 1. Purpose

This contract defines how the Agent Runtime discovers, validates, selects, invokes, and observes a Skill without depending on its instruction format or implementation packaging.

## 2. Operations

- `describe(skill_id, version) -> descriptor`
- `match(task_context) -> match_result`
- `validate(invocation) -> validation_result`
- `invoke(invocation) -> skill_result`

## 3. Descriptor and Invocation

The descriptor SHALL include the SPEC-106 definition, trigger model, contract versions, permissions, dependencies, budgets, side-effect class, and evaluation-suite references. Invocation SHALL contain exact Skill version, Workspace and run identity, validated inputs, authorized context references, Tool capabilities, policy, limits, and idempotency scope.

## 4. Match and Result

Match results expose positive and negative trigger evidence, confidence, alternatives, conflicts, and whether human selection is required. Results expose contract-valid output, postconditions, evidence, Tool intents or calls, usage, uncertainty, escalation, and failure class.

## 5. Guarantees and Conformance

Skill selection never widens authority. Invalid preconditions prevent invocation. Side effects are declared before execution. Implementations SHALL pass positive trigger, negative trigger, ambiguity, conflict, invalid input, missing dependency, permission denial, deterministic replay, cancellation, postcondition, evidence, and Workspace isolation tests.

## 6. Compatibility and Operations

Input, output, trigger, dependency, authority, and side-effect semantics are versioned test surfaces. Breaking changes require a new major Skill/contract version, migration or coexistence plan, regression suite, and impact review. Invocation is bounded by declared time, usage, and Tool limits; traces expose selected version, trigger evidence, outcome, usage, escalation, and failure without treating conversational memory as durable state.
