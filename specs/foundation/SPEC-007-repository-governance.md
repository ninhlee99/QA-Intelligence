---
id: SPEC-007
title: Repository Governance
version: 1.1.0
status: accepted
owner:
  - Architecture
  - Engineering Governance
depends_on:
  - SPEC-001
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-010
last_updated: 2026-08-03
---

# SPEC-007: Repository Governance

## 1. Purpose

This specification defines the governance model for the QA Intelligence Engineering Knowledge Base.

It establishes the rules for:

* repository structure
* artifact ownership
* document creation
* document modification
* naming
* numbering
* versioning
* dependency management
* review
* approval
* deprecation
* archival
* breaking changes
* traceability
* AI-assisted engineering

The repository is not only a storage location for documentation and source code.

It is the authoritative engineering knowledge system for QA Intelligence.

---

## 2. Background

QA Intelligence is designed as an AI-native engineering platform.

Its development depends on structured knowledge that can be understood and used consistently by both humans and AI agents.

The repository contains several classes of engineering artifacts, including:

* Foundation Specifications
* Architecture Decision Records
* Knowledge Specifications
* Product Specifications
* Architecture Specifications
* Component Specifications
* schemas
* ontology definitions
* rules
* templates
* examples
* playbooks
* governance documents
* source code
* tests

Without repository governance, these artifacts may become:

* duplicated
* contradictory
* outdated
* incorrectly located
* poorly connected
* difficult to discover
* unsafe for AI consumption

Repository governance is therefore required to preserve the repository as a Single Source of Truth.

---

## 3. Problem Statement

A large engineering repository becomes unreliable when contributors can add or modify artifacts without consistent rules.

Common failure modes include:

* multiple documents owning the same responsibility
* decisions hidden inside implementation code
* business rules embedded inside prompts
* duplicate schemas
* undocumented dependencies
* inconsistent naming
* stale indexes
* untraceable changes
* breaking changes without impact analysis
* AI-generated artifacts that conflict with existing architecture
* specifications that mix multiple architectural layers
* implementation created before specification approval

The repository requires explicit governance rules that apply to all contributors, including AI coding agents.

---

## 4. Goals

This specification has the following goals:

1. Preserve the repository as the authoritative engineering knowledge source.
2. Ensure every artifact has one clear responsibility.
3. Ensure every artifact is stored in the correct architectural layer.
4. Maintain traceability between decisions, specifications, schemas, rules, code, and tests.
5. Prevent duplication and architectural drift.
6. Make the repository understandable to AI agents.
7. Define controlled change and approval processes.
8. Support long-term maintainability and evolution.
9. Prevent implementation from silently redefining architecture.
10. Enable repeatable architecture and quality reviews.

---

## 5. Non-Goals

This specification does not define:

* product behavior
* business requirements
* runtime architecture
* ontology entities
* Knowledge Object schemas
* Rule Engine execution
* source control provider configuration
* CI/CD implementation
* programming language conventions
* deployment infrastructure

Those concerns belong to other specifications, ADRs, playbooks, or implementation guidelines.

---

## 6. Definitions

### 6.1 Repository

The complete version-controlled Engineering Knowledge Base and implementation workspace for QA Intelligence.

---

### 6.2 Artifact

Any governed item stored in the repository.

Examples include:

* specifications
* ADRs
* schemas
* rules
* ontology definitions
* templates
* examples
* playbooks
* source code
* tests
* indexes

---

### 6.3 Authoritative Artifact

An approved artifact that may be used as a source of truth.

---

### 6.4 Derived Artifact

An artifact generated from authoritative sources.

Examples include:

* indexes
* dependency graphs
* generated documentation
* compiled schemas

Derived artifacts MUST NOT redefine their authoritative sources.

---

### 6.5 Artifact Owner

The role, team, or domain responsible for maintaining an artifact.

---

### 6.6 Architectural Layer

The repository domain in which an artifact belongs.

Primary specification layers are:

