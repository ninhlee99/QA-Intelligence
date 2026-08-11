---
id: GOV-003
title: Engineering Decision Tree
version: 1.0.0
status: accepted
owner:
  - Architecture
  - Engineering Governance
depends_on:
  - SPEC-007
  - GOV-001
  - GOV-002
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-007
last_updated: 2026-07-31
---

# Engineering Decision Tree

## 1. Purpose

This document defines the canonical decision process for creating, modifying, reviewing, and implementing engineering artifacts within QA Intelligence.

It answers one fundamental question:

> **"Where does this change belong?"**

Every engineering change SHALL be classified before implementation begins.

This document prevents:

* duplicate artifacts
* misplaced responsibilities
* architectural drift
* undocumented decisions
* hidden business logic
* implementation-led architecture

It applies equally to:

* architects
* developers
* reviewers
* AI coding agents
* documentation generators

---

# 2. Engineering Philosophy

Every engineering task SHALL begin with classification.

Never ask:

> How should I implement this?

First ask:

> What kind of engineering problem is this?

Correct classification determines:

* artifact type
* repository location
* owner
* review process
* approval level
* dependency direction

Incorrect classification is considered an architectural defect.

---

# 3. Master Decision Tree

Every engineering request SHALL pass through the following tree.

```text
Engineering Request
        │
        ▼
Does it change architecture?
        │
 ┌──────┴──────┐
 │             │
Yes            No
 │             │
 ▼             ▼
Existing ADR?  Existing Spec?
 │             │
 │             │
 ▼             ▼
Update ADR     Update Spec
 │             │
 │             │
 └──────┬──────┘
        │
        ▼
Need New Artifact?
        │
 ┌──────┴──────┐
 │             │
Yes            No
 │             │
 ▼             ▼
Create         Modify Existing
Artifact        Artifact
```

Implementation SHALL begin only after the governing artifact exists or has been updated.

---

# 4. Decision Level 1 — Is It an Architectural Decision?

Ask:

* Does this change architectural boundaries?
* Does it introduce a new architectural pattern?
* Does it replace an existing architectural approach?
* Does it affect dependency direction?
* Does it change ownership?
* Does it introduce a new platform-wide concept?

If **YES**, create or update an ADR.

Examples:

✔ Plugin architecture

✔ Workspace isolation

✔ Knowledge Store

✔ Rule Engine

✔ Execution abstraction

Examples that are NOT ADRs:

✘ New validation rule

✘ New API endpoint

✘ New schema property

✘ New UI component

---

# 5. Decision Level 2 — Is It a Stable Specification?

Ask:

* Is this defining system behavior?
* Is this defining a contract?
* Is this defining a domain model?
* Is this defining a capability?
* Is this defining a lifecycle?
* Is this implementation-independent?

If YES

Create or update a Specification.

Examples:

* Knowledge Object
* Learning Engine
* Discovery
* Execution
* Workspace
* Plugin Interface

---

# 6. Decision Level 3 — Is It Semantic?

Ask:

Is the change about:

* meaning
* terminology
* entities
* relationships
* constraints
* taxonomy

If YES

Update:

```text
ontology/
```

Examples

Requirement

Business Rule

Validation Rule

Risk

Semantic UI

Knowledge Object

Relationship

---

# 7. Decision Level 4 — Is It Structural Data?

Ask:

Does it define:

* JSON
* YAML
* API payload
* persistence structure
* validation structure
* serialization format

If YES

Create or update

```text
schemas/
```

Examples

```text
knowledge-object.schema.json

rule.schema.json

execution.schema.json
```

---

# 8. Decision Level 5 — Is It Deterministic Logic?

Ask:

Does this define:

* business rule
* validation
* inference
* decision
* calculation
* deterministic behavior

If YES

Update

```text
rules/
```

Examples

Password validation

Email validation

Risk scoring

Priority calculation

Confidence calculation

Never hide deterministic logic inside prompts.

---

# 9. Decision Level 6 — Is It Reusable Knowledge?

Ask:

Does this information need to be remembered?

Will it improve future reasoning?

Is it reusable?

Does it have provenance?

Can it be versioned?

If YES

Create or update a Knowledge Object.

If NO

Treat it as temporary context.

Conversation SHALL NOT become knowledge.

---

# 10. Decision Level 7 — Is It Runtime Behavior?

Ask:

Does it affect:

* orchestration
* lifecycle
* scheduling
* execution
* monitoring
* recovery

If YES

Runtime Specification.

---

# 11. Decision Level 8 — Is It Component Design?

Ask:

Is this about one module?

Examples

Knowledge Repository

Execution Manager

Plugin Registry

Workspace Manager

If YES

Component Specification.

---

# 12. Decision Level 9 — Is It an Interface?

