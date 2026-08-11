---
id: ADR-014
title: OIDC Identity and Internal Authorization
status: accepted
version: 1.0.0
date: 2026-08-03
decision_owners:
  - Security
  - Architecture
  - Workspace Governance
related_specs:
  - SPEC-306
  - SPEC-309
  - SPEC-406
  - SPEC-506
  - SPEC-508
  - SPEC-606
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-011
  - ADR-013
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/OWNER_APPROVAL.yaml
---

# ADR-014: OIDC Identity and Internal Authorization

## 1. Context

QA Intelligence must authenticate people and workloads while preserving provider independence, Workspace isolation, approval separation, and least-privilege Agent Tool authority. Authentication claims alone cannot own domain authorization.

## 2. Decision

- Use OpenID Connect Authorization Code Flow with PKCE for interactive authentication.
- Use an approved OAuth workload flow and short-lived credentials for machine identities.
- Validate issuer, audience, signature, expiry, nonce or replay protections, and required assurance before accepting identity.
- Resolve internal actor, Workspace membership, roles, policy, and resource permissions from governed platform state.
- Calculate effective Agent authority as the intersection defined by SPEC-106; prompts and external identity claims cannot widen it.
- Keep the identity provider behind a seam with a production OIDC adapter and deterministic signed-claims test adapter.

No vendor-specific role or group claim is authoritative until an explicit adapter mapping is validated and versioned.

## 3. Authorization and Audit

Every command, approval, Tool call, evidence access, and cross-scope denial records actor, workload delegation if any, Workspace, policy version, decision, reason, and correlation identity. High-consequence approvals require separation of duties and fresh authorization.

## 4. Failure Behavior

Unknown issuer, invalid or expired token, ambiguous mapping, suspended membership, stale high-risk authorization, missing Workspace, or unavailable policy evaluation fails closed. Identity provider outage does not permit cached privilege expansion.

## 5. Consequences

Organizations may select any conformant provider through the adapter. Internal authorization remains stable across provider changes. The platform must operate key rotation, session revocation, token redaction, test keys, and time-skew handling.

## 5.1 Alternatives Considered

- **Provider-specific group claims as authorization** was rejected because external claim structure would become product policy and could silently widen Workspace access.
- **Locally implemented authentication** was rejected because credential security, federation, assurance, and lifecycle would become unnecessary platform responsibilities.
- **Authentication without internal policy evaluation** was rejected because identity alone cannot authorize Agent Tools, approvals, resource scope, or delegated work.

## 6. Validation

- OIDC discovery, signature, key rotation, issuer, audience, nonce, expiry and PKCE tests
- claim injection, group-mapping, confused-deputy, replay, privilege escalation and cross-Workspace tests
- production and deterministic identity adapters pass the same interface suite
- secrets and raw tokens never enter logs, knowledge, fixtures, or evidence

## 7. Reference

- https://openid.net/specs/openid-connect-core-1_0-final.html
