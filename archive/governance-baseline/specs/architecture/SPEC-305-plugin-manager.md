---
id: SPEC-305
title: Plugin Manager Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Platform Engineering
depends_on:
  - SPEC-103
  - SPEC-104
  - SPEC-209
  - SPEC-210
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-305: Plugin Manager Architecture

## 1. Purpose

The Plugin Manager discovers, validates, authorizes, activates, invokes, observes, and retires provider adapters without allowing them to own core policy.

This specification owns plugin collaboration architecture. SPEC-503 owns the plugin protocol and SPEC-405 owns registry implementation responsibility.

## 2. Responsibilities

- maintain plugin descriptors and lifecycle
- validate interface compatibility
- resolve capabilities
- enforce permissions and Workspace policy
- isolate invocation and failure
- route through stable contracts
- collect provider-neutral evidence

## 3. Plugin Descriptor

A descriptor SHALL identify plugin ID, version, implemented interfaces, capabilities, configuration schema, permissions, supported environments, compatibility, health contract, owner, and integrity information.

## 4. Lifecycle

```text
discovered → validated → installed → enabled → disabled → retired
```

Installation SHALL NOT imply enablement or authorization.

## 5. Capability Resolution

Selection SHALL be based on required interface version, declared capability, policy, environment, health, and explicit configuration.

Plugins SHALL NOT be selected from unverified model preference.

## 6. Isolation

Plugins SHALL receive least-privileged, time-bounded context and SHALL not access other Workspaces, core persistence, or unrelated credentials.

## 7. Failure Behavior

Plugin timeout, incompatibility, unavailable provider, invalid response, permission denial, and internal platform failure SHALL remain distinguishable.

## 8. Quality Gates

Architecture passes when contract certification, permission enforcement, integrity validation, failure isolation, provider substitution, and retirement behavior pass.

## 9. Compatibility and Operability

Plugin enablement SHALL be pinned to exact descriptor and interface versions. Upgrade, downgrade, disable, quarantine, and rollback SHALL preserve active-operation evidence and reject incompatible bindings before invocation. Configuration changes SHALL be schema-validated, authorized, versioned, and auditable; secret values remain references. Metrics SHALL expose resolution decisions, health, invocation failure classes, timeout, cancellation, quarantine, compatibility rejection, and usage by Workspace and plugin without leaking payloads.

## 10. Summary

The Plugin Manager makes providers replaceable while core semantics and authority remain stable.