```text
Foundation
Knowledge
Product
Architecture
Interfaces
Components
Runtime
```

---

### 6.7 Breaking Change

A change that invalidates an existing contract, assumption, schema, dependency, or implementation.

---

### 6.8 Architecture Freeze

A governed state in which accepted Foundation Specifications and ADRs cannot be modified without formal impact analysis.

---

## 7. Scope

This specification applies to:

* all repository contributors
* all AI coding agents
* all architecture documents
* all specifications
* all ADRs
* all schemas
* all ontology definitions
* all rules
* all playbooks
* all implementation modules
* all tests
* all generated repository metadata

No repository artifact is exempt from governance unless explicitly declared.

---

## 8. Responsibilities

### 8.1 Architecture Owner

The Architecture Owner SHALL:

* approve architectural changes
* maintain Foundation Specifications
* maintain architecture governance
* review cross-layer dependencies
* review breaking changes
* resolve ownership conflicts
* approve new architectural layers

---

### 8.2 Artifact Owner

Each authoritative artifact SHALL have an owner.

The owner SHALL:

* maintain artifact accuracy
* review proposed changes
* resolve conflicts
* manage lifecycle status
* ensure dependent artifacts remain consistent

---

### 8.3 Contributor

A contributor SHALL:

* read applicable governance documents
* search for existing artifacts before creating new ones
* identify the correct architectural layer
* preserve dependency direction
* update traceability metadata
* perform impact analysis
* follow review and approval requirements

---

### 8.4 AI Coding Agent

An AI Coding Agent SHALL follow the same governance rules as a human contributor.

AI-generated artifacts SHALL NOT receive reduced review requirements solely because they were machine-generated.

---

## 9. Repository Structure

The canonical repository structure SHALL be:

```text
QA-Intelligence/
│
├── README.md
├── ROADMAP.md
├── CHANGELOG.md
├── MANIFEST.yaml
│
├── specs/
│   ├── foundation/
│   ├── knowledge/
│   ├── product/
│   ├── architecture/
│   ├── interfaces/
│   ├── components/
│   └── runtime/
│
├── adr/
│   ├── architecture/
│   ├── product/
│   └── ai/
│
├── governance/
├── meta/
├── ontology/
├── schemas/
├── knowledge/
├── rules/
├── templates/
├── examples/
├── reference/
├── playbooks/
├── docs/
├── api/
├── core/
├── plugins/
├── agents/
├── skills/
├── evaluations/
├── runtime/
├── tests/
├── workspace-template/
└── .ai/
```

New top-level directories SHALL require architecture approval.

---

## 10. Artifact Placement Rules

### 10.1 Foundation

Foundation Specifications define stable system-wide intent and laws.

Examples include:

* vision
* principles
* engineering laws
* AI governance
* glossary
* system landscape
* repository governance

Foundation Specifications SHALL NOT contain component implementation details.

---

### 10.2 Architecture Decision Records

ADRs record significant architectural decisions and their rationale.

ADRs answer:

> Why was this decision made?

ADRs SHALL NOT become implementation manuals.

---

### 10.3 Knowledge Specifications

Knowledge Specifications define:

* ontology
* knowledge models
* knowledge lifecycle
* Knowledge Store
* Rule Engine
* Learning Engine

---

### 10.4 Product Specifications

Product Specifications define user-visible or business-facing capabilities.

Examples include:

* Discovery
* Requirement Intelligence
* Risk Analysis
* Test Strategy
* Test Design
* Execution
* Reporting

---

### 10.5 Architecture Specifications

Architecture Specifications define system structure and module collaboration.

They answer:

> How are major capabilities organized?

---

### 10.6 Interface Specifications

Interface Specifications define contracts between modules, plugins, services, and external consumers.

They answer:

> Which stable contract is the shared production and test surface?

---

### 10.7 Component Specifications

Component Specifications define individual deployable or implementable components after their contracts are known.

They answer:

> What does this component own and which interface does it implement?

---

### 10.8 Runtime Specifications

