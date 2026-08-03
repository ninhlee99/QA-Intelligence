---
id: GOV-002
title: Repository Reading Order
version: 1.1.0
status: accepted
owner:
  - Engineering Governance
  - Architecture
depends_on:
  - SPEC-007
  - GOV-001
related_adrs: []
last_updated: 2026-08-03
---

# Repository Reading Order

## 1. Purpose

This document defines the canonical reading order for the QA Intelligence Engineering Knowledge Base.

Its objectives are to:

* provide a consistent learning path
* ensure architectural dependencies are respected
* prevent implementation from preceding design
* help AI agents construct the correct mental model
* reduce unnecessary repository traversal
* establish a common onboarding process for contributors

This document applies equally to human engineers and AI agents.

---

# 2. Reading Philosophy

The repository SHALL be read from stable concepts toward changeable implementation.

The recommended direction is:

```text
Why
    ↓
What
    ↓
How
    ↓
Implementation
```

Not:

```text
Code
    ↓
Guess Architecture
```

Architecture is learned from governance and specifications, not inferred from implementation.

---

# 3. Reading Principles

The reader SHALL always attempt to answer the following questions in order:

1. Why does the system exist?
2. What principles govern it?
3. What architectural decisions have been made?
4. What concepts exist?
5. What capabilities exist?
6. How is the system structured?
7. Which component owns this responsibility?
8. Which interfaces define the contract?
9. How does runtime execute?
10. How is it implemented?

Skipping earlier layers increases the risk of architectural inconsistency.

---

# 4. Canonical Reading Order

## Stage 1 — Foundation

Read first.

Purpose:

Understand the immutable principles of QA Intelligence.

Recommended order:

```text
SPEC-001 Vision

↓

SPEC-002 Product Principles

↓

SPEC-003 Engineering Laws

↓

SPEC-004 AI Governance

↓

SPEC-005 Canonical Glossary

↓

SPEC-006 System Landscape

↓

SPEC-007 Repository Governance
```

Outcome:

The reader understands:

* why the system exists
* architectural philosophy
* terminology
* governance
* repository rules

---

## Stage 2 — Governance

Purpose:

Understand how engineering decisions are reviewed and managed.

Recommended order:

```text
ARCHITECTURE_PRINCIPLES.md

↓

READING_ORDER.md

↓

DECISION_TREE.md

↓

DEPENDENCY_MATRIX.md

↓

OWNERSHIP_MATRIX.md

↓

TRACEABILITY_MATRIX.md

↓

CHANGE_IMPACT_MATRIX.md

↓

REVIEW_CHECKLIST.md

↓

QUALITY_GATES.md

↓

ENGINEERING_MATURITY_MODEL.md

↓

AGENT_SKILL_QUALITY_GATES.md when the change involves an Agent or Skill
```

Outcome:

The reader understands:

* architecture constraints
* dependency rules
* ownership
* review process
* quality expectations

---

## Stage 3 — Architecture Decisions

Purpose:

Understand why major architectural decisions were made.

Recommended order:

```text
ADR-001 Knowledge Store

↓

ADR-002 Rule Engine Before LLM

↓

ADR-003 Semantic UI Instead of Raw DOM

↓

ADR-004 UI Knowledge Graph

↓

ADR-005 Knowledge Candidate Lifecycle

↓

ADR-006 Discovery Before Asking

↓

ADR-007 Plugin as Adapter

↓

ADR-008 Workspace Isolation

↓

ADR-009 Execution Engine Abstraction

↓

ADR-010 Controlled Learning

↓

ADR-011–015 Accepted Implementation Baseline and Initial Tracer Bullet
```

Outcome:

The reader understands the architectural decisions that constrain every downstream specification and implementation.

---

## Stage 4 — Knowledge Layer

Purpose:

Understand the semantic model of the platform.

Recommended order:

```text
SPEC-101 Ontology

↓

SPEC-102 Knowledge Object

↓

SPEC-103 Knowledge Store

↓

SPEC-104 Rule Engine

↓

SPEC-105 Learning Engine

↓

SPEC-106 Agent and Skill Knowledge Model

↓

SPEC-107 Agent and Skill Evaluation Model
```

Outcome:

The reader understands:

* ontology
* knowledge lifecycle
* rule execution
* learning
* governed Agent, Skill, Tool, Prompt, and Evaluation artifacts
* governance

---

## Stage 5 — Product Layer

Purpose:

Understand the business capabilities of QA Intelligence.

Recommended order:

```text
SPEC-201 Discovery

↓

SPEC-202 Requirement Intelligence

↓

SPEC-203 Requirement Quality Assessment

↓

SPEC-204 Business Analysis

↓

SPEC-205 Risk Analysis

↓

SPEC-206 Test Strategy

↓

SPEC-207 Test Design

↓

SPEC-208 Test Data

↓

SPEC-209 Automation

↓

SPEC-210 Execution

↓

SPEC-211 Bug Analysis

↓

SPEC-212 Reporting

↓

SPEC-213 Agent and Skill Quality Assessment
```

Outcome:

The reader understands what the platform does.

---

## Stage 6 — Architecture Layer

Purpose:

Understand how product capabilities are implemented.

Typical documents include:

```text
SPEC-301 Semantic Analyzer

↓

SPEC-302 DOM Cleaner

↓

SPEC-303 Feature Extractor

↓

SPEC-304 Workflow Engine

↓

SPEC-305 Plugin Manager

↓

SPEC-306 Workspace Manager

↓

SPEC-307 Knowledge Graph Builder

↓

SPEC-308 Reasoning Engine

↓

SPEC-309 Agent Runtime

↓

SPEC-310 Evaluation Engine
```

Outcome:

The reader understands the collaboration of major modules.

---

## Stage 7 — Interfaces

