---
id: GOV-012
title: Agent and Skill Quality Gates
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
accountable_owner: AI Governance
approvers:
  - Architecture
  - Security
  - Product Governance
depends_on:
  - SPEC-004
  - SPEC-007
  - SPEC-106
  - SPEC-107
  - SPEC-213
  - SPEC-309
  - SPEC-310
  - GOV-008
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-005
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-011
  - ADR-017
  - ADR-013
  - ADR-014
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/GOVERNANCE_REVIEW.yaml
---

# Agent and Skill Quality Gates

## 1. Purpose

This document specializes GOV-009 for creating, changing, evaluating, and releasing QA Intelligence Agents and Skills. It adds no new product authority and cannot weaken Foundation, security, Workspace, knowledge, or release governance.

## 2. Governing Principles

- deterministic rules and executable assertions precede LLM inference or judging
- effective authority is least privilege and is enforced outside prompts
- Skill procedure, Tool adapter, Agent runtime, and Evaluation engine remain separate responsibilities
- the contract at each seam is the shared production and test surface
- non-determinism is measured through repeated trials, never hidden by a single favorable run
- critical invariant failure cannot be averaged away
- evaluator or infrastructure failure is not subject failure
- evaluation recommendation is not release approval
- observations create Knowledge Candidates, not direct learning or authority

## 3. Gate Sequence

### G1 — Intent and Definition Gate

Required evidence:

- owner, users, QA purpose, outcomes, non-goals, consequence class, and Workspace scope
- Agent/Skill schema validation and exact dependency versions
- positive and negative triggers for Skills
- inputs, outputs, preconditions, postconditions, failure, uncertainty, and escalation
- traceability to accepted Foundation, ADR, product requirements, rules, and risks

Blocking conditions include missing owner, ambiguous authority, untraceable behavior, undocumented side effects, or a Skill that duplicates Plugin responsibility.

### G2 — Authority and Sandbox Gate

Required evidence:

- permitted knowledge scopes, rules, Tools, data classes, credentials, network access, and approvals
- maximum steps, duration, Tool calls, retries, usage and cost
- idempotency, compensation, cancellation, timeout, cleanup, and unknown-effect behavior
- prompt-injection, exfiltration, privilege-escalation, destructive-action, denial-of-wallet, infinite-loop, and cross-Workspace cases

Any unbounded resource or ability to widen authority is blocking.

### G3 — Contract and Determinism Gate

Required evidence:

- Agent Runtime, Skill, Tool, and Evaluation contracts validate
- production adapters and deterministic fake/replay adapters pass the same contract tests
- deterministic Skills run without a model provider when the contract permits
- version, policy, knowledge, prompt, model, Tool, environment, and evaluator identities are retained
- recovery never repeats an unknown non-idempotent effect

A provider SDK in domain logic or behavior defined only by a prompt is blocking.

### G4 — Evaluation Readiness Gate

Required evidence:

- suites and cases trace to requirements and risks
- normal, negative, boundary, adversarial, failure, recovery, cancellation, and isolation coverage
- oracle hierarchy, critical assertions, metrics, thresholds, minimum trials, and permitted variance fixed before execution
- development, tuning, release benchmark, and hidden holdout data separated
- Judge calibration, independence, disagreement, injection, and failure behavior tested where used

Missing critical oracle, contaminated holdout, or LLM-only critical verdict is blocking.

### G5 — Regression and Release Recommendation Gate

Required evidence:

- all critical invariants pass
- required suites complete with acceptable variance
- changed subject and test-condition versions are disclosed
- failures are classified and unresolved uncertainty is visible
- performance, latency, usage, and cost stay within approved budgets
- evaluation report is immutable, signed, reproducible to the declared degree, and independently reviewable

The output is a recommendation defined by SPEC-213. It does not release the subject.

### G6 — Controlled Release and Monitoring Gate

Required evidence:

- authorized owner approval and separation from subject author for high-consequence changes
- versioned deployment, rollback, compatibility, and migration plan
- canary scope, rate and cost limits, monitoring, alerting, kill switch, and incident owner
- production quality indicators linked to evaluation metrics without promoting observations directly to knowledge

Critical security, Workspace, evidence-integrity, or unauthorized destructive-action failure cannot be overridden.

## 4. Change Classes

Re-evaluation is required for changes to Agent, Skill, Prompt, model/provider, Tool, adapter, rule, knowledge scope, dataset, oracle/Judge, policy, permission, runtime, or environment. Impact analysis determines suite scope, but security, isolation, and authority regression suites are mandatory for every executable version change.

## 5. Overrides

An override SHALL record scope, accountable owner, independent approver, reason, evidence, residual risk, compensating control, expiry, and rollback trigger. It cannot change a failed result to passed and cannot bypass non-overridable critical invariants.

## 6. Minimum Definition of Ready to Implement

Implementation of an initial tracer bullet may begin when:

1. SPEC-106, SPEC-107, and the selected Product behavior are reviewed and accepted for that slice
2. SPEC-309, SPEC-310, and applicable Interfaces are accepted
3. schemas and at least one valid and invalid example per contract pass automatically
4. G1–G4 test evidence exists for the selected Agent/Skill
5. deterministic fake/replay adapter plans, fixtures, and shared contract suites are defined so these adapters can be the first implementation increment
6. no unresolved critical architecture, authority, isolation, or data decision remains

The whole roadmap need not be implemented before a narrow tracer bullet, but the accepted specification baseline and selected slice SHALL be vertically complete and governed. Implementing and passing the adapters is required before G3 completion and before the Agent or Skill can be enabled beyond development.