Runtime Specifications define:

* execution behavior
* orchestration
* lifecycle
* deployment assumptions
* observability
* runtime failure handling

---

### 10.9 Governed Agent, Skill, and Evaluation Artifacts

`agents/`, `skills/`, and `evaluations/` contain executable, versioned artifacts that have passed their applicable specifications and GOV-012 gates. Draft learning examples remain in `examples/`.

These directories do not create new architectural authority layers. Agent and Skill meaning remains governed by SPEC-106; evaluation meaning remains governed by SPEC-107; accepted knowledge remains in the Knowledge Store; Plugins remain technology adapters.

---

## 11. Single Responsibility Rule

Every authoritative artifact SHALL have one primary responsibility.

An artifact MUST NOT simultaneously own unrelated concerns.

Examples of invalid combinations include:

* ontology and storage implementation
* product requirements and plugin implementation
* architectural decision and detailed code design
* business rules and UI selectors
* repository governance and runtime orchestration

When an artifact grows beyond one responsibility, it SHALL be split.

---

## 12. Single Source of Truth Rule

Each governed concept SHALL have one authoritative source.

Other artifacts MAY reference or summarize the source but MUST NOT redefine it.

Examples:

* ADRs own architectural decisions.
* Specifications own detailed behavior and contracts.
* Schemas own machine-validatable structures.
* Ontology artifacts own semantic definitions.
* Rule definitions own deterministic business rules.
* Reference documents own shared enumerations and constants.

Duplicated definitions SHALL be removed or replaced with references.

---

## 13. Naming Conventions

### 13.1 Specifications

Specification filenames SHALL use:

```text
SPEC-<number>-<concise-kebab-case-name>.md
```

Example:

```text
SPEC-007-repository-governance.md
```

---

### 13.2 ADRs

ADR filenames SHALL use:

```text
ADR-<number>-<concise-kebab-case-name>.md
```

Example:

```text
ADR-007-plugin-as-adapter.md
```

---

### 13.3 Playbooks

Playbook filenames SHALL use:

```text
PB-<number>-<concise-kebab-case-name>.md
```

---

### 13.4 Schemas

Schema filenames SHALL use:

```text
<entity-name>.schema.json
```

Example:

```text
knowledge-object.schema.json
```

---

### 13.5 General Rules

Filenames SHALL:

* use lowercase
* use kebab-case
* avoid spaces
* avoid ambiguous abbreviations
* remain concise
* preserve stable identifiers

Renaming an authoritative artifact SHALL require reference updates.

---

## 14. Specification Numbering

Specification number ranges SHALL be:

```text
SPEC-001–099   Foundation
SPEC-101–199   Knowledge
SPEC-201–299   Product
SPEC-301–399   Architecture
SPEC-401–499   Components
SPEC-501–599   Interfaces
SPEC-601–699   Runtime
```

Numbers SHALL NOT be reused after an artifact is deprecated or removed.

Reserved numbers MAY remain unused.

---

## 15. Required Specification Metadata

Every specification SHALL include:

```yaml
id:
title:
version:
status:
owner:
depends_on:
related_adrs:
last_updated:
```

Optional metadata MAY include:

```yaml
supersedes:
superseded_by:
reviewers:
security_classification:
tags:
```

Metadata SHALL remain machine-readable.

---

## 16. Required ADR Metadata

Every ADR SHALL include:

```yaml
id:
title:
status:
version:
date:
decision_owners:
related_specs:
related_adrs:
supersedes:
superseded_by:
```

---

## 17. Lifecycle Statuses

Authoritative documents SHALL use one of the following statuses:

```text
draft
in_review
accepted
deprecated
superseded
rejected
archived
```

### 17.1 Draft

The artifact is incomplete and MUST NOT be treated as authoritative.

### 17.2 In Review

The artifact is ready for formal review but is not yet authoritative.

### 17.3 Accepted

The artifact is approved and authoritative.

### 17.4 Deprecated

