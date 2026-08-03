---
id: SPEC-510
title: Agent Tool Contract
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Security
depends_on:
  - SPEC-106
  - SPEC-305
  - SPEC-309
  - SPEC-503
  - SPEC-506
related_adrs:
  - ADR-007
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/INTERFACE_REVIEW.yaml
---

# SPEC-510: Agent Tool Contract

## 1. Purpose

This contract provides capability-based Tool discovery and invocation while keeping provider SDKs and external technologies outside Agent and Skill logic.

## 2. Operations

- `list_capabilities(context) -> descriptors`
- `validate_call(intent) -> policy_decision`
- `invoke(call) -> tool_result`
- `inspect_effect(call_reference) -> effect_status`
- `compensate(call_reference, authorization) -> compensation_result`

## 3. Descriptor and Call

Descriptors SHALL declare stable identity and version, input/output schemas, data classes, read/write/destructive classification, side effects, idempotency, required authority, approval, timeout, rate and cost limits, and compensation support.

Calls SHALL contain run, step, Workspace, actor and policy identity; exact Tool version; validated arguments; purpose; deadline; idempotency key; authorization proof; and evidence requirements. Free-form provider commands SHALL not bypass the schema.

## 4. Result

Results SHALL distinguish success, denial, invalid input, not found, conflict, throttling, timeout, provider failure, partial effect, and unknown effect. They include normalized output, redacted provider evidence, timing, usage, and effect status.

## 5. Guarantees and Conformance

Adapters cannot widen authority or reinterpret domain verdicts. Secrets are referenced, never returned as output. Implementations SHALL pass schema, least privilege, injection, idempotency, timeout, partial effect, retry, cancellation, compensation, redaction, replay, and cross-Workspace tests.

## 6. Compatibility and Operations

Tool schemas and effect semantics SHALL be version-negotiated before a call. A breaking input, output, authority, idempotency, or effect change requires a major version and consumer migration. Automatic retry is permitted only for declared safe outcomes; `partial_effect` and `unknown_effect` require reconciliation or human decision. Every production Tool adapter SHALL have a deterministic fake or replay adapter passing the same authorization, effect, and failure contract tests.
