# Architecture Decision Records (ADR)

## Purpose

This directory documents the architectural decisions that define QA Intelligence.

Each ADR explains not only *what* decision was made, but *why* it was made, which alternatives were considered, and how the decision should influence future development.

These records are intended for both human engineers and AI Coding Agents.

---

## Why ADRs?

Engineering Specifications define the architecture.

ADRs explain the reasoning behind the architecture.

Without ADRs:

- future contributors may reverse important decisions
- AI may optimize away critical constraints
- architectural consistency may degrade over time

---

## Relationship

Vision

↓

Engineering Laws

↓

Product Principles

↓

Architecture Specifications

↓

Architecture Decision Records

↓

Implementation

---

## ADR Lifecycle

Proposed

↓

Accepted

↓

Implemented

↓

Superseded (optional)

↓

Deprecated (optional)

Historical ADRs are never deleted.

---

## ADR Template

Every ADR should follow the standard structure.

```
Metadata

Context

Problem

Decision

Alternatives

Rationale

Trade-offs

Consequences

Implementation Impact

AI Guidance

References
```

---

## Naming Convention

ADR-001-title.md

ADR-002-title.md

...

Numbers are immutable.

Titles may evolve.

---

## Governance

Engineering Specifications are normative.

ADRs are explanatory.

If an ADR conflicts with a Specification, the Specification takes precedence.

When that happens, the ADR should be updated rather than ignored.

---

## AI Guidance

AI Coding Agents should consult relevant ADRs before making architectural changes.

If a proposed implementation contradicts an accepted ADR, the AI should:

1. Flag the conflict.
2. Explain the impact.
3. Recommend updating the ADR or the Specification before proceeding.

AI must never silently bypass an accepted architectural decision.
