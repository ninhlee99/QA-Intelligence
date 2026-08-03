---
id: SPEC-003

title: Engineering Laws

version: 1.0.0

status: accepted

owner:
  - Architecture
  - Engineering Governance

depends_on:
  - SPEC-001
  - SPEC-002

reviewed_by:

related_adrs: []

last_updated: 2026-08-03
---

# Purpose

Define the immutable engineering laws of QA Intelligence.

Unlike coding standards or implementation guidelines, Engineering Laws are absolute constraints.

Every module, every AI Agent, every plugin and every future implementation MUST comply with these laws.

Violation of an Engineering Law is considered an architectural defect.

---

# Background

Software systems usually become difficult to maintain because architecture slowly drifts over time.

Common causes include:

- duplicated responsibilities
- hidden dependencies
- multiple sources of truth
- undocumented assumptions
- inconsistent reasoning

QA Intelligence prevents architecture drift by defining immutable engineering laws.

---

# Goals

Engineering Laws ensure:

- architectural consistency
- predictable AI behavior
- maintainable codebase
- reusable knowledge
- explainable decisions
- long-term scalability

---

# Non Goals

This specification does not define:

- implementation details
- coding style
- naming convention
- API contracts

These are covered by other specifications.

---

# Engineering Laws

## Law 1 — Single Responsibility

Every module owns exactly one responsibility.

Examples

Discovery Engine

Responsible for discovering systems.

Not responsible for generating testcases.

Testing Engine

Responsible for generating tests.

Not responsible for discovering UI.

Learning Engine

Responsible for improving knowledge.

Not responsible for executing Playwright.

---

## Law 2 — Single Source of Truth

Every important information must have exactly one owner.

Examples

Business Rules

↓

Knowledge Store

Project Configuration

↓

Workspace

UI Structure

↓

Discovery Engine

Automation Templates

↓

Playwright Engine

Reports

↓

Reporting Engine

Duplicating ownership is prohibited.

---

## Law 3 — Knowledge Never Lives in Prompts

Knowledge must exist as structured objects.

Never rely on prompt history.

Never rely on previous conversations.

Knowledge must always be persisted in the Knowledge Store.

---

## Law 4 — Separation of Reasoning and Execution

Reasoning is not execution.

Execution is not learning.

Learning is not storage.

These concerns must remain independent.

Architecture

Reasoning

↓

Decision

↓

Execution

↓

Observation

↓

Learning

↓

Knowledge Store

---

## Law 5 — Deterministic Before Probabilistic

Whenever deterministic logic exists, it must be executed first.

Priority

Engineering Specification

↓

Rule Engine

↓

Knowledge Store

↓

Configuration

↓

AI Reasoning

LLM reasoning is the last option.

---

## Law 6 — Discovery Before User Interaction

The AI must attempt automatic discovery before requesting user input.

Allowed user questions include:

- credentials
- OTP
- unavailable environments
- conflicting requirements

Everything else should be discovered automatically whenever possible.

---

## Law 7 — Traceability

Every generated artifact must be traceable.

Requirement

↓

Business Rule

↓

Test Strategy

↓

Test Case

↓

Automation

↓

Execution

↓

Bug

↓

Report

No artifact should exist without an identifiable origin.

---

## Law 8 — Explainability

Every important decision must be explainable.

The system should always answer:

Why?

Based on what?

Generated from which evidence?

Produced by which rule?

---

## Law 9 — No Hidden Intelligence

AI behavior must never depend on undocumented prompts.

If a capability is important enough to affect system behavior, it must be documented in:

- Engineering Specification
- Rule Engine
- Knowledge Store

Hidden prompt logic is prohibited.

---

## Law 10 — Knowledge Must Be Versioned

Knowledge changes over time.

The system must preserve:

- source
- version
- timestamp
- confidence
- validation status

Knowledge must never be silently overwritten.

---

## Law 11 — Learning Requires Validation

Observation is not knowledge.

Inference is not knowledge.

Only validated information becomes knowledge.

Workflow

Observation

↓

Candidate

↓

Validation

↓

Knowledge Object

↓

Knowledge Store

---

## Law 12 — Dependency Direction

Dependencies always point downward.

Vision

↓

Engineering Laws

↓

Architecture

↓

Modules

↓

Implementation

↓

Runtime

Lower layers must never redefine higher layers.

---

## Law 13 — Module Communication

Modules communicate only through defined interfaces.

Modules must never manipulate another module's internal state directly.

Communication should be explicit and observable.

---

## Law 14 — Configuration Over Hardcoding

Project-specific behavior belongs in configuration.

Never hardcode:

- URLs
- credentials
- business rules
- environment settings
- project preferences

---

## Law 15 — AI Independence

QA Intelligence owns its intelligence.

Claude

Cursor

Codex

Gemini

OpenAI

are reasoning providers.

The architecture, knowledge and behavior belong to QA Intelligence.

Changing the underlying AI model must not require redesigning the system.

---

# Engineering Decision Hierarchy

All decisions follow this order.

Engineering Specification

↓

Engineering Laws

↓

Product Principles

↓

Architecture

↓

Knowledge Store

↓

Rule Engine

↓

Configuration

↓

Reasoning Engine

↓

Execution

No lower layer may contradict a higher layer.

---

# Responsibilities

Engineering Laws define:

- architectural constraints
- module boundaries
- dependency rules
- intelligence ownership
- knowledge ownership

---

# Inputs

Referenced by every future specification.

---

# Outputs

Engineering constraints applied consistently across the project.

---

# Dependencies

Depends on:

- SPEC-001 Vision
- SPEC-002 Product Principles

Referenced by:

Every future specification.

---

# Security

Engineering Laws reduce security risks by:

- eliminating hidden logic
- preventing duplicated knowledge
- enforcing explicit ownership
- minimizing undocumented behaviors

---

# Performance

Engineering Laws improve performance through:

- reusable knowledge
- deterministic execution
- modular architecture
- reduced duplicated reasoning

---

# AI Implementation Guide

Before implementing any module, the AI must verify:

1. Does this module have exactly one responsibility?
2. Does it own any duplicated knowledge?
3. Does it violate dependency direction?
4. Can every output be traced?
5. Is reasoning separated from execution?
6. Does it rely on hidden prompts?

If any answer is YES for a violation,

Implementation must stop until resolved.

---

# AI Coding Notes

AI MUST

- enforce Engineering Laws
- reject architecture violations
- preserve dependency direction
- preserve traceability

AI SHOULD

- maximize reuse
- minimize coupling
- maximize explainability

AI MUST NOT

- introduce hidden dependencies
- duplicate ownership
- hardcode project knowledge
- bypass the Rule Engine
- bypass Knowledge Store

---

# Definition of Done

Completed when:

✓ Engineering Laws are documented.

✓ Dependency hierarchy is defined.

✓ Intelligence ownership is defined.

✓ Module ownership is defined.

✓ Traceability rules are established.

✓ Every future specification can inherit these laws.

---

# Out of Scope

This specification does not define:

- project architecture
- module implementation
- APIs
- storage
- testing workflows

---

# Future Improvements

Future versions may introduce:

- Enterprise Architecture Rules
- Multi-Agent Governance
- Plugin Certification Rules
- Distributed Knowledge Synchronization
- Compliance & Audit Framework
