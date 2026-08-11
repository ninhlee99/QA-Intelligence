---
id: SPEC-101
title: QA Intelligence Ontology
version: 1.0.0
status: accepted
owner:
  - Ontology Steward
  - Knowledge Governance
depends_on:
  - SPEC-001
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005
  - SPEC-006
  - SPEC-007
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-101: QA Intelligence Ontology

## 1. Purpose

This specification defines the canonical semantic model for QA Intelligence.

The ontology establishes shared meaning across product capabilities, knowledge, rules, tests, automation, execution, defects, evidence, Workspaces, and learning.

It SHALL enable humans and machines to answer:

- what an artifact means
- which lifecycle state it occupies
- how it relates to authoritative intent
- which Workspace owns it
- what evidence supports it
- which downstream artifacts may be affected by change

## 2. Goals

- provide stable canonical concepts
- eliminate competing semantic definitions
- support bidirectional traceability
- enable the UI Knowledge Graph
- support machine-readable impact analysis
- preserve provenance and Workspace boundaries
- distinguish authoritative knowledge from candidates and observations
- keep semantic identity independent of storage and providers

## 3. Non-Goals

This specification does not define:

- database tables or indexes
- API transport formats
- UI layout or selectors
- LLM prompts
- product workflow details
- vendor-specific graph technology

## 4. Ontology Principles

1. Meaning SHALL be defined before representation.
2. Every governed entity SHALL have a stable identity.
3. Every relationship SHALL have explicit semantics and direction.
4. Workspace ownership SHALL be explicit for Workspace-scoped entities.
5. Authority, provenance, confidence, and lifecycle status SHALL remain distinct.
6. Historical facts SHALL NOT be rewritten to match current interpretation.
7. Derived relationships SHALL reference their derivation method and sources.
8. Provider concepts SHALL NOT become core ontology concepts unless they express stable domain meaning.

## 5. Core Entity Families

| Family | Canonical Entities |
|---|---|
| Governance | Specification, ADR, Policy, QualityGate, Review, Exception |
| Product | Capability, Requirement, AcceptanceCriterion, BusinessRule, Risk |
| Knowledge | KnowledgeObject, KnowledgeCandidate, Source, Claim, Concept |
| Quality | TestStrategy, TestCase, TestData, AutomationAsset, Defect |
| Runtime | Execution, Step, Result, Evidence, Environment, Release |
| Platform | Workspace, Actor, Component, Interface, Plugin, Provider |
| Learning | Observation, Feedback, Evaluation, ImprovementProposal |

## 6. Entity Identity

Every entity SHALL expose:

- `id`: globally stable logical identifier
- `type`: canonical ontology type
- `version`: semantic or revision identity where applicable
- `status`: lifecycle state
- `workspace_id`: required for Workspace-scoped entities
- `owner`: accountable owner reference
- `created_at` and `updated_at`

Identifiers SHALL NOT be reused after retirement.

Storage keys SHALL NOT define semantic identity.

## 7. Canonical Relationships

| Relationship | Source → Target | Meaning |
|---|---|---|
| `depends_on` | Artifact → Artifact | Source requires target authority or contract |
| `governs` | Authority → Artifact | Target is constrained by source |
| `satisfies` | Artifact → Requirement | Source implements or fulfills target |
| `validates` | Test/Evidence → Artifact | Source checks target expectation |
| `implements` | Component/Asset → Contract | Source realizes target |
| `produces` | Process/Execution → Artifact | Source creates target |
| `derived_from` | Artifact → Source | Source material contributed to target |
| `supported_by` | Claim → Evidence | Evidence supports the claim |
| `contradicts` | Artifact → Artifact | Meanings or claims conflict |
| `supersedes` | Artifact → Artifact | Source replaces target authority |
| `affects` | Change/Risk → Artifact | Source may alter target behavior |
| `belongs_to` | Entity → Workspace | Entity is scoped to target Workspace |
| `executed_by` | Execution → Engine/Plugin | Target performed the execution |
| `observed_in` | Observation → Execution | Observation arose from target |

