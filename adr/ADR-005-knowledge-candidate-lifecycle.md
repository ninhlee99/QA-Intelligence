---
id: ADR-005
title: Knowledge Candidate Lifecycle
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Knowledge
  - Discovery
  - AI Governance
related_specs:
  - SPEC-004
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
supersedes: []
superseded_by: null
---

# ADR-005: Knowledge Candidate Lifecycle

## 1. Context

QA Intelligence continuously acquires information from multiple sources, including:

- application discovery
- requirement analysis
- user interactions
- execution results
- automation runs
- bug investigations
- API inspection
- documentation
- AI reasoning

Not all discovered information is authoritative.

Some observations are:

- incomplete
- ambiguous
- duplicated
- conflicting
- temporary
- inferred
- unverified

Persisting every observation directly into the Knowledge Store would reduce trust, introduce inconsistency, and weaken deterministic decision-making.

QA Intelligence therefore requires a controlled lifecycle that separates newly discovered information from validated knowledge.

---

## 2. Problem

Without a controlled lifecycle:

- incorrect AI inferences may become permanent knowledge
- duplicate knowledge accumulates
- conflicting business rules overwrite each other
- temporary instructions become persistent
- outdated information remains active
- knowledge provenance is lost
- confidence cannot be evaluated
- governance becomes impossible

The platform requires an intermediate state before information becomes authoritative.

---

## 3. Decision

Every newly discovered piece of information SHALL first become a **Knowledge Candidate**.

A Knowledge Candidate MUST pass validation and governance before becoming a Knowledge Object.

The lifecycle SHALL be:

```text
Observation
      ↓
Knowledge Candidate
      ↓
Classification
      ↓
Normalization
      ↓
Conflict Detection
      ↓
Confidence Evaluation
      ↓
Governance Validation
      ↓
Approval
      ↓
Knowledge Object
```

Knowledge Candidates are temporary.

Knowledge Objects are authoritative.

---

## 4. Decision Rules

### 4.1 Observation is not Knowledge

An observation SHALL NOT automatically become knowledge.

Examples:

- AI inference
- DOM discovery
- execution logs
- screenshots
- user conversations
- stack traces

These are evidence, not knowledge.

---

### 4.2 Candidate Creation

Every candidate SHALL include:

- unique identifier
- source
- timestamp
- evidence
- confidence
- scope
- category
- provenance

The original evidence MUST remain immutable.

---

### 4.3 Classification

Each candidate SHALL be classified before validation.

Examples:

- Business Rule
- Validation Rule
- Requirement
- API
- UI Component
- Locator
- Test Data
- Automation Rule
- Preference
- Known Issue

Classification determines the validation workflow.

---

### 4.4 Normalization

Candidates SHALL be normalized into canonical formats.

Normalization may include:

- terminology alignment
- identifier generation
- ontology mapping
- schema validation
- duplicate detection
- relationship extraction

Normalization SHALL NOT modify the original evidence.

---

### 4.5 Conflict Detection

Every candidate SHALL be compared against existing knowledge.

Possible outcomes include:

- new knowledge
- duplicate
- newer version
- conflicting information
- deprecated information

Conflicts MUST NOT be silently resolved.

---

### 4.6 Confidence Evaluation

Each candidate SHALL receive a confidence score.

Confidence SHOULD consider:

- source reliability
- evidence quality
- consistency with existing knowledge
- extraction accuracy
- ontology validation
- historical reliability

Confidence alone SHALL NOT authorize persistence.

---

### 4.7 Governance Validation

Governance rules SHALL determine whether a candidate may become authoritative knowledge.

Possible actions include:

- approve
- reject
- escalate
- request human review
- retain as candidate

Governance policies take precedence over confidence scores.

---

### 4.8 Approval

Only approved candidates SHALL become Knowledge Objects.

Knowledge Objects MUST receive:

- version
- lifecycle state
- ownership
- provenance
- effective date

