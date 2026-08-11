---
id: ADR-001

title: Knowledge Store as the Single Source of Truth

status: accepted

version: 1.0.0

date: 2026-07-30

decision_owners:

- Architecture
- Knowledge Governance

related_specs:

- SPEC-002
- SPEC-003
- SPEC-004
- SPEC-006

related_adrs: []

supersedes: []

superseded_by: null
---

# Context

QA Intelligence requires reusable engineering knowledge across multiple executions, projects and AI models.

The platform must distinguish between temporary reasoning and validated engineering knowledge.

---

# Problem

Should the platform rely on conversation history, runtime memory, or a dedicated Knowledge Store?

---

# Decision

QA Intelligence adopts a structured Knowledge Store as the authoritative repository for validated engineering knowledge.

Conversation history is never treated as project knowledge.

---

# Alternatives Considered

## Alternative A

Conversation Memory

Rejected.

Reasons:

- unstructured
- difficult to validate
- model-dependent
- poor traceability

---

## Alternative B

Prompt Engineering

Rejected.

Reasons:

- hidden logic
- difficult to maintain
- duplicated reasoning

---

## Alternative C

Knowledge Store

Accepted.

Reasons:

- structured
- versioned
- traceable
- reusable
- deterministic

---

# Rationale

Engineering knowledge must outlive individual AI sessions and remain independent of any specific language model.

A structured repository provides:

- provenance
- versioning
- validation
- conflict management
- deterministic retrieval

---

# Trade-offs

Benefits:

- consistent behavior
- reusable knowledge
- easier governance

Costs:

- additional storage
- synchronization complexity
- validation workflow

---

# Consequences

Positive:

- stable architecture
- explainable outputs
- reusable intelligence

Negative:

- increased implementation complexity
- knowledge management overhead

---

# Implementation Impact

Modules affected:

- Knowledge Store
- Rule Engine
- Learning Engine
- Discovery Engine
- Workspace

---

# AI Guidance

Never treat conversation history as authoritative knowledge.

Before generating new business rules:

1. Query the Knowledge Store.
2. Check for conflicts.
3. Create a Knowledge Candidate if needed.
4. Request validation before persistence.

---

# References

- SPEC-002 Product Principles
- SPEC-003 Engineering Laws
- SPEC-004 AI Governance
- SPEC-006 System Landscape