Ask:

Does it define communication?

Examples

REST

GraphQL

Plugin API

Events

DTO

Contracts

If YES

Interface Specification.

---

# 13. Decision Level 10 — Is It Only Implementation?

If none of the previous decisions apply

Then

Modify implementation only.

Implementation SHALL NOT introduce:

* architecture
* business rules
* ontology
* governance
* knowledge model

Implementation follows architecture.

---

# 14. Repository Decision Matrix

| Question                         | Artifact                   |
| -------------------------------- | -------------------------- |
| Why was this decision made?      | ADR                        |
| What does the platform do?       | Product Specification      |
| How is the platform organized?   | Architecture Specification |
| What does this component own?    | Component Specification    |
| What is the contract?            | Interface Specification    |
| What does this entity mean?      | Ontology                   |
| What does this object look like? | Schema                     |
| What deterministic logic exists? | Rule                       |
| What reusable knowledge exists?  | Knowledge Object           |
| How is it executed?              | Runtime Specification      |
| How is it coded?                 | Implementation             |

---

# 15. Artifact Selection Flow

```text
Need

↓

Architecture?

↓

ADR

↓

Capability?

↓

Specification

↓

Meaning?

↓

Ontology

↓

Structure?

↓

Schema

↓

Decision?

↓

Rule

↓

Reusable?

↓

Knowledge

↓

Execution?

↓

Runtime

↓

Implementation
```

---

# 16. Before Creating Any Artifact

Contributor SHALL answer:

1.

Does this already exist?

2.

Who owns it?

3.

Which layer?

4.

Which ADR?

5.

Which Specification?

6.

Which ontology entity?

7.

Which schema?

8.

Which rule?

9.

Will this duplicate another artifact?

If any answer is unknown

Search first.

---

# 17. Modification Decision Tree

Before modifying:

```text
Artifact

↓

Authoritative?

↓

Dependencies?

↓

Breaking Change?

↓

Impact Analysis?

↓

Review?

↓

Modify
```

Never modify accepted artifacts directly without review.

---

# 18. AI Decision Process

Before generating anything an AI agent SHALL execute:

```text
Read MANIFEST

↓

Read Reading Order

↓

Locate Artifact Owner

↓

Search Existing Artifact

↓

Determine Artifact Type

↓

Determine Layer

↓

Determine Dependencies

↓

Determine Review Requirements

↓

Generate Draft

↓

Validate

↓

Submit
```

---

# 19. Repository Escalation Rules

Escalate to Architecture Review when:

* new architectural layer
* new top-level directory
* dependency inversion
* breaking change
* conflicting specification
* duplicate ownership
* ontology conflict
* new governance policy
* repository restructuring

Implementation teams SHALL NOT approve these changes independently.

---

# 20. Common Anti-Patterns

## Architecture in Code

```text
Code

↓

Architecture
```

Invalid.

---

## Business Rules in Prompt

```text
Prompt

↓

Business Logic
```

Invalid.

---

## Schema Before Specification

```text
Schema

↓

Guess Specification
```

Invalid.

---

## Plugin Owns Business Logic

```text
Plugin

↓

Business Decision
```

Invalid.

---

## Duplicate Specification

```text
SPEC A

SPEC B

Same Responsibility
```

Invalid.

---

## New File Without Search

Create

↓

Search

Invalid.

Always search first.

---

# 21. Decision Priority

When multiple artifacts appear possible, precedence SHALL be:

```text
ADR

↓

Specification

↓

Ontology

↓

Schema

↓

Rule

↓

Knowledge

↓

Implementation
```

Choose the highest applicable layer.

---

# 22. AI Self-Check

Before finalizing a contribution, the AI SHALL verify:

```text
□ Correct artifact selected

□ Correct directory

□ Correct numbering

□ Correct owner

□ No duplication

□ No architectural conflict

□ No hidden business rule

□ Dependency direction preserved

□ Traceability preserved

□ Review required identified
```

---

# 23. Definition of Done

This decision process is complete when every engineering request can determine:

* whether an ADR is required
* whether a Specification is required
* whether Ontology should change
* whether Schema should change
* whether Rule should change
* whether Knowledge should change
* whether Runtime should change
* whether only implementation changes

without ambiguity.

---

# 24. Summary

Every engineering task SHALL follow this mindset:

```text
Understand

↓

Classify

↓

Locate Owner

↓

Locate Layer

↓

Locate Dependencies

↓

Modify Architecture

↓

Modify Specification

↓

Modify Implementation

↓

Validate

↓

Review

↓

Merge
```

The first responsibility of every engineer and AI agent is **not to write code**.

It is to classify the engineering problem correctly.

Correct classification is the foundation of maintainable architecture, consistent governance, and long-term evolution of QA Intelligence.
