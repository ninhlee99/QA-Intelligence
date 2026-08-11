---
id: SPEC-006

title: System Landscape & Domain Map

version: 1.0.0

status: accepted

owner:
  - Architecture

depends_on:
  - SPEC-001
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005

reviewed_by:

related_adrs: []

last_updated: 2026-08-03
---

# Purpose

Define the complete landscape of QA Intelligence.

This specification describes the system from a business and engineering perspective before discussing implementation.

It establishes the official Domain Map of QA Intelligence.

Every future specification MUST belong to one of the domains defined here.

---

# Background

As software systems evolve, architectural complexity usually increases.

Without clearly defined domains:

- responsibilities overlap
- modules become tightly coupled
- duplicated logic appears
- ownership becomes unclear
- AI implementations become inconsistent

QA Intelligence prevents these problems by defining explicit domains.

---

# Problem Statement

QA Intelligence is not a single application.

It is an engineering platform consisting of multiple domains.

Without a domain map:

- modules cannot determine ownership
- dependencies become unclear
- architecture drifts
- plugins become tightly coupled
- future extensions become difficult

---

# Goals

This specification defines:

- System Landscape
- Domain Map
- Domain Responsibilities
- Domain Boundaries
- Dependency Direction
- Ownership Model

---

# Non Goals

This specification does not define:

- implementation
- APIs
- database
- plugin details
- runtime workflow

Those are covered by later specifications.

---

# System Overview

QA Intelligence consists of six major domains.

```

Engineering Specification

↓

Knowledge

↓

Core Engine

↓

Workspace

↓

Plugin

↓

Runtime

```

Every capability belongs to exactly one domain.

---

# Domain Map

```

QA Intelligence

├── Engineering Specification Domain

├── Knowledge Domain

├── Core Engine Domain

├── Workspace Domain

├── Plugin Domain

└── Runtime Domain

```

---

# Domain 1 — Engineering Specification

## Purpose

Defines how the system should be built.

## Responsibilities

Owns:

- Vision
- Product Principles
- Engineering Laws
- Governance
- Architecture
- Specifications

Never owns:

- Runtime Knowledge
- Execution Results
- Project Data

---

# Domain 2 — Knowledge

## Purpose

Owns reusable engineering knowledge.

## Responsibilities

Owns:

- Business Rules
- Testing Patterns
- QA Best Practices
- Knowledge Objects
- Rule Engine
- Knowledge Store

Never owns:

- Runtime Execution
- Plugins
- Reports

---

# Domain 3 — Core Engine

## Purpose

Central intelligence of QA Intelligence.

## Responsibilities

Owns:

- Orchestrator
- AI Agents
- Discovery
- Requirement Intelligence
- Business Analysis
- Testing Engine
- Reporting Engine
- Learning Engine

Never owns:

- IDE integration
- Workspace storage
- Project configuration

---

# Domain 4 — Workspace

## Purpose

Owns project-specific resources.

## Responsibilities

Owns:

- Configuration
- Project Knowledge
- Reports
- Automation
- History
- Artifacts

Never owns:

- Global Knowledge
- Specifications
- Agent Logic

---

# Domain 5 — Plugin

## Purpose

Integrates QA Intelligence with external environments.

## Responsibilities

Owns:

- Cursor Integration
- Claude Code Integration
- Codex Integration
- VS Code Integration

Never owns:

- Business Logic
- Rule Engine
- Knowledge Store

Plugins are adapters.

Nothing more.

---

# Domain 6 — Runtime

## Purpose

Executes engineering operations.

## Responsibilities

Owns:

- Playwright Execution
- API Execution
- Browser Session
- Test Results
- Logs
- Screenshots
- Traces

Never owns:

- Specifications
- Knowledge
- Business Rules

---

# Ownership Matrix

| Domain | Owns | Never Owns |
|----------|------------|----------------|
| Specification | Engineering Documents | Runtime Data |
| Knowledge | Business Knowledge | Execution |
| Core Engine | Intelligence | Storage |
| Workspace | Project Resources | AI Logic |
| Plugin | IDE Integration | Business Rules |
| Runtime | Execution | Knowledge |

---

# Dependency Direction

The dependency direction is immutable.

```

Specification

↓

Knowledge

↓

Core Engine

↓

Workspace

↓

Plugin

↓

Runtime

```

Higher domains never depend on lower domains.

---

# Cross Domain Communication

Communication between domains is only allowed through published interfaces.

Forbidden:

Plugin

↓

Knowledge Database

Direct access.

Required:

Plugin

↓

Core Engine API

↓

Knowledge API

---

# Domain Isolation

Every domain must be independently replaceable.

Examples

Replace

Claude

↓

Gemini

Should not affect

Knowledge Domain.

Replace

Workspace Storage

↓

Cloud Storage

Should not affect

Testing Engine.

Replace

Playwright

↓

Future Automation Framework

Should not affect

Business Analysis.

---

# Data Flow

High-level flow.

```

Requirement

↓

Discovery

↓

Knowledge

↓

Business Analysis

↓

Risk Analysis

↓

Strategy

↓

Test Design

↓

Automation

↓

Execution

↓

Observation

↓

Learning

↓

Knowledge Store

```

This flow is conceptual.

Detailed workflows are defined later.

---

# Responsibilities

This specification defines:

- domain ownership
- domain boundaries
- dependency direction
- communication model
- system landscape

---

# Inputs

Referenced by:

Every architecture specification.

---

# Outputs

Official Domain Map.

Official Ownership Model.

---

# Dependencies

Depends on:

SPEC-001

SPEC-002

SPEC-003

SPEC-004

SPEC-005

Referenced by:

All Architecture Specifications.

---

# Security

Every domain should expose the minimum public surface required.

Direct access across domains is prohibited unless explicitly defined.

---

# Performance

Domains should minimize coupling.

Knowledge should be reusable.

Runtime should remain stateless whenever practical.

---

# AI Implementation Guide

Before implementing a module, AI must answer:

1.

Which domain owns this module?

2.

Which domain consumes it?

3.

Is this dependency allowed?

4.

Can another domain own this responsibility?

If ownership is ambiguous,

Implementation must stop.

The specification should be updated first.

---

# AI Coding Notes

AI MUST

Respect domain ownership.

Respect dependency direction.

Respect interface boundaries.

AI SHOULD

Keep domains independently deployable.

Minimize cross-domain communication.

AI MUST NOT

Move business rules into plugins.

Move runtime logic into knowledge.

Store project data inside specifications.

Duplicate ownership across domains.

---

# Definition of Done

Completed when:

✓ Every capability belongs to one domain.

✓ Every domain has one responsibility.

✓ Dependency direction is defined.

✓ Ownership is unambiguous.

✓ Future architecture specifications can reference this map.

---

# Out of Scope

This specification does not define:

- implementation
- APIs
- storage technology
- runtime engine
- plugin implementation

---

# Future Improvements

Future versions may introduce:

- Enterprise Domains

- Cloud Services Domain

- Distributed Agent Domain

- Marketplace Domain

- Multi-Tenant Domain

- Observability Domain
