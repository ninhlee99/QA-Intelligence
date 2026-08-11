---
id: SPEC-409
title: Git Plugin Component
version: 1.0.0
status: accepted
owner:
  - Platform Engineering
depends_on:
  - SPEC-305
  - SPEC-405
  - SPEC-503
  - SPEC-506
related_adrs:
  - ADR-006
  - ADR-007
  - ADR-008
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/COMPONENT_REVIEW.yaml
---

# SPEC-409: Git Plugin Component

## 1. Purpose

The Git Plugin adapts governed repository-discovery and change-inspection contracts to Git without exposing Git-specific commands or object models to the Core Platform.

## 2. Responsibilities

- describe supported repository capabilities
- read authorized refs, trees, blobs, diffs, and history
- report repository identity and revision provenance
- map provider failures to stable platform errors
- enforce path, operation, credential, and Workspace boundaries
- produce evidence references suitable for Discovery and review

The plugin SHALL NOT own repository governance, approve changes, execute destructive Git operations by default, or persist repository content as authoritative knowledge.

## 3. Initial Capabilities

- repository metadata inspection
- exact-revision file retrieval
- path and content search
- diff inspection
- bounded history traversal
- changed-file enumeration
- integrity verification

Write, commit, push, branch deletion, history rewriting, and remote mutation are excluded from the initial capability set.

## 4. Security

- credentials SHALL be least-privileged and injected through approved secret references
- path traversal and unsafe symbolic-link behavior SHALL be rejected
- repository content SHALL be treated as untrusted evidence
- access SHALL remain bound to the authorized repository and Workspace
- sensitive file policy SHALL apply before content reaches AI context

## 5. Failure Contract

Unknown revision, unavailable repository, authentication failure, authorization denial, unsupported object, excessive history, unsafe content, and plugin failure SHALL remain distinct.

## 6. Verification

Contract certification SHALL cover exact revision retrieval, large repositories, malformed objects, unsafe paths, credential redaction, cancellation, timeout, and cross-Workspace denial.

## 7. Acceptance Criteria

- the plugin conforms to SPEC-503
- provider-specific types remain inside the adapter
- every result identifies repository and revision provenance
- default behavior is read-only
- no repository observation becomes knowledge without the Candidate lifecycle

## 8. Initial Implementation Baseline and Operability

The initial adapter SHALL use read-only standard Git capabilities against an explicitly authorized local checkout or remote reference. Hosting-provider APIs and write/mutation capabilities are excluded until separately specified, threat-modeled, and approved; their absence does not block the read-only component. History depth, object size, file count, content bytes, timeout, network, cache, and sensitive-path limits SHALL be configured and evidenced. Caches are keyed by Workspace, repository identity, exact revision, policy, and plugin version. Metrics SHALL expose retrieval/search latency, bounded-limit rejection, authentication/authorization denial, unsafe content, cancellation, and cache behavior without retaining credentials or unrestricted repository content.

No unresolved implementation decision blocks the accepted read-only capability.
