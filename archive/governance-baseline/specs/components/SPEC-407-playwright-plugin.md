---
id: SPEC-407
title: Playwright Plugin Component
version: 1.0.0
status: accepted
owner:
  - Quality Engineering
depends_on:
  - SPEC-209
  - SPEC-210
  - SPEC-305
  - SPEC-404
  - SPEC-405
  - SPEC-503
  - SPEC-504
  - SPEC-506
related_adrs:
  - ADR-003
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-407: Playwright Plugin Component

## 1. Purpose

The Playwright Plugin adapts semantic browser execution contracts to Playwright without exposing Playwright as a core platform dependency.

## 2. Owns

- browser capability descriptor
- translation of semantic actions and assertions
- browser/session lifecycle
- selector binding from governed UI evidence
- provider-specific timeout and error mapping
- screenshots, traces, videos, and logs under evidence policy

It does not own test intent, Workspace policy, retry decisions, or result semantics.

## 3. Capabilities

- navigation and page state
- semantic locate and interact
- field input and selection
- accessibility inspection
- network and console evidence where authorized
- screenshot and trace capture
- multi-page and browser-context control

## 4. Security

Browser contexts SHALL be isolated per execution scope. Credentials SHALL use approved injection. Downloads, uploads, network access, and evidence SHALL be policy-controlled and Workspace-scoped.

## 5. Failure Mapping

Provider exceptions SHALL map to stable categories such as element unavailable, action rejected, assertion failed, navigation failed, timeout, browser crash, policy denial, and plugin error.

## 6. Verification

Contract certification SHALL cover semantic actions, evidence, cancellation, timeout, browser crash, cleanup, parallel isolation, redaction, and version compatibility.

## 7. Configuration and Operability

Supported browser, Playwright, SPEC-503, and SPEC-504 versions; action and evidence limits; network policy; download/upload policy; timeouts; and resource quotas SHALL be declared. Automatic retries are disabled unless the caller authorizes a stable retry class. Metrics SHALL expose action latency, assertion outcome, navigation failure, crash, timeout, cancellation, evidence/redaction, cleanup, and resource use without logging credentials or protected page content. A deterministic semantic-action fake/replay adapter SHALL share the conformance suite.

## 8. Definition of Done

The plugin can be replaced by another compliant browser engine without changing approved TestCases or core execution semantics.
