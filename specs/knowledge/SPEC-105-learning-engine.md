---
id: SPEC-105
title: Learning Engine
version: 1.1.0
status: accepted
owner:
  - Knowledge Governance
  - AI Governance
depends_on:
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - SPEC-104
  - GOV-006
  - GOV-007
  - GOV-009
related_adrs:
  - ADR-005
  - ADR-006
  - ADR-008
  - ADR-010
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-105: Learning Engine

## 1. Purpose

This specification defines how QA Intelligence derives governed improvement candidates from runtime evidence, reviews, defects, feedback, and evaluations.

The Learning Engine discovers and validates possible improvements.

It SHALL NOT change authoritative knowledge, rules, policy, or production behavior autonomously.

## 2. Goals

- identify repeated patterns and gaps
- preserve source provenance
- create bounded Knowledge Candidates and Improvement Proposals
- evaluate hypotheses against representative evidence
- prevent Workspace leakage
- support drift detection
- measure improvement effectiveness
- keep human authority explicit

## 3. Non-Goals

The Learning Engine does not:

- self-modify production policy
- auto-promote candidates
- train on Workspace content without authorization
- replace incident analysis or governance review
- treat correlation as causation
- optimize only for model confidence

## 4. Inputs

Permitted governed inputs include:

- execution results
- defects and resolutions
- review findings
- quality-gate outcomes
- user feedback
- operational incidents
- test flakiness and escapes
- knowledge conflicts
- rule outcomes
- AI evaluation results
- product outcome measures

Every input SHALL retain identity, Workspace, source time, and authorization.

## 5. Outputs

The engine MAY produce:

- Knowledge Candidate
- rule-change proposal
- test-gap proposal
- requirement ambiguity proposal
- risk candidate
- drift alert
- stale-knowledge alert
- quality-gate improvement proposal
- model or prompt evaluation proposal

Every output is non-authoritative until the applicable governance flow approves it.

## 6. Learning Workflow

```text
Observe Governed Evidence
↓
Normalize and Scope
↓
Detect Pattern or Drift
↓
Form Hypothesis
↓
Collect Supporting and Contradicting Evidence
↓
Estimate Applicability and Risk
↓
Create Candidate
↓
Human/Governed Validation
↓
Promote, Reject, Expire, or Rework
↓
Measure Post-Change Effectiveness
```

## 7. Candidate Requirements

Every candidate SHALL include:

- unique identity
- proposed change or claim
- affected artifact types
- source evidence
- contradicting evidence
- Workspace and applicability scope
- confidence and uncertainty
- expected benefit
- possible harm
- validation plan
- owner
- expiration

## 8. Pattern Detection

Pattern detection MAY use deterministic aggregation, statistical analysis, or AI assistance.

The method SHALL identify:

- inputs and sampling window
- exclusions
- algorithm or model version
- thresholds
- uncertainty
- known biases
- reproducibility limits

## 9. Drift

The engine SHOULD detect:

- knowledge staleness
- rule outcome distribution change
- AI evaluation degradation
- new defect clusters
- changed UI semantics
- execution instability
- risk assumption failure
- provider behavior change

Drift signals SHALL trigger investigation; they SHALL NOT directly rewrite authority.

## 9a. Mistake and Failure-Recurrence Prevention

A specific, mandatory application of pattern detection (§8): the engine
SHALL treat repeated defects, incorrect verdicts, and human-corrected Agent
decisions of the same causal class as a distinct candidate-generating
signal, so that a mistake already made and corrected does not recur
unaddressed.

- A single occurrence of a mistake is a candidate for the bounded,
  project-scoped avoidance-fact path defined by SPEC-108 §7.3 (Memory
  Model), not for this engine's full candidate lifecycle — a one-off,
  low-consequence mistake does not need synchronous human review to stop
  recurring within the same Workspace.
- A recurring mistake — the same causal class observed across multiple runs,
  or a mistake whose generalized form would apply beyond the originating
  Workspace (SPEC-108 §4.3) — SHALL be raised as a Learning Engine candidate
  through the full workflow in §6, with the recurrence count, affected runs,
  and prior avoidance-fact history included as supporting evidence.
- A recurring mistake SHALL NOT be treated as resolved until its
  post-promotion effectiveness (§16) shows the same causal class no longer
  produces the same failure, distinguishing a genuinely fixed pattern from
  one that merely stopped being observed.

This section does not create a new lifecycle; it directs an existing input
category (defects and resolutions, review findings, quality-gate outcomes)
toward the specific goal of not repeating known, avoidable errors.

## 10. Validation

Candidate validation SHALL consider:

- source quality
- frequency and severity
- representative coverage
- alternative explanations
- counterexamples
- Workspace differences
- historical context
- security and privacy
- change impact
- reversibility

## 11. Workspace Isolation

- analysis SHALL be Workspace-scoped by default
- cross-Workspace learning requires explicit governance
- protected content SHALL not be transferred through embeddings, summaries, or models
- aggregate insights SHALL satisfy anonymization and minimum-group policies
- global candidates SHALL not expose individual Workspace evidence

## 12. Human Oversight

Human approval is mandatory for:

- Knowledge Object promotion
- rule changes
- policy or gate changes
- production model or prompt changes
- changes to Workspace boundaries
- high-risk test or release decisions

The approving human SHALL receive evidence, uncertainty, conflicts, and expected impact.

## 13. Feedback Loops

Feedback loops SHALL have:

- explicit objective
- bounded inputs and outputs
- owner
- review cadence
- safety limits
- rollback path
- effectiveness metric
- stop conditions

Unbounded self-reinforcing loops are prohibited.

## 14. Bias and Data Quality

The engine SHALL assess:

- missing populations or scenarios
- survivorship bias
- feedback selection bias
- label quality
- duplicated evidence
- temporal imbalance
- Workspace overrepresentation
- synthetic-data contamination

Low-quality data SHALL reduce confidence and may block promotion.

## 15. AI Governance

AI-assisted learning SHALL record:

- model and provider
- prompt and configuration
- context sources
- tool usage
- evaluation method
- output uncertainty
- human reviewer

Model-generated rationales SHALL NOT be treated as independent supporting evidence.

## 16. Observability

The Learning Engine SHALL report:

- candidates by type and lifecycle
- promotion, rejection, and expiry rates
- evidence completeness
- validation lead time
- drift alerts and resolution
- post-promotion effectiveness
- false-positive and recurrence rates
- Workspace-safe usage and access signals

## 17. Failure Handling

The engine SHALL fail safe when:

- provenance is missing
- Workspace scope is ambiguous
- evidence integrity is invalid
- model or algorithm version is unknown
- protected data authorization is absent
- candidate owner cannot be assigned

Such cases SHALL produce a blocked or rejected candidate, not an authoritative change.

## 18. Quality Gates

The Learning Engine passes when:

- all outputs are non-authoritative by default
- provenance and Workspace scope are complete
- representative validation includes counterevidence
- promotion invokes applicable governance gates
- rollback and post-change measurement exist
- AI use follows SPEC-004 and QG-09
- no feedback loop can silently modify production authority

## 19. Definition of Done

- candidate contracts align with SPEC-102
- inputs and methods are versioned
- isolation and privacy tests pass
- promotion remains external and governed
- drift and effectiveness metrics exist
- simulated harmful, biased, and ambiguous signals fail safely
- a simulated recurring mistake produces a candidate with recurrence
  evidence and is distinguished from a one-off mistake handled by SPEC-108's
  avoidance-fact path

## 20. Summary

The Learning Engine makes improvement systematic without making it uncontrolled.

It converts evidence into proposals, not truth.
