---
id: ADR-004
title: UI Knowledge Graph as the Canonical UI Knowledge Model
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Architecture
  - Discovery
  - Knowledge
related_specs:
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
supersedes: []
superseded_by: null
---

# ADR-004: UI Knowledge Graph as the Canonical UI Knowledge Model

## 1. Context

ADR-003 establishes Semantic UI as the canonical representation of a user interface.

Semantic UI identifies meaningful interface components such as:

- Pages
- Forms
- Buttons
- Inputs
- Tables
- Dialogs
- Menus
- Wizards
- Dashboards

However, identifying semantic components is not sufficient for intelligent reasoning.

QA Intelligence must understand how those components relate to each other and to business concepts.

For example, a Login Button is not merely a button.

It is connected to:

- Login Form
- Username Field
- Password Field
- Authentication Process
- Business Rules
- Validation Rules
- Test Cases
- Risks
- Automation
- Historical Bugs

These relationships form a knowledge network rather than a hierarchy.

---

## 2. Problem

A Semantic UI document is primarily a structured description.

It does not explicitly represent complex relationships.

Without relationship modeling:

- business impact analysis is limited
- dependency discovery becomes difficult
- knowledge reuse decreases
- change impact cannot be computed accurately
- navigation across features is difficult
- AI reasoning remains document-centric

QA Intelligence requires a graph-based representation capable of modeling relationships across the entire application.

---

## 3. Decision

QA Intelligence SHALL represent discovered application knowledge as a UI Knowledge Graph.

The UI Knowledge Graph becomes the canonical relationship model connecting:

- Semantic UI
- Business Rules
- Requirements
- Knowledge Objects
- Test Assets
- Risks
- Automation
- Observations

The graph SHALL be independent of frontend implementation technology.

---

## 4. Decision Rules

### 4.1 Node-based representation

Every significant business object SHALL become a graph node.

Examples include:

- Page
- Screen
- Form
- Input
- Button
- API
- Business Rule
- Validation Rule
- Requirement
- Test Case
- Risk
- Bug
- Automation Script

---

### 4.2 Explicit relationships

Relationships MUST be explicitly represented.

Examples include:

- contains
- belongs_to
- invokes
- validates
- depends_on
- implements
- verifies
- uses
- navigates_to
- triggers
- blocks
- requires
- references

Relationships SHALL be first-class entities.

---

### 4.3 Stable identifiers

Every node SHALL have a globally unique and stable identifier.

Identifiers MUST remain stable across UI implementation changes whenever the underlying business concept remains unchanged.

---

### 4.4 Evidence preservation

Each node SHALL maintain references to supporting evidence.

Evidence may include:

- DOM locators
- screenshots
- accessibility metadata
- API specifications
- requirement documents
- business rules

Evidence SHALL support traceability but SHALL NOT define the business meaning of the node.

---

### 4.5 Relationship confidence

Automatically discovered relationships SHALL include confidence scores.

Relationships below the governance threshold SHALL remain candidates until validated.

---

### 4.6 Version awareness

The graph SHALL support versioning.

Historical relationships MUST remain traceable even after UI evolution.

---

### 4.7 Graph extensibility

The graph model SHALL support new node types and relationship types without requiring redesign of existing structures.

---

## 5. Rationale

### 5.1 Relationship-centric reasoning

Business understanding depends more on relationships than isolated components.

Example:

```
Checkout Form
    ↓
uses
    ↓
Payment API
    ↓
validated by
    ↓
Business Rule
```

This relationship provides richer reasoning than three disconnected objects.

---

### 5.2 Impact Analysis

Graph traversal enables change impact analysis.

Example:

Changing one Business Rule immediately reveals:

- affected screens
- affected APIs
- affected test cases
- affected automation
- affected risks

---

### 5.3 Knowledge Reuse

Knowledge attached to graph nodes remains reusable across releases.

Only changed relationships require updates.

---

### 5.4 Explainability

Every reasoning path can be reconstructed.

Example:

```
Requirement

↓

Business Rule

↓

Validation

↓

Input Field

↓

Test Case
```

The graph naturally explains why a test exists.

---

### 5.5 Learning

New observations enrich existing nodes instead of creating isolated documents.

Learning therefore becomes incremental rather than repetitive.

---

## 6. Alternatives Considered

### 6.1 Hierarchical Tree

Rejected.

Business knowledge is not purely hierarchical.

Many objects participate in multiple relationships.

---

### 6.2 Relational Database Only

Rejected.

Relational schemas become increasingly complex as relationships grow.

Graph traversal is more natural.

---

### 6.3 Document Repository

Rejected.

Documents describe knowledge but do not model relationships efficiently.

---

### 6.4 Hybrid Graph + Documents

Accepted.

Documents remain evidence.

The graph represents business knowledge.

---

## 7. Consequences

### Positive

- better business reasoning
- efficient impact analysis
- reusable knowledge
- explainable AI decisions
- simplified dependency discovery
- improved automation maintenance
- richer navigation across application knowledge

### Negative

- graph maintenance complexity
- ontology governance required
- relationship validation required
- additional storage requirements

---

## 8. Risks and Mitigations

### Risk

Incorrect relationship extraction.

Mitigations:

- confidence scoring
- ontology validation
- evidence preservation
- human review

---

### Risk

Graph growth.

Mitigations:

- modular graph partitions
- scoped traversal
- indexing
- caching

---

### Risk

Relationship inconsistency.

Mitigations:

- relationship constraints
- schema validation
- ontology governance
- automated integrity checks

---

## 9. AI Guidance

### AI Coding Agents MUST

- represent business knowledge as graph relationships
- preserve evidence separately from graph semantics
- avoid duplicating nodes
- maintain stable identifiers
- support graph traversal APIs

### AI Coding Agents MUST NOT

- encode relationships only inside documents
- treat DOM hierarchy as business hierarchy
- duplicate equivalent business concepts

### AI Runtime Agents MUST

- retrieve graph context before reasoning
- traverse relationships when performing impact analysis
- enrich existing nodes instead of creating duplicates

---

## 10. Compliance

An implementation complies with this ADR when:

- business entities are represented as graph nodes
- relationships are explicit
- evidence remains traceable
- graph identifiers remain stable
- ontology governs node and relationship types

---

## 11. Related Decisions

- ADR-001 defines Knowledge Store.
- ADR-002 defines deterministic decision precedence.
- ADR-003 defines Semantic UI.
- ADR-005 will define Discovery Before Asking.

---

## 12. Implementation Notes

The detailed graph schema belongs to the Knowledge Layer.

Future specifications should define:

- node taxonomy
- relationship taxonomy
- graph storage
- graph query model
- graph versioning
- graph synchronization
- graph integrity validation
- graph traversal APIs

This ADR establishes the UI Knowledge Graph as the canonical relationship model for QA Intelligence.
