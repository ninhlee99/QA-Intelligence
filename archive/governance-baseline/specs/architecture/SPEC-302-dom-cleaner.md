---
id: SPEC-302
title: DOM Cleaner Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - UI Intelligence
depends_on:
  - SPEC-101
  - SPEC-201
  - SPEC-301
related_adrs:
  - ADR-003
  - ADR-004
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-302: DOM Cleaner Architecture

## 1. Purpose

The DOM Cleaner transforms authorized UI captures into a minimal, safe, deterministic structural representation suitable for semantic analysis.

## 2. Responsibilities

- remove scripts, styles, hidden noise, trackers, and unstable runtime data
- retain accessible names, roles, labels, hierarchy, state, and interaction hints
- redact sensitive values
- normalize identifiers without losing source traceability
- enforce size and complexity limits
- preserve references required for later adapter binding

The DOM Cleaner SHALL NOT infer product meaning or create canonical UI concepts.

## 3. Input Contract

Input SHALL include capture ID, URL classification, Workspace, actor role, environment, timestamp, raw content reference, redaction policy, and capture authorization.

## 4. Output Contract

Output SHALL include sanitized tree, retained attributes, redaction events, source-node mapping, capture metadata, cleaner version, warnings, and coverage.

## 5. Pipeline

```text
Validate Scope and Limits
↓
Parse Without Script Execution
↓
Remove Prohibited Content
↓
Redact Sensitive Values
↓
Normalize Stable Structure
↓
Retain Accessibility and Interaction Signals
↓
Validate and Emit
```

## 6. Security

Cleaning SHALL occur in an isolated parser. Active content SHALL never execute. Secrets, tokens, personal data, and unrestricted free text SHALL be removed or classified before persistence or AI use.

## 7. Determinism

Identical input, policy, and cleaner version SHOULD produce identical normalized output.

Lossy transformations SHALL be recorded.

## 8. Failure Behavior

Malformed input, excessive size, unsafe encoding, policy failure, unsupported content, and redaction uncertainty SHALL be explicit.

Unsafe content SHALL fail closed.

## 9. Quality Gates

Architecture passes when active content cannot execute, redaction tests pass, accessibility semantics remain, output is bounded, mapping is traceable, and Workspace isolation holds.

## 10. Operability and Compatibility

Configuration SHALL version maximum bytes, depth, nodes, attributes, text length, parse duration, retained semantics, redaction rules, and supported encodings. Limit breaches SHALL return bounded diagnostics without partial unsafe persistence. Metrics SHALL expose rejection reason, reduction ratio, redaction counts, semantic-retention checks, latency, and resource use. Cleaner upgrades SHALL be replayed against a versioned corpus and SHALL identify semantic mapping changes before rollout.

## 11. Summary

The DOM Cleaner creates safe structural evidence while leaving semantic interpretation to the Semantic Analyzer.