The artifact remains valid for compatibility but SHOULD NOT be used for new work.

### 17.5 Superseded

Another artifact has replaced the artifact.

### 17.6 Rejected

The proposal was reviewed and not accepted.

### 17.7 Archived

The artifact is retained only for historical or audit purposes.

---

## 18. Versioning

Authoritative artifacts SHALL use semantic versioning:

```text
MAJOR.MINOR.PATCH
```

### 18.1 Major Version

Increment the major version when:

* contracts become incompatible
* responsibilities change materially
* required fields are removed
* architectural assumptions change
* behavior becomes incompatible

### 18.2 Minor Version

Increment the minor version when:

* backward-compatible behavior is added
* optional fields are introduced
* scope is expanded without invalidating existing contracts

### 18.3 Patch Version

Increment the patch version when:

* wording is clarified
* examples are corrected
* formatting is improved
* non-semantic errors are fixed

---

## 19. Dependency Rules

Dependencies SHALL follow the approved direction:

```text
Foundation
      ↓
ADR
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
```

A lower-level artifact MUST NOT redefine or invalidate a higher-level artifact.

Implementation code SHALL NOT become the source of architectural truth.

Circular dependencies between authoritative artifacts are prohibited.

---

## 20. Artifact Creation Workflow

Before creating a new authoritative artifact, the contributor SHALL:

1. Search the repository for an existing owner of the concern.
2. Identify the architectural layer.
3. Confirm the artifact has one primary responsibility.
4. Assign an unused identifier.
5. identify dependencies.
6. identify related decisions.
7. select the correct template.
8. create the artifact as `draft`.
9. update applicable indexes.
10. submit the artifact for review.

The creation workflow SHALL be:

```text
Need Identified
      ↓
Repository Search
      ↓
Layer Classification
      ↓
Ownership Check
      ↓
Identifier Assignment
      ↓
Draft
      ↓
Review
      ↓
Accepted
      ↓
Index Update
```

---

## 21. Artifact Modification Workflow

Before modifying an accepted artifact, the contributor SHALL:

1. identify the reason for change
2. classify the change
3. inspect dependent artifacts
4. perform change impact analysis
5. determine the required version increment
6. update references
7. update the changelog
8. request review

Accepted artifacts SHALL NOT be silently modified.

---

## 22. Architecture Freeze Rules

After Architecture Freeze v1.0:

* accepted Foundation Specifications are considered stable
* accepted ADRs are considered stable
* changes require documented impact analysis
* contradictions SHALL be resolved before downstream work continues
* new downstream specifications MUST conform to frozen decisions

Architecture Freeze does not prohibit change.

It requires controlled change.

---

## 23. Breaking Change Governance

A breaking change SHALL require:

* explicit change proposal
* impact analysis
* affected artifact list
* migration plan
* compatibility assessment
* architecture approval
* version updates
* changelog entry
* traceability updates

The workflow SHALL be:

```text
Breaking Change Proposed
          ↓
Impact Analysis
          ↓
Architecture Review
          ↓
Migration Plan
          ↓
Approval
          ↓
Implementation
          ↓
Validation
```

Breaking changes MUST NOT be introduced indirectly through implementation.

---

## 24. Deprecation and Supersession

Deprecated artifacts SHALL:

* retain their original identifier
* include a deprecation reason
* identify the replacement
* specify a migration path when applicable
* remain available for traceability

Superseded artifacts SHALL include:

```yaml
status: superseded
superseded_by:
```

The replacing artifact SHOULD include:

```yaml
supersedes:
```

Historical artifacts MUST NOT be deleted merely because they are no longer active.

---

## 25. Traceability Requirements

Every implementation capability SHOULD be traceable through:

```text
Vision
  ↓
Product Principle
  ↓
Engineering Law
  ↓
ADR
  ↓
Specification
  ↓
Schema or Rule
  ↓
Component
  ↓
Code
  ↓
Test
  ↓
Runtime Evidence
```

At minimum:

