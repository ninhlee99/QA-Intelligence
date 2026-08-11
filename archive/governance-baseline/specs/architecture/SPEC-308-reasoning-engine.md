---
id: SPEC-308
title: Reasoning Engine Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - AI Governance
depends_on:
  - SPEC-101
  - SPEC-103
  - SPEC-104
  - SPEC-105
  - SPEC-301
  - SPEC-307
related_adrs:
  - ADR-002
  - ADR-006
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-308: Reasoning Engine Architecture

## 1. Purpose

The Reasoning Engine coordinates deterministic rules, governed knowledge retrieval, bounded AI inference, evidence evaluation, and uncertainty reporting for decisions that cannot be resolved by rules alone.

## 2. Responsibilities

- classify the reasoning request and consequence
- construct minimal authorized context
- execute deterministic rules first
- retrieve applicable knowledge with provenance
- invoke provider-independent AI interfaces when justified
- validate output against schemas, rules, and evidence
- produce an explainable result or declare uncertainty

It SHALL NOT grant itself authority, invent evidence, or persist conclusions as accepted knowledge.

## 3. Reasoning Pipeline

```text
Authorize Request and Workspace
↓
Resolve Purpose, Risk, and Output Contract
↓
Apply Deterministic Rules
↓
Discover and Rank Governed Knowledge
↓
Assemble Minimal Context
↓
Invoke Bounded AI Capability
↓
Validate Claims, Citations, and Policy
↓
Return Result, Evidence, and Uncertainty
```

## 4. Result Contract

Results SHALL include outcome, status, deterministic findings, inferred claims, source citations, contradictions, uncertainty, model/prompt/tool identity, policy version, Workspace, and required human action.

## 5. Autonomy

Consequence classes SHALL determine permitted tools, approval, and execution authority.

High-impact external or authoritative changes require human approval.

## 6. Failure Behavior

Missing authority, insufficient evidence, conflicting sources, provider failure, invalid output, policy denial, and unsafe request SHALL be distinct. The engine SHALL prefer `indeterminate` over unsupported certainty.

## 7. Quality Gates

Architecture passes when deterministic-first behavior, minimal context, citation validation, prompt-injection defense, provider substitution, human oversight, auditability, and Workspace isolation pass.

## 8. Limits, Recovery, and Observability

Policy SHALL bound context size, retrieval breadth, Tool authority, iterations, latency, tokens, cost, retries, and consequence-specific approvals outside the prompt. A provider retry SHALL retain the failed attempt and SHALL not repeat side effects. Results that fail schema, citation, authority, or evidence checks become explicit invalid or indeterminate outcomes. Metrics SHALL expose rule outcomes, retrieval coverage, citation validity, provider/model version, refusal, invalid output, injection defense, uncertainty, latency, cost, escalation, and human override without logging hidden reasoning or protected content.

## 9. Summary

The Reasoning Engine provides bounded inference on top of rules and knowledge; it does not replace either.
