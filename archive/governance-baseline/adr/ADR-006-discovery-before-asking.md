---
id: ADR-006
title: Discovery Before Asking
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Discovery
  - AI Governance
related_specs:
  - SPEC-002
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
supersedes: []
superseded_by: null
---

# ADR-006: Discovery Before Asking

## 1. Context

QA Intelligence is designed to behave as an AI QA Engineer rather than a conversational assistant.

A human QA engineer does not immediately ask another engineer every question.

Instead, they first attempt to understand the system by examining available evidence.

Examples include:

- application interfaces
- API specifications
- existing documentation
- requirement documents
- previous knowledge
- execution history
- source code
- configuration
- automation assets

Only after exhausting available evidence do they request additional information.

QA Intelligence SHALL follow the same principle.

---

## 2. Problem

Traditional LLM-based assistants often rely on user interaction as the primary source of information.

This leads to:

- unnecessary questions
- interrupted workflows
- duplicated information
- poor user experience
- inconsistent reasoning
- failure to reuse existing knowledge
- increased token usage

A QA platform should maximize autonomous discovery before involving the user.

---

## 3. Decision

QA Intelligence SHALL attempt discovery before requesting information from a user.

The default workflow SHALL be:

```text
Task
    ↓
Knowledge Retrieval
    ↓
Discovery
    ↓
Rule Evaluation
    ↓
Sufficient Evidence?
      │
      ├── Yes
      │      ↓
      │   Continue
      │
      └── No
             ↓
     Ask User
```

User interaction SHALL be treated as the final source of missing information rather than the first.

---

## 4. Decision Rules

### 4.1 Knowledge First

The system SHALL retrieve existing Knowledge Objects before performing any discovery.

Previously validated knowledge has higher authority than newly discovered evidence.

---

### 4.2 Discovery Sources

Discovery MAY use:

- Semantic UI
- UI Knowledge Graph
- APIs
- Requirements
- Documentation
- Existing test assets
- Configuration
- Automation scripts
- Execution history
- Repository metadata

Additional discovery sources may be added without changing this ADR.

---

### 4.3 Evidence Collection

Discovery SHALL collect evidence from multiple sources whenever possible.

Evidence SHALL include provenance.

Multiple independent sources SHOULD increase confidence.

---

### 4.4 Progressive Discovery

Discovery SHOULD proceed incrementally.

Example:

1. Knowledge Store
2. Semantic UI
3. UI Knowledge Graph
4. Requirements
5. APIs
6. Documentation
7. Automation
8. Execution history
9. User

Each step should reduce uncertainty before moving to the next.

---

### 4.5 Asking Criteria

The system SHALL ask the user only when:

- required information does not exist
- conflicting evidence cannot be resolved
- governance requires human approval
- business intent cannot be inferred safely
- confidence is below the defined threshold

---

### 4.6 Minimal Questions

When user interaction is required:

- ask the minimum number of questions
- ask only unresolved questions
- avoid requesting information already available
- preserve previous answers as evidence

---

### 4.7 Discovery Output

Discovery SHALL produce:

- observations
- evidence
- confidence
- discovered relationships
- Knowledge Candidates when applicable

Discovery SHALL NOT create authoritative knowledge directly.

---

### 4.8 Repeatability

Discovery SHOULD produce consistent results when executed against identical evidence.

Non-deterministic techniques SHOULD record confidence and provenance.

---

### 4.9 Failure Handling

Discovery failures SHALL NOT immediately trigger user interaction.

The system SHOULD:

- retry alternative discovery methods
- inspect additional evidence
- reduce scope
- escalate only when necessary

---

### 4.10 User Answers

User responses SHALL become evidence.

User responses MAY generate Knowledge Candidates.

User responses SHALL NOT automatically become authoritative Knowledge Objects.

---

## 5. Rationale

### 5.1 Better User Experience

Users should answer only questions that cannot be resolved automatically.

---

### 5.2 Higher Knowledge Reuse

Existing knowledge should be reused before collecting new information.

---

### 5.3 Lower Operational Cost

Discovery often avoids unnecessary LLM interactions and repeated user conversations.

---

### 5.4 Consistency

Discovery produces repeatable evidence that can be audited.

---

### 5.5 Continuous Learning

Every discovery operation contributes additional observations and potential Knowledge Candidates.

---

## 6. Alternatives Considered

### 6.1 Ask User First

Rejected because it interrupts workflows and ignores existing knowledge.

---

### 6.2 LLM Guessing

Rejected because unsupported inference may introduce incorrect business knowledge.

---

### 6.3 Discovery Before Asking

Accepted.

The platform maximizes autonomous understanding before requesting user input.

---

## 7. Consequences

### Positive

- fewer interruptions
- better knowledge reuse
- improved automation
- higher reasoning quality
- lower operating cost
- better user experience

### Negative

- discovery pipeline becomes more complex
- additional discovery processing time
- dependency on multiple evidence sources

---

## 8. Risks and Mitigations

### Risk

Discovery misses relevant evidence.

Mitigations:

- multiple discovery strategies
- confidence evaluation
- provenance tracking
- fallback mechanisms

---

### Risk

Discovery becomes expensive.

Mitigations:

- caching
- incremental discovery
- scoped search
- reusable Knowledge Objects

---

### Risk

Incorrect inference during discovery.

Mitigations:

- evidence preservation
- confidence thresholds
- Knowledge Candidate lifecycle
- governance validation

---

## 9. AI Guidance

### AI Coding Agents MUST

- retrieve existing knowledge before discovery
- implement incremental discovery pipelines
- preserve evidence and provenance
- generate Knowledge Candidates instead of Knowledge Objects

### AI Coding Agents MUST NOT

- ask users before attempting discovery
- discard discovery evidence
- bypass governance validation
- infer authoritative business rules without evidence

### AI Runtime Agents MUST

- attempt discovery automatically
- minimize user interaction
- record confidence
- preserve discovery provenance
- escalate only when required

---

## 10. Compliance

An implementation complies with this ADR when:

- discovery precedes user interaction
- existing knowledge is reused
- evidence is preserved
- user questions are minimized
- discovery outputs create Knowledge Candidates rather than Knowledge Objects

Non-compliant workflow:

```text
Task
    ↓
Ask User
```

Compliant workflow:

```text
Task
    ↓
Knowledge Retrieval
    ↓
Discovery
    ↓
Evidence
    ↓
Knowledge Candidate
    ↓
Ask User (only if required)
```

---

## 11. Related Decisions

- ADR-001 defines authoritative knowledge storage.
- ADR-002 defines deterministic decision precedence.
- ADR-003 defines Semantic UI.
- ADR-004 defines the UI Knowledge Graph.
- ADR-005 defines the Knowledge Candidate lifecycle.
- ADR-007 will define the Plugin as Adapter architecture.

---

## 12. Implementation Notes

Future specifications should define:

- discovery pipeline
- discovery adapters
- evidence model
- confidence calculation
- retry strategy
- caching
- provenance recording
- orchestration workflow

This ADR establishes discovery as the default mechanism for acquiring knowledge before requesting information from users.
