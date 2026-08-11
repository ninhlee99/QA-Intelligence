---
id: ADR-003
title: Semantic UI Instead of Raw DOM
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Architecture
  - Discovery
  - Knowledge
related_specs:
  - SPEC-003
  - SPEC-004
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
supersedes: []
superseded_by: null
---

# ADR-003: Semantic UI Instead of Raw DOM

## 1. Context

QA Intelligence analyzes existing software applications to understand business behavior before generating tests.

Most browser automation frameworks expose the application's HTML Document Object Model (DOM).

Although the DOM accurately represents the rendered document, it was designed for browser rendering rather than business understanding.

Modern web applications frequently contain:

- deeply nested layouts
- framework-generated elements
- dynamic rendering
- virtual DOM implementations
- CSS utility wrappers
- presentation-only containers
- duplicated structures
- accessibility metadata
- client-side generated identifiers

These structures significantly increase complexity while providing little business value.

LLMs perform poorly when presented with large, noisy HTML documents because:

- token consumption increases dramatically
- presentation details dominate business meaning
- repeated structures dilute important information
- semantic intent becomes difficult to infer

QA Intelligence therefore requires an intermediate representation that captures the meaning of a user interface instead of its implementation details.

---

## 2. Problem

Using raw DOM as the primary input creates several problems.

### Excessive Noise

Most HTML nodes represent layout rather than business behavior.

Example:

- div
- span
- flex containers
- grid wrappers
- styling classes

These elements rarely contribute to business understanding.

---

### Implementation Dependency

Different frameworks produce different DOM structures for the same UI.

Examples include:

- React
- Angular
- Vue
- Svelte

A business concept should not change simply because the frontend framework changes.

---

### Token Inefficiency

Large DOM trees consume unnecessary context window space.

Important information becomes buried among thousands of unrelated nodes.

---

### Weak Business Understanding

HTML describes structure.

QA Intelligence must understand concepts such as:

- Login Form
- Checkout Page
- Product Search
- Shopping Cart
- User Profile
- Payment Method

These concepts are not represented directly in HTML.

---

### Poor Knowledge Reuse

DOM snapshots are difficult to compare across releases because implementation details change frequently.

Business concepts remain much more stable.

---

## 3. Decision

QA Intelligence SHALL convert every discovered interface into a Semantic UI representation before AI analysis.

The Semantic UI becomes the canonical representation consumed by:

- Requirement Intelligence
- Business Analysis
- Risk Analysis
- Rule Engine
- Test Strategy
- Test Design
- Automation Planning
- Reporting
- Learning

Raw DOM remains an implementation artifact and MUST NOT be the primary reasoning input.

---

## 4. Decision Rules

### 4.1 Canonical Representation

Semantic UI SHALL be the canonical representation of application interfaces.

The DOM SHALL be treated as one source of evidence rather than the source of truth.

---

### 4.2 Semantic Extraction

Discovery SHALL extract concepts instead of elements.

Examples include:

- Form
- Button
- Input
- Table
- Dialog
- Navigation
- Search Area
- Filter Panel
- Data Grid
- Wizard
- Dashboard

---

### 4.3 Business Intent

Each semantic component SHOULD describe its business purpose whenever possible.

Examples:

Instead of

Button

the system should identify

Submit Order Button

instead of

Input

the system should identify

Email Address Field

---

### 4.4 Relationship Preservation

Semantic UI MUST preserve relationships.

Examples:

- button belongs to form
- column belongs to table
- dialog belongs to page
- validation belongs to field
- menu belongs to navigation

Understanding relationships is more important than preserving HTML hierarchy.

---

### 4.5 Stable Identity

Each semantic component SHALL have a stable identifier independent of DOM implementation.

Stable identifiers improve:

- change detection
- knowledge reuse
- automation maintenance
- regression analysis

---

### 4.6 Evidence Retention

Although Semantic UI is the canonical representation, links back to the original DOM SHALL be preserved.

Evidence should include:

- locator
- DOM path
- accessibility metadata
- screenshots
- extracted attributes

This enables traceability without exposing raw HTML to reasoning modules.

---

### 4.7 Technology Independence

Semantic UI MUST NOT depend on:

- React
- Angular
- Vue
- Svelte
- HTML versions

The same business interface should produce comparable Semantic UI regardless of implementation technology.

---

## 5. Rationale

### 5.1 Business-Oriented Understanding

Users interact with business features rather than HTML elements.

Semantic UI aligns the platform with business understanding.

---

### 5.2 Reduced Context Size

Removing layout noise significantly reduces the amount of information processed by AI models.

This improves:

- speed
- cost
- reasoning quality

---

### 5.3 Better Knowledge Reuse

Business concepts change much less frequently than HTML implementations.

Knowledge attached to Semantic UI remains useful across multiple application versions.

---

### 5.4 Framework Independence

Frontend migrations should not invalidate previously learned business knowledge.

---

### 5.5 Explainability

Semantic concepts produce explanations that are understandable by both engineers and business stakeholders.

Example:

"Checkout Form contains Payment Method"

is more meaningful than

"div > div > section > form > div".

---

## 6. Alternatives Considered

### 6.1 Raw DOM

Rejected because it is noisy, unstable, and implementation-oriented.

---

### 6.2 Screenshot-only Analysis

Rejected because screenshots contain visual information but lack structural and interactive semantics.

---

### 6.3 Accessibility Tree Only

Rejected because accessibility metadata provides useful semantics but does not fully represent business intent or application structure.

---

### 6.4 Hybrid DOM + Semantic UI

Accepted.

The DOM remains available as supporting evidence.

Semantic UI becomes the primary reasoning representation.

---

## 7. Consequences

### Positive

- reduced token consumption
- improved reasoning quality
- technology independence
- better explainability
- reusable business knowledge
- more stable automation

### Negative

- additional discovery processing
- semantic extraction complexity
- need for ontology maintenance
- mapping between Semantic UI and DOM must be maintained

---

## 8. Risks and Mitigations

### Risk

Incorrect semantic extraction.

Mitigations:

- confidence scoring
- multiple evidence sources
- ontology validation
- human review when confidence is low

---

### Risk

Loss of implementation detail.

Mitigations:

- preserve links to DOM
- retain locators
- retain screenshots
- retain accessibility metadata

---

## 9. AI Guidance

### AI Coding Agents MUST

- consume Semantic UI rather than raw HTML
- preserve traceability to DOM evidence
- separate business semantics from implementation details
- extend semantic extraction through ontology

### AI Coding Agents MUST NOT

- build reasoning directly on HTML structure
- expose raw DOM to downstream reasoning modules
- encode framework-specific assumptions into Semantic UI

### AI Runtime Agents MUST

- analyze Semantic UI first
- retrieve DOM evidence only when required
- propagate semantic identifiers across workflows

---

## 10. Compliance

An implementation complies with this ADR when:

- all reasoning modules consume Semantic UI
- DOM is treated as supporting evidence
- semantic components preserve relationships
- traceability to original DOM is maintained
- framework-specific implementation details do not influence business reasoning

---

## 11. Related Decisions

- ADR-001 defines Knowledge Store as the authoritative source.
- ADR-002 defines Rule Engine precedence.
- ADR-004 will define the UI Knowledge Graph built upon Semantic UI.

---

## 12. Implementation Notes

The detailed Semantic UI schema will be defined in the Knowledge Layer.

Future specifications should define:

- semantic component taxonomy
- relationship model
- confidence scoring
- extraction pipeline
- ontology mapping
- serialization format
- versioning strategy

This ADR establishes Semantic UI as the canonical representation for AI reasoning, independent of frontend implementation technology.
