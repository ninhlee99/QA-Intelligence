---
id: ADR-010
title: Controlled Learning
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Knowledge
  - AI Governance
related_specs:
  - SPEC-004
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
supersedes: []
superseded_by: null
---

# ADR-010: Controlled Learning

## 1. Context

QA Intelligence continuously produces new observations during:

- discovery
- requirement analysis
- business analysis
- execution
- automation
- defect investigation
- user interaction
- document analysis

These observations provide opportunities to improve future reasoning.

However, not every observation should become permanent knowledge.

The platform requires a governed learning process that preserves knowledge quality while enabling continuous improvement.

---

## 2. Problem

Uncontrolled learning introduces significant risks.

Examples include:

- incorrect business rules becoming permanent
- duplicated knowledge
- contradictory knowledge
- hallucinated AI conclusions
- temporary instructions becoming persistent
- knowledge drift
- loss of explainability
- unpredictable platform behavior

Learning must therefore be governed rather than automatic.

---

## 3. Decision

QA Intelligence SHALL implement Controlled Learning.

Learning SHALL be treated as a governed lifecycle rather than an automatic persistence mechanism.

The learning workflow SHALL be:

```text
Observation
      ↓
Knowledge Candidate
      ↓
Classification
      ↓
Validation
      ↓
Governance
      ↓
Approval
      ↓
Knowledge Object
      ↓
Future Reasoning
```

Only approved knowledge SHALL influence deterministic reasoning.

---

## 4. Decision Rules

### 4.1 Observation-driven Learning

Learning SHALL begin with observations.

Sources MAY include:

- discovery
- execution
- requirements
- documentation
- user input
- bug analysis
- automation
- runtime telemetry

---

### 4.2 Candidate-first Learning

Every learned item SHALL first become a Knowledge Candidate.

Direct persistence into the Knowledge Store is prohibited.

---

### 4.3 Human Validation

Knowledge that influences business behavior SHOULD require human validation unless organizational governance explicitly allows automatic approval.

Examples include:

- business rules
- regulatory requirements
- validation logic
- acceptance criteria

---

### 4.4 Automatic Learning

The platform MAY automatically approve low-risk knowledge when governance policies permit.

Examples include:

- stable UI locators
- metadata
- execution metrics
- environment characteristics
- reusable technical observations

Automatic approval SHALL remain auditable.

---

### 4.5 Learning Scope

Learned knowledge SHALL include an explicit scope.

Examples:

```text
Global
Organization
Project
Feature
Screen
Session
```

Knowledge SHALL NOT expand beyond its approved scope.

---

### 4.6 Versioning

Every approved Knowledge Object SHALL be versioned.

Previous versions SHALL remain traceable.

Updates SHALL NOT overwrite historical knowledge without version history.

---

### 4.7 Provenance

Every learned Knowledge Object SHALL preserve provenance.

Minimum provenance includes:

- source
- evidence
- approval method
- approver (if applicable)
- timestamp
- originating Workspace

---

### 4.8 Conflict Management

Learning SHALL detect conflicts before approval.

Conflicting knowledge MUST NOT silently replace existing knowledge.

Conflict resolution SHALL follow governance policies.

---

### 4.9 Explainability

The platform SHALL explain why knowledge was learned.

The explanation SHOULD identify:

- originating observation
- supporting evidence
- confidence
- approval path
- resulting Knowledge Object

---

### 4.10 Revocation

Previously approved knowledge SHALL support revocation.

Revoked knowledge SHALL:

- remain auditable
- retain version history
- stop influencing deterministic reasoning

Deletion is not a substitute for revocation.

---

## 5. Rationale

### 5.1 Trustworthy Knowledge

Governed learning maintains confidence in the Knowledge Store.

---

### 5.2 Safe Evolution

The platform improves continuously without sacrificing reliability.

---

### 5.3 Explainability

Every learned fact can be traced from observation to approval.

---

### 5.4 Governance

Organizations remain in control of what becomes authoritative knowledge.

---

### 5.5 Continuous Improvement

Validated learning enables long-term quality improvement across projects.

---

## 6. Alternatives Considered

### 6.1 Automatic Persistence

Rejected because it risks polluting the Knowledge Store.

---

### 6.2 Manual Learning Only

Rejected because it limits scalability and slows improvement.

---

### 6.3 Controlled Learning

Accepted.

Balances continuous learning with governance, traceability, and trust.

---

## 7. Consequences

### Positive

- trustworthy learning
- governed knowledge evolution
- explainable decisions
- reduced knowledge drift
- safer automation
- continuous improvement

### Negative

- approval workflows
- governance overhead
- additional storage
- lifecycle management complexity

---

## 8. Risks and Mitigations

### Risk

Learning backlog grows.

Mitigations:

- prioritization
- automated validation
- expiration policies
- review queues

---

### Risk

Incorrect approvals.

Mitigations:

- provenance
- version history
- revocation
- audit logs

---

### Risk

Knowledge drift over time.

Mitigations:

- periodic review
- version comparison
- usage analytics
- governance policies

---

## 9. AI Guidance

### AI Coding Agents MUST

- create Knowledge Candidates before persistence
- preserve provenance and evidence
- implement versioning and revocation
- follow governance workflows

### AI Coding Agents MUST NOT

- persist observations directly
- overwrite existing Knowledge Objects
- bypass approval policies
- discard historical knowledge

### AI Runtime Agents MUST

- generate observations
- submit Knowledge Candidates
- invoke governance validation
- use only approved Knowledge Objects during deterministic reasoning

---

## 10. Compliance

An implementation complies with this ADR when:

- learning begins with observations
- Knowledge Candidates precede persistence
- approved knowledge is versioned
- provenance is preserved
- revoked knowledge no longer influences deterministic reasoning
- governance policies control learning behavior

Non-compliant workflow:

```text
Observation
      ↓
Knowledge Store
```

Compliant workflow:

```text
Observation
      ↓
Knowledge Candidate
      ↓
Validation
      ↓
Approval
      ↓
Knowledge Object
```

---

## 11. Related Decisions

- ADR-001 establishes the Knowledge Store as the authoritative source.
- ADR-002 defines deterministic reasoning precedence.
- ADR-003 defines Semantic UI.
- ADR-004 defines the UI Knowledge Graph.
- ADR-005 defines the Knowledge Candidate lifecycle.
- ADR-006 defines Discovery Before Asking.
- ADR-007 defines Plugin as Adapter.
- ADR-008 defines Workspace Isolation.
- ADR-009 defines the Execution Engine abstraction.

---

## 12. Implementation Notes

Future specifications should define:

- Learning Engine
- approval workflows
- governance policies
- version management
- revocation model
- provenance schema
- confidence model
- audit logging
- review queues
- learning analytics

This ADR establishes Controlled Learning as the governed mechanism through which observations evolve into authoritative knowledge while preserving trust, explainability, and long-term system quality.
