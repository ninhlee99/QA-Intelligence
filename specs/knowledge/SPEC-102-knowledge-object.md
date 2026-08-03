---
id: SPEC-102
title: Knowledge Object
version: 1.0.0
status: accepted
owner:
  - Knowledge Governance
depends_on:
  - SPEC-101
  - GOV-005
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-005
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-102: Knowledge Object

## 1. Purpose

This specification defines the canonical Knowledge Object and Knowledge Candidate contracts.

A Knowledge Object is an approved, versioned, traceable unit of reusable knowledge.

A Knowledge Candidate is a non-authoritative proposal awaiting validation and promotion.

## 2. Goals

- make reusable knowledge explicit and machine-readable
- preserve claim-level provenance
- separate authority from confidence
- govern creation, revision, promotion, conflict, and retirement
- enforce Workspace isolation
- support retrieval without losing source context
- prevent observations and AI output from silently becoming truth

## 3. Non-Goals

This specification does not define storage technology, retrieval ranking, product workflows, or provider-specific embeddings.

## 4. Knowledge Object Model

Every Knowledge Object SHALL contain:

```yaml
id: KNOWLEDGE-ID
type: CANONICAL-TYPE
version: SEMANTIC-VERSION
status: draft | in_review | accepted | deprecated | superseded | archived
workspace_id: WORKSPACE-ID-OR-GLOBAL
title: TEXT
summary: TEXT
claims: []
provenance: []
authority: AUTHORITY-CLASS
confidence: 0.0-1.0
owner: OWNER-ID
applicability: {}
relationships: []
valid_from: TIMESTAMP
valid_until: TIMESTAMP-OR-NULL
reviewed_at: TIMESTAMP
```

## 5. Claim Model

Knowledge SHALL be decomposed into reviewable claims when multiple statements have different sources or applicability.

Each claim SHALL include:

- stable claim identity
- normalized statement
- source references
- supporting evidence
- applicability conditions
- confidence
- validation status
- contradiction references

Confidence SHALL NOT grant authority.

## 6. Provenance Model

Provenance SHALL identify:

- source type and identity
- source version or capture time
- acquisition actor and method
- transformation history
- Workspace scope
- integrity information
- AI generation metadata where applicable

Unavailable provenance SHALL prevent promotion to accepted status.

## 7. Applicability

Applicability MAY constrain knowledge by:

- Workspace
- product or capability
- environment
- user role
- jurisdiction
- version range
- time period
- feature state
- provider or integration

Retrieval SHALL preserve and evaluate applicability conditions.

## 8. Candidate Model

A Knowledge Candidate SHALL include:

- candidate identity
- proposed claims
- discovery source
- rationale
- supporting and contradicting evidence
- confidence and uncertainty
- affected knowledge
- validation plan
- owner
- expiration

Candidates SHALL be excluded from authoritative retrieval unless the consumer explicitly requests candidate material.

## 9. Lifecycle

### Knowledge Object

```text
draft → in_review → accepted → deprecated → superseded | archived
```

### Knowledge Candidate

```text
discovered → proposed → validating → promoted | rejected | expired
```

Every transition SHALL record actor, reason, evidence, and policy version.

## 10. Promotion

Promotion SHALL require QG-08 and verify:

- adequate provenance
- authoritative or sufficiently corroborated sources
- semantic alignment with SPEC-101
- conflict resolution
- explicit applicability
- Workspace safety
- owner and review schedule
- downstream impact
- Knowledge Governance approval

Promotion SHALL create or revise a Knowledge Object; it SHALL NOT mutate the candidate into unversioned authority.

## 11. Revision and Immutability

Accepted versions SHALL be immutable.

Changes SHALL create a new version linked by `supersedes` or revision history.

Historical executions SHALL continue referencing the exact version used.

## 12. Conflict Handling

Conflicting claims SHALL NOT be merged into an artificial consensus.

The platform SHALL:

1. retain both claims and provenance
2. identify the contradiction
3. evaluate authority and applicability
4. route to the accountable owner
5. record the resolution or bounded coexistence

## 13. Workspace Isolation

- Workspace knowledge SHALL carry `workspace_id`
- global knowledge SHALL use an explicit global scope
- retrieval SHALL require Workspace context
- caches and indexes SHALL preserve scope
- promotion SHALL NOT move Workspace knowledge to global scope implicitly
- cross-Workspace aggregation requires governed anonymization and approval

## 14. Retrieval Contract

Every returned object SHALL preserve:

- identity and version
- status and authority
- relevant claims
- sources and provenance
- applicability
- Workspace scope
- confidence and uncertainty
- retrieval explanation

Summaries SHALL link to exact source objects.

## 15. Validation

Validation SHALL check:

- schema conformity
- canonical types
- unique identity and version
- provenance completeness
- status transition legality
- claim-source traceability
- applicability consistency
- Workspace isolation
- expiration and review dates
- relationship validity

## 16. Security and Privacy

Sensitive knowledge SHALL be classified and access-controlled.

Evidence and summaries SHALL avoid exposing secrets or personal data beyond authorized purpose.

Deletion and retention obligations SHALL preserve necessary audit references without retaining prohibited content.

## 17. Quality Gates

A Knowledge Object passes when:

- its meaning aligns with SPEC-101
- every material claim is supported
- authority and confidence are separate
- applicability is explicit
- lifecycle and ownership are valid
- Workspace and privacy controls pass
- conflict and impact analysis are complete

## 18. Definition of Done

- canonical schema exists
- lifecycle transitions are enforceable
- accepted versions are immutable
- candidate promotion uses QG-08
- retrieval preserves provenance and scope
- positive, negative, conflict, expiry, and isolation tests pass

## 19. Summary

Knowledge Objects are governed evidence-bearing units, not free-form notes.

Candidates enable learning without weakening authority.