---

### 4.9 Rejection

Rejected candidates SHALL remain traceable.

The system SHOULD preserve:

- rejection reason
- evidence
- reviewer
- timestamp

Rejected candidates SHALL NOT participate in deterministic reasoning.

---

### 4.10 Lifecycle States

Knowledge Candidates SHALL support at least:

- Draft
- Pending Validation
- Pending Review
- Approved
- Rejected
- Deprecated
- Archived

---

## 5. Rationale

### 5.1 Trustworthy Knowledge

Separating candidates from authoritative knowledge preserves the integrity of the Knowledge Store.

---

### 5.2 Safe Learning

AI can continuously learn without immediately changing system behavior.

---

### 5.3 Explainability

Every Knowledge Object can be traced back to:

- observation
- evidence
- validation
- approval

---

### 5.4 Incremental Improvement

Knowledge evolves through controlled validation rather than uncontrolled accumulation.

---

### 5.5 Governance

Approval workflows allow organizations to control which knowledge becomes authoritative.

---

## 6. Alternatives Considered

### 6.1 Direct Persistence

Persist every observation immediately.

Rejected because it creates unreliable knowledge.

---

### 6.2 Manual Knowledge Entry Only

Require humans to create all knowledge.

Rejected because it prevents scalable learning.

---

### 6.3 Confidence-only Persistence

Automatically persist high-confidence AI outputs.

Rejected because confidence is not equivalent to correctness.

---

### 6.4 Candidate Lifecycle

Accepted.

This approach balances continuous learning with governance.

---

## 7. Consequences

### Positive

- trustworthy knowledge
- safer learning
- better governance
- improved explainability
- duplicate prevention
- conflict visibility
- versioned knowledge evolution

### Negative

- additional processing
- validation workflows
- governance overhead
- temporary storage requirements

---

## 8. Risks and Mitigations

### Risk

Large numbers of pending candidates.

Mitigations:

- prioritization
- expiration policies
- automated validation
- review queues

---

### Risk

Incorrect approvals.

Mitigations:

- provenance
- version history
- rollback support
- audit logs

---

### Risk

Duplicate candidates.

Mitigations:

- normalization
- similarity detection
- ontology mapping
- stable identifiers

---

## 9. AI Guidance

### AI Coding Agents MUST

- create Knowledge Candidates instead of direct Knowledge Objects
- preserve original evidence
- separate inference from validated knowledge
- implement lifecycle state transitions
- support provenance and versioning

### AI Coding Agents MUST NOT

- bypass validation workflows
- overwrite existing knowledge
- discard conflicting evidence
- treat conversations as authoritative knowledge

### AI Runtime Agents MUST

- generate candidates from observations
- evaluate confidence
- invoke governance validation
- create Knowledge Objects only after approval
- retain traceability across lifecycle stages

---

## 10. Compliance

An implementation complies with this ADR when:

- observations become Knowledge Candidates first
- validation precedes persistence
- provenance is preserved
- conflicts are detected
- lifecycle states are implemented
- only approved knowledge participates in deterministic reasoning

Non-compliant example:

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

- ADR-001 defines the Knowledge Store as the authoritative source.
- ADR-002 requires deterministic knowledge before LLM reasoning.
- ADR-003 defines Semantic UI as the canonical UI representation.
- ADR-004 defines the UI Knowledge Graph as the canonical relationship model.
- ADR-006 will define Discovery Before Asking as one source of Knowledge Candidates.

---

## 12. Implementation Notes

Detailed implementation belongs to the Knowledge Layer.

Future specifications should define:

- Knowledge Candidate schema
- lifecycle state machine
- confidence model
- validation pipeline
- approval workflow
- provenance model
- versioning strategy
- retention policy
- audit logging
- conflict resolution process

This ADR establishes the lifecycle through which observations become authoritative knowledge while preserving governance, traceability, and explainability.
