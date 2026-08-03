---
id: SPEC-213
title: Agent and Skill Quality Assessment
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
  - Product Governance
depends_on:
  - SPEC-106
  - SPEC-107
  - SPEC-203
  - SPEC-205
  - SPEC-206
  - SPEC-207
  - SPEC-210
  - SPEC-212
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-006
  - ADR-008
  - ADR-009
  - ADR-010
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/PRODUCT_REVIEW.yaml
---

# SPEC-213: Agent and Skill Quality Assessment

## 1. Purpose

This capability enables QA Intelligence teams to define, execute, explain, compare, and govern tests for Agent and Skill versions before release and during controlled operation.

## 2. Users and Outcomes

Agent/Skill authors receive actionable failures tied to contracts and evidence. QA owners receive coverage, variance, risk, and regression analysis. Governance owners receive release-gate evidence. Operators receive safe canary and monitoring criteria.

## 3. Scope

The capability SHALL support:

- static definition and dependency validation
- Skill trigger, procedure, contract, conflict, and portability tests
- Agent task, policy, grounding, Tool-use, efficiency, resilience, and escalation tests
- deterministic, simulated, replay, sandbox, adversarial, and approved live-environment modes
- repeated trials, baseline comparison, regression diagnosis, and release recommendation
- human review for indeterminate or high-consequence outcomes

It SHALL NOT approve its own release, convert observations directly into knowledge, infer authority from a score, or treat model fluency as task correctness.

## 4. Assessment Workflow

```text
Select exact Agent or Skill version
→ resolve contracts, authority, and dependencies
→ validate suite and environment
→ run deterministic checks first
→ execute isolated trials within budgets
→ collect step, Tool, output, and policy evidence
→ apply Oracle/Judge hierarchy
→ aggregate without masking critical failures
→ compare baseline and diagnose change causes
→ issue signed recommendation and required actions
```

## 5. Functional Requirements

- Authors SHALL select or create suites traceable to requirements and risks.
- The system SHALL refuse runs with unresolved versions, invalid authority, missing critical oracles, incompatible contracts, or unsafe environments.
- Each trial SHALL support cancel, timeout, cleanup, and evidence preservation.
- Reports SHALL separate product failure, subject failure, evaluator failure, and infrastructure failure.
- Comparisons SHALL expose changes in subject and test conditions.
- Overrides SHALL require an authorized owner, reason, expiry, affected risks, and retained evidence.

## 6. Release Outcomes

The capability produces `recommend_release`, `recommend_conditional_release`, `reject_release`, or `indeterminate`. These are recommendations; the applicable governance owner makes the release decision.

No release recommendation is permitted when a critical security, isolation, authority, destructive-action, or evidence invariant fails.

## 7. Acceptance Criteria

- A deterministic Skill can be tested without a model provider.
- A non-deterministic Agent can be tested with repeated isolated trials and explicit variance.
- Tool calls and side effects are captured and checked against authority.
- Prompt injection and cross-Workspace cases fail safely.
- A Judge disagreement can be escalated without losing original evidence.
- An evaluator outage is never reported as a subject failure.
- A release recommendation traces to exact versions, cases, trials, evidence, and gate thresholds.

## 8. Inputs and Outputs

Required inputs are an exact subject definition, approved requirements and risks, versioned evaluation suite and cases, Oracle/Judge policy, Tool and environment contracts, Workspace context, budgets, baseline where comparison is requested, and release-gate policy.

Outputs are immutable trial records, normalized findings, evidence references, variance and confidence analysis, baseline comparison, evaluator-health results, unresolved questions, remediation actions, and a signed release recommendation. Conversation text, Judge prose, and aggregate scores SHALL NOT become authoritative evidence by themselves.

## 9. Authority and Separation of Duties

- deterministic validators and Oracles SHALL execute before probabilistic Judges where applicable
- the subject under test SHALL NOT approve its own result or modify its evaluation policy
- a Judge SHALL NOT receive unnecessary hidden labels or cross-Workspace context
- an evaluator failure SHALL be separately owned and SHALL not change the subject outcome to pass or fail
- overrides and human adjudication SHALL preserve the original results and dissenting evidence
- Knowledge Candidates arising from evaluations SHALL follow SPEC-105 before becoming approved knowledge

## 10. Failure, Recovery, and Limits

The capability SHALL distinguish invalid suite, incompatible contract, subject failure, policy violation, evaluator failure, Tool failure, environment failure, timeout, cancellation, budget exhaustion, cleanup failure, and indeterminate evidence.

Each campaign SHALL define maximum trials, concurrency, elapsed time, token or model cost, Tool calls, retries, evidence volume, retention, and destructive-action authority. Retries SHALL create attributable attempts and SHALL NOT erase the original outcome. Cancellation, timeout, or recovery SHALL revoke leases, stop unauthorized side effects, run safe cleanup, and retain evidence sufficient for diagnosis.

## 11. Observability and Reproducibility

Metrics SHALL include case and trial outcomes, critical-invariant failures, variance, flakiness, evaluator disagreement, evaluator and infrastructure error rates, latency, cost, Tool usage, cleanup outcome, and evidence completeness. Logs and traces SHALL carry campaign, case, trial, subject version, policy version, environment, actor, and Workspace identifiers with governed redaction.

A historical recommendation SHALL be reproducible from retained versions or explicitly marked non-reproducible with the missing dependency and impact.

## 12. Definition of Done

- positive, negative, boundary, adversarial, isolation, authority, cancellation, timeout, cleanup, and evaluator-failure cases exist where applicable
- at least one deterministic or replay adapter validates the core orchestration without a live provider
- production adapters pass the same contract suite as their deterministic or replay alternatives
- critical gates cannot be diluted by aggregation, variance, retries, or overrides
- exact versions, budgets, decisions, evidence, and responsible actors are retained
- security, privacy, Workspace isolation, provenance, and controlled-learning checks pass
- no unresolved decision blocks implementation of the accepted capability

## 13. Summary

Agent and Skill assessment applies experienced QA engineering discipline to non-deterministic systems: bounded authority, diverse test techniques, explainable evidence, explicit uncertainty, and human-governed release decisions.