* specifications SHALL reference related ADRs
* components SHALL reference their governing specifications
* schemas SHALL reference their semantic owner
* tests SHALL reference the behavior or contract they validate
* breaking changes SHALL identify affected dependencies

---

## 26. Index Management

The repository SHALL maintain machine-readable indexes.

Required indexes SHOULD include:

```text
meta/SPEC_INDEX.yaml
meta/ADR_INDEX.yaml
meta/SCHEMA_INDEX.yaml
meta/ONTOLOGY_INDEX.yaml
meta/RULE_INDEX.yaml
meta/PLAYBOOK_INDEX.yaml
```

Indexes SHALL be updated when artifacts are:

* created
* renamed
* accepted
* deprecated
* superseded
* archived

An index is a navigation aid.

It is not the authoritative owner of artifact content.

---

## 27. Templates

New governed artifacts SHALL use approved templates.

Required templates SHOULD include:

```text
templates/SPEC.md
templates/ADR.md
templates/Playbook.md
templates/Knowledge.md
templates/Rule.md
templates/Schema.md
templates/Plugin.md
templates/Workspace.md
templates/Agent.md
templates/Skill.md
templates/EvaluationSuite.md
```

Templates SHALL preserve required metadata and section structure.

---

## 28. Review Requirements

Every authoritative artifact SHALL receive review before acceptance.

Review SHALL evaluate:

* responsibility
* layer placement
* consistency
* dependencies
* terminology
* traceability
* security
* maintainability
* AI interpretability
* implementation feasibility

Reviewers SHALL use:

```text
governance/REVIEW_CHECKLIST.md
```

---

## 29. Quality Gates

Artifacts SHALL pass applicable quality gates before acceptance.

Minimum gates include:

```text
Structure Gate
      ↓
Ownership Gate
      ↓
Architecture Gate
      ↓
Dependency Gate
      ↓
Traceability Gate
      ↓
Security Gate
      ↓
Quality Gate
      ↓
Acceptance
```

Detailed gate definitions SHALL be maintained in:

```text
governance/QUALITY_GATES.md
```

---

## 30. AI Implementation Guide

Before creating or modifying repository content, an AI agent SHALL:

1. read `MANIFEST.yaml`
2. read `governance/READING_ORDER.md`
3. read applicable Foundation Specifications
4. read related ADRs
5. search for existing artifacts
6. identify the authoritative owner
7. verify dependency direction
8. use the correct template
9. preserve required metadata
10. update related indexes and traceability

AI agents SHALL prefer references over duplicated definitions.

---

## 31. AI Coding Notes

AI coding agents MUST NOT:

* create undocumented top-level directories
* create duplicate specifications
* redefine accepted ADR decisions
* place knowledge inside prompts
* hardcode governed business rules
* bypass approved schemas
* treat conversation history as authoritative
* silently modify accepted documents
* introduce implementation before governing specifications exist
* create circular dependencies
* remove historical decisions
* bypass architecture review for breaking changes

AI coding agents MUST:

* preserve provenance
* cite governing artifacts in code where applicable
* use stable identifiers
* respect ownership boundaries
* update tests when contracts change
* report unresolved conflicts
* keep generated metadata synchronized
* distinguish authoritative and derived artifacts

---

## 32. Error Handling

### 32.1 Duplicate Ownership

When two artifacts appear to own the same responsibility:

* stop artifact creation
* identify the existing authoritative owner
* merge, reference, or formally supersede
* do not preserve parallel definitions

---

### 32.2 Unknown Layer

When artifact placement is unclear:

* do not create the artifact
* classify its responsibility
* inspect the repository governance model
* escalate to architecture review when necessary

---

### 32.3 Missing Dependency

When a required upstream artifact does not exist:

* mark the artifact as blocked
* do not invent the dependency
* create or approve the upstream artifact first

---

### 32.4 Conflicting Decisions

When accepted artifacts conflict:

* stop downstream implementation
* identify precedence
* initiate architecture review
* supersede or amend the conflicting artifact
* record the resolution