Relationship direction SHALL be preserved even when navigation is bidirectional.

## 8. Authority Model

Authority SHALL be represented separately from confidence.

Canonical authority classes are:

1. accepted Foundation Specification
2. accepted governance policy
3. accepted ADR
4. accepted domain specification
5. approved schema, rule, or Knowledge Object
6. derived artifact
7. Knowledge Candidate
8. runtime observation
9. unverified external content

A lower authority class SHALL NOT silently override a higher class.

## 9. Lifecycle Model

Entities SHALL use an applicable subset of:

```text
draft → in_review → accepted → deprecated → superseded → archived
```

Runtime entities MAY use:

```text
planned → queued → running → completed | failed | cancelled
```

Candidates MAY use:

```text
discovered → proposed → validating → promoted | rejected | expired
```

Lifecycle transitions SHALL be explicit events with actor, time, reason, and evidence.

## 10. Workspace Semantics

Every Workspace-scoped entity and relationship SHALL carry one Workspace identity.

Cross-Workspace relationships are prohibited unless:

- the relationship type is explicitly global
- both authorization and governance allow it
- no protected content crosses the boundary
- the operation is audited

Global ontology definitions MAY be shared; Workspace-owned instances SHALL remain isolated.

## 11. Provenance

Provenance SHALL identify:

- source entity or external reference
- acquisition method
- actor or system
- timestamp
- transformation
- applicable Workspace
- integrity information

Generated content SHALL identify model, prompt, context sources, tools, and human approval when applicable.

## 12. Semantic UI Model

The platform SHALL represent UI knowledge through semantic concepts such as:

- Page
- Region
- Feature
- Field
- Action
- Validation
- Navigation
- Workflow
- State
- Permission

Raw DOM nodes and selectors MAY be evidence or adapter detail but SHALL NOT be canonical product meaning.

## 13. Constraints

- a Requirement SHALL belong to exactly one primary Capability
- a TestCase SHALL validate at least one Requirement or Risk
- an AutomationAsset SHALL implement at least one TestCase
- an Execution SHALL identify exact executable assets and environment
- Evidence SHALL identify its producing Execution or review activity
- a promoted KnowledgeObject SHALL have provenance and an accountable owner
- a KnowledgeCandidate SHALL NOT be authoritative
- a Rule SHALL identify authority, inputs, outputs, scope, and version
- Workspace-scoped nodes SHALL NOT have ungoverned cross-Workspace edges

## 14. Extension Rules

New types or relationships SHALL require:

- demonstrated semantic need
- search for existing equivalent concepts
- owner assignment
- definition and examples
- constraints and lifecycle
- compatibility and migration analysis
- ontology review

Extensions SHALL prefer specialization of an existing concept over a synonymous parallel type.

## 15. Validation

Ontology validation SHALL include:

- unique identity
- known types and relationship predicates
- required properties
- valid cardinality
- lifecycle transition legality
- authority consistency
- Workspace isolation
- absence of prohibited cycles
- canonical terminology
- provenance completeness

## 16. Quality Gates

The ontology passes when:

- all concepts have one authoritative definition
- relationships have explicit direction and meaning
- constraints are machine-validatable where feasible
- Workspace semantics are enforceable
- sample lifecycle graphs validate
- downstream impact has been assessed
- Knowledge Governance and Architecture approve the model

## 17. Definition of Done

- canonical entity and relationship catalogs exist
- machine-readable ontology artifacts derive from this specification
- schemas reference canonical concepts
- traceability rules align with GOV-006
- no storage or provider choice redefines meaning
- positive and negative examples validate
- evolution and deprecation rules are operational

## 18. Summary

SPEC-101 owns the stable semantic vocabulary of QA Intelligence.

Every downstream schema, rule, product specification, component, interface, and execution record SHALL preserve this meaning.