Purpose:

Understand module contracts.

Recommended order:

```text
SPEC-506 Workspace Context Contract
↓
SPEC-501 Knowledge Store Interface
↓
SPEC-502 Rule Engine Interface
↓
SPEC-503 Plugin Contract
↓
SPEC-504 Execution Engine Contract
↓
SPEC-505 Platform Event Contract
↓
SPEC-507 Reasoning Provider Contract
↓
SPEC-508 Agent Runtime Contract
↓
SPEC-509 Skill Contract
↓
SPEC-510 Agent Tool Contract
↓
SPEC-511 Evaluation Adapter Contract
```

Outcome:

The reader understands communication between modules.

---

## Stage 8 — Component Layer

Purpose:

Understand individual implementation units after their contracts are known.

Recommended order:

```text
SPEC-401 Knowledge Repository

SPEC-402 Rule Repository

SPEC-403 Candidate Repository

SPEC-404 Execution Manager

SPEC-405 Plugin Registry

SPEC-406 Workspace Manager Component

SPEC-407 Playwright Plugin

SPEC-408 Ontology Repository

SPEC-409 Git Plugin

SPEC-410 Agent Runner

SPEC-411 Evaluation Manager
```

Outcome:

The reader understands ownership and contract implementation.

---

## Stage 9 — Runtime

Purpose:

Understand execution.

Recommended order:

```text
SPEC-601 Runtime Orchestration
↓
SPEC-602 Execution Lifecycle
↓
SPEC-603 Scheduling and Capacity
↓
SPEC-604 Observability and Monitoring
↓
SPEC-605 Recovery and Continuity
↓
SPEC-606 Agent Execution Lifecycle
↓
SPEC-607 Evaluation Campaign Lifecycle
```

Outcome:

The reader understands runtime behavior.

---

## Stage 10 — Implementation

Purpose:

Understand source code.

Recommended sequence:

```text
tests

↓

core

↓

plugins

↓

runtime

↓

api
```

Implementation SHALL be interpreted through governing specifications.

Implementation SHALL NOT redefine architecture.

---

# 5. Reading Paths

## Executive Path

For architects and technical leaders.

```text
Foundation

↓

Architecture Principles

↓

ADRs

↓

Roadmap
```

---

## Product Path

For product owners and business analysts.

```text
Foundation

↓

Glossary

↓

Product Specifications
```

---

## AI Coding Agent Path

```text
MANIFEST.yaml

↓

Repository Governance

↓

Architecture Principles

↓

Reading Order

↓

Applicable ADRs

↓

Applicable Specification

↓

Ontology

↓

Schema

↓

Rule

↓

Implementation
```

An AI agent SHALL NOT start from implementation.

---

## New Engineer Path

```text
README

↓

Foundation

↓

Architecture Principles

↓

ADRs

↓

Knowledge

↓

Product

↓

Architecture

↓

Code
```

---

## Reviewer Path

```text
Changed Artifact

↓

Dependencies

↓

Related ADR

↓

Related Specification

↓

Review Checklist

↓

Quality Gates
```

---

# 6. Reading Decision Rules

## Rule 1

Never read a lower layer before understanding its governing layer.

---

## Rule 2

Always read related ADRs before implementing a specification.

---

## Rule 3

Always read the ontology before creating new knowledge structures.

---

## Rule 4

Always read schemas before implementing persistence.

---

## Rule 5

Always read interfaces before implementing adapters.

---

## Rule 6

Always read governance before approving architectural changes.

---

# 7. Change-driven Reading

When modifying an artifact, the contributor SHOULD read:

```text
Modified Artifact

↓

Dependencies

↓

Related ADRs

↓

Related Specifications

↓

Affected Schemas

↓

Affected Rules

↓

Affected Components

↓

Affected Tests
```

Never modify an artifact in isolation.

---

# 8. AI Context Construction

When preparing context for an AI task, include only the minimum governing artifacts required.

Preferred order:

```text
Foundation

↓

Applicable ADRs

↓

Relevant Specification

↓

Schema

↓

Ontology

↓

Rules

↓

Target Component
```

Avoid supplying:

* unrelated specifications
* unrelated ADRs
* entire repositories
* raw conversation history
* unnecessary implementation files

Smaller, authoritative context improves consistency and reduces ambiguity.

---

# 9. Reading Completion Criteria

A contributor has sufficient architectural context to begin implementation when they can answer:

* Why does this capability exist?
* Which specification owns it?
* Which ADR constrains it?
* Which ontology concepts are involved?
* Which schema defines it?
* Which module owns it?
* Which Workspace does it belong to?
* Which rules govern it?
* Which tests validate it?

If any answer is unknown, additional reading is required.

---

# 10. Anti-Patterns

The following reading patterns are prohibited.

## Code First

```text
Implementation

↓

Guess Design
```

---

## Prompt First

```text
Ask AI

↓

Accept Answer

↓

Search Repository
```

---

## ADR Ignored

```text
Specification

↓

Implementation

↓

Architecture Decision
```

---

## Knowledge Ignored

```text
Business Logic

↓

Code

↓

Knowledge
```

---

## Governance Ignored

```text
Implement

↓

Review

↓

Read Rules
```

These patterns increase architectural drift and reduce repository reliability.

---

# 11. Reading Summary

Every contributor SHOULD mentally progress through the repository using this sequence:

```text
Vision
      ↓
Principles
      ↓
Governance
      ↓
Architecture Decisions
      ↓
Knowledge
      ↓
Product
      ↓
Architecture
      ↓
Interfaces
      ↓
Components
      ↓
Runtime
      ↓
Implementation
      ↓
Tests
```

Every implementation should be explainable by tracing upward through this chain.

The repository is designed to be understood from intent to execution—not from code to assumptions.