---

### 32.5 Stale Index

When an index conflicts with an authoritative artifact:

* treat the authoritative artifact as correct
* repair the index
* record the synchronization failure

---

## 33. Edge Cases

### 33.1 Experimental Work

Experimental artifacts MAY exist outside the authoritative lifecycle when clearly marked.

They SHALL NOT be treated as approved architecture or knowledge.

Recommended location:

```text
experiments/
```

Adding this directory requires architecture approval.

---

### 33.2 Generated Files

Generated files SHALL:

* identify their source
* indicate that they are generated
* avoid manual modification
* be reproducible where practical

---

### 33.3 External Standards

External standards MAY be referenced but SHOULD NOT be copied in full.

The repository SHALL record:

* standard name
* applicable version
* local interpretation
* affected artifacts

---

### 33.4 Temporary Documents

Temporary notes SHALL NOT be stored in authoritative specification directories.

Temporary information SHALL have an explicit expiration or promotion process.

---

## 34. Security

Repository governance SHALL protect:

* credentials
* secrets
* personal data
* regulated information
* proprietary implementation details

Credentials MUST NOT be stored in:

* specifications
* ADRs
* examples
* templates
* prompts
* source-controlled configuration

Security-sensitive examples SHALL use placeholders.

Artifact visibility and classification MAY be governed by additional security policies.

---

## 35. Performance

Repository navigation SHOULD remain efficient for both humans and AI agents.

To support efficient retrieval:

* files SHOULD remain focused
* indexes SHOULD remain current
* metadata SHOULD be machine-readable
* documents SHOULD use stable headings
* definitions SHOULD reference authoritative sources
* large generated artifacts SHOULD be separated from core specifications

---

## 36. Configuration

Repository governance configuration MAY include:

* allowed lifecycle statuses
* required metadata
* identifier ranges
* review requirements
* ownership rules
* quality gate policies
* schema validation rules
* index generation rules

Governance configuration MUST NOT override Foundation Specifications or accepted ADRs.

---

## 37. Definition of Done

This specification is complete when:

* the canonical repository structure is defined
* artifact placement rules are defined
* numbering rules are defined
* naming rules are defined
* lifecycle statuses are defined
* versioning rules are defined
* dependency direction is defined
* creation and modification workflows are defined
* architecture freeze rules are defined
* breaking change governance is defined
* traceability requirements are defined
* AI governance rules are defined
* review and quality gate requirements are defined
* deprecation and supersession rules are defined

An implementation of repository governance is complete when:

* required folders exist
* required templates exist
* governance documents exist
* machine-readable indexes exist
* metadata validation is automated
* dependency validation is automated where practical
* broken references are detected
* review checklists are operational
* quality gates are integrated into the contribution workflow

---

## 38. Out of Scope

The following are outside the scope of this specification:

* detailed ontology design
* Knowledge Object implementation
* Rule Engine implementation
* Learning Engine implementation
* product feature definitions
* runtime deployment
* CI/CD platform selection
* source control branching strategy
* programming language style guides

---

## 39. Future Improvements

Future versions may define:

* automated repository graph validation
* automatic identifier allocation
* machine-enforced ownership rules
* AI-readable change impact reports
* automated traceability generation
* architecture conformance testing
* document freshness scoring
* artifact usage analytics
* automated deprecation detection
* governance policy as code

---

## 40. Governance Summary

The repository SHALL operate according to the following hierarchy:

```text
Vision
      ↓
Engineering Laws
      ↓
Product Principles
      ↓
AI Governance
      ↓
Architecture Decisions
      ↓
Specifications
      ↓
Schemas and Rules
      ↓
Components
      ↓
Implementation
      ↓
Runtime Evidence
```

No lower layer may silently redefine a higher layer.

The repository is the authoritative Engineering Knowledge Base for QA Intelligence.

Every contribution SHALL preserve its consistency, traceability, explainability, and long-term integrity.
