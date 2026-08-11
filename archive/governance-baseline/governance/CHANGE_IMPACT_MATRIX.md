---
id: GOV-007
title: Change Impact Matrix
version: 1.0.0
status: accepted
accountable_owner: Engineering Governance
owner:
  - Engineering Governance
approvers:
  - Architecture
  - Product Governance
consulted:
  - AI Governance
  - Knowledge Governance
  - Security
  - Quality Engineering
depends_on:
  - SPEC-001
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005
  - SPEC-006
  - SPEC-007
  - GOV-001
  - GOV-002
  - GOV-003
  - GOV-004
  - GOV-005
  - GOV-006
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
last_updated: 2026-07-31
---

# Change Impact Matrix

## 1. Purpose

This document defines the canonical change-impact analysis process for the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- identify all artifacts affected by a proposed change
- prevent isolated updates that leave the repository inconsistent
- determine required reviewers and approvers
- identify compatibility and migration obligations
- detect downstream implementation and runtime impact
- determine required validation and regression scope
- protect architectural, knowledge, Workspace, security, and AI boundaries
- support machine-readable impact analysis
- make breaking changes explicit
- preserve traceability throughout the change lifecycle

This document answers:

- What changes directly?
- What may change indirectly?
- Which artifacts must be reviewed?
- Which owners must participate?
- Is the change breaking?
- Are migrations required?
- Which tests must run?
- Which knowledge or rules may become stale?
- Which Workspaces or consumers are affected?
- Which releases may contain the change?
- What evidence is required before acceptance?

No governed change SHALL proceed to implementation without an appropriate impact assessment.

---

# 2. Change Philosophy

Every change is a graph operation.

A change affects not only the edited artifact but also its:

- upstream authorities
- downstream consumers
- dependencies
- owners
- interfaces
- schemas
- rules
- knowledge
- tests
- runtime behavior
- evidence
- releases

The canonical model is:

```text
Change Request

↓

Changed Artifact

↓

Incoming Relationships

↓

Outgoing Relationships

↓

Affected Owners

↓

Compatibility Assessment

↓

Risk Assessment

↓

Migration Assessment

↓

Validation Scope

↓

Approval

↓

Implementation

↓

Verification

↓

Release
```

The absence of an obvious dependency SHALL NOT be treated as proof of no impact.

Impact analysis SHALL use repository traceability rather than personal memory.

---

# 3. Change Principles

## 3.1 Analyze Before Editing

The contributor SHALL perform impact analysis before modifying an accepted artifact.

Exploration and draft preparation MAY occur before final analysis.

Implementation SHALL NOT begin until blocking impact questions are resolved.

---

## 3.2 Change the Authoritative Source First

When a behavior changes, update its authoritative source before or with downstream artifacts.

Examples:

```text
Business Rule

↓

Rule Representation

↓

Tests

↓

Implementation
```

Not:

```text
Implementation

↓

Guess Business Rule Later
```

---

## 3.3 Direct and Indirect Impact Are Both Required

Direct impact includes artifacts explicitly linked to the changed artifact.

Indirect impact includes:

- transitive consumers
- derived indexes
- generated artifacts
- cached knowledge
- compatibility contracts
- operational procedures
- security assumptions
- AI context assembly
- reports and metrics

---

## 3.4 Stable Identity Must Be Preserved

Moving or renaming a file SHALL NOT create a new semantic artifact unless the concept itself changes.

Stable identifiers SHALL remain intact.

Impact analysis SHALL distinguish:

- path change
- title change
- metadata change
- semantic change
- structural change
- behavioral change
- lifecycle change

---

## 3.5 Every Breaking Change Requires a Migration Plan

Breaking changes SHALL identify:

- affected consumers
- required actions
- compatibility period
- migration owner
- migration order
- rollback strategy
- completion criteria

A breaking change without a migration plan SHALL not be accepted.

---

## 3.6 Every Change Requires Validation Proportional to Risk

Validation scope SHALL be determined by:

- change type
- affected authority level
- blast radius
- security impact
- data impact
- reversibility
- AI autonomy impact
- Workspace scope
- runtime criticality
- historical defect risk

Small code size does not imply low impact.

---

## 3.7 Generated Artifacts Must Be Regenerated

When an authoritative source changes, derived artifacts SHALL be:

- regenerated
- revalidated
- marked stale
- or explicitly declared unaffected

Generated artifacts SHALL NOT be edited independently unless their generation model permits it.

---

## 3.8 Historical Evidence Must Remain Interpretable

Changes to:

- schemas
- rules
- knowledge
- execution contracts
- result classifications
- reports

SHALL preserve the ability to interpret historical execution and audit records.

---

## 3.9 Uncertainty Must Be Reported

When impact cannot be determined, the change SHALL be marked as having unknown impact.

Unknown impact is a risk state.

It SHALL NOT be silently treated as no impact.

---

## 3.10 Emergency Changes Require Reconciliation

Emergency changes MAY use an expedited process.

After stabilization, they SHALL be reconciled with:

- ADRs
- specifications
- schemas
- rules
- tests
- traceability
- changelog
- release records
- operational playbooks

---

# 4. Change Categories

Every change SHALL be classified into one or more categories.

## 4.1 Editorial Change

Changes wording without changing meaning.

Examples:

- spelling
- grammar
- formatting
- clearer explanation
- broken documentation link

Expected impact is usually low.

Editorial classification SHALL NOT be used when normative meaning changes.

---

## 4.2 Metadata Change

Changes:

- owner
- status
- version metadata
- scope
- references
- classifications
- lifecycle dates

Metadata changes may have significant governance impact.

---

## 4.3 Semantic Change

Changes the meaning of:

- term
- ontology entity
- relationship
- requirement
- business concept
- Knowledge Object
- rule

Semantic changes require downstream analysis.

---

## 4.4 Structural Change

Changes a machine-readable representation.

Examples:

- schema field
- payload structure
- event shape
- configuration structure
- persistence model

---

## 4.5 Behavioral Change

Changes what the system does.

Examples:

- decision logic
- validation behavior
- orchestration
- execution flow
- error handling
- user-visible behavior

---

## 4.6 Architectural Change

Changes:

- system boundary
- dependency direction
- ownership boundary
- abstraction
- deployment model
- plugin model
- Workspace isolation
- source of truth

Architectural changes generally require an ADR.

---

## 4.7 Interface Change

Changes:

- request
- response
- event
- method
- capability declaration
- error contract
- lifecycle contract
- compatibility behavior

---

## 4.8 Data Change

Changes:

- stored representation
- migration
- retention
- classification
- access
- deletion
- historical interpretation

---

## 4.9 Rule Change

Changes deterministic logic, precedence, scope, or effective period.

---

## 4.10 Knowledge Change

Changes:

- Knowledge Object
- candidate lifecycle
- scope resolution
- conflict resolution
- approval state
- provenance
- knowledge retrieval behavior

---

## 4.11 AI Change

Changes:

- model provider
- model capability
- prompt template
- AI policy
- autonomy level
- confidence threshold
- structured output
- AI validation
- learning behavior

---

## 4.12 Runtime Change

Changes:

- deployment
- scheduling
- retries
- concurrency
- timeout
- recovery
- telemetry
- resource allocation
- runtime configuration

---

## 4.13 Security Change

Changes:

- authentication
- authorization
- credential handling
- trust boundaries
- sensitive-data exposure
- audit
- encryption
- execution permissions

---

## 4.14 Operational Change

Changes:

- runbooks
- monitoring
- alerts
- backup
- recovery
- incident response
- support process

---

## 4.15 Dependency Change

Adds, removes, upgrades, or redirects a dependency.

---

## 4.16 Lifecycle Change

Changes states or transitions such as:

- Draft to Approved
- Active to Deprecated
- Candidate to Knowledge Object
- Bug closure
- artifact archival
- rule activation

---

# 5. Change Scope

Every change SHALL declare its scope.

```text
Global

Organization

Project

Feature

Screen

Session
```

Additional implementation scopes include:

```text
Repository

Domain

Component

Interface

Plugin

Runtime Service

Deployment Environment
```

A change with global scope requires broader impact analysis than a project-scoped change.

Scope SHALL NOT be inferred only from file location.

---

# 6. Impact Dimensions

Every impact analysis SHALL evaluate the following dimensions.

| Dimension | Key Question |
|---|---|
| Product | Does user-visible or business behavior change? |
| Architecture | Do boundaries, abstractions, or dependency directions change? |
| Governance | Do policies, approvals, or quality gates change? |
| Semantic | Does the meaning of an entity or relationship change? |
| Schema | Does machine-readable structure change? |
| Rule | Does deterministic behavior change? |
| Knowledge | Does reusable knowledge become invalid, conflicted, or stale? |
| Interface | Do providers or consumers need modification? |
| Component | Which implementation units change? |
| Plugin | Which adapters or external integrations are affected? |
| Runtime | Does orchestration, deployment, or operation change? |
| Workspace | Are isolation, scope, or project assets affected? |
| Data | Is migration, transformation, or retention affected? |
| Security | Are trust, authorization, credentials, or sensitive data affected? |
| AI | Are model behavior, autonomy, validation, or prompts affected? |
| Testing | Which tests, coverage, or evidence must change? |
| Documentation | Which specifications, examples, and playbooks become stale? |
| Operations | Which alerts, runbooks, dashboards, or support procedures change? |
| Release | Is coordinated rollout, rollback, or consumer communication required? |

---

# 7. Impact Levels

## 7.1 Level 0 — No Material Impact

The change is purely non-semantic and does not affect:

- behavior
- structure
- ownership
- interfaces
- dependencies
- lifecycle
- validation

Example:

- spelling correction

Required process:

- artifact-owner review
- basic link and format validation

---

## 7.2 Level 1 — Local Impact

The change affects one artifact or implementation unit without changing external contracts.

Examples:

- internal refactor
- non-breaking documentation clarification
- local test improvement

Required process:

- owner review
- local validation
- affected unit tests

---

## 7.3 Level 2 — Bounded Cross-Artifact Impact

The change affects multiple related artifacts within one domain.

Examples:

- requirement and associated tests
- schema addition with compatible consumers
- component behavior change within an existing interface

Required process:

- domain-owner review
- traceability update
- targeted regression
- compatibility check

---

## 7.4 Level 3 — Cross-Domain Impact

The change affects multiple domains, owners, or contracts.

Examples:

- Knowledge schema used by Product and Runtime
- shared interface behavior
- plugin contract
- rule-precedence model

Required process:

- architecture review
- affected-owner consultation
- migration and regression planning
- release coordination

---

## 7.5 Level 4 — Platform-Wide Impact

The change affects platform principles, architecture, security, AI governance, or global contracts.

Examples:

- Workspace isolation model
- Knowledge authority model
- Rule Engine architecture
- execution abstraction
- AI autonomy policy

Required process:

- formal ADR or Foundation update
- cross-governance approval
- comprehensive impact analysis
- staged migration
- broad conformance validation
- release and rollback plan

---

# 8. Impact Severity

Impact level and risk severity are separate.

Severity SHALL consider consequences if the impact is handled incorrectly.

## Critical

Potential consequences include:

- security breach
- credential exposure
- cross-Workspace data leakage
- unauthorized destructive action
- loss of authoritative knowledge
- irreversible data corruption
- invalid regulatory behavior
- high-risk AI autonomy escalation

---

## High

Potential consequences include:

- incorrect business decisions
- widespread interface failure
- invalid rule execution
- broken release compatibility
- loss of execution evidence
- architecture boundary violation
- incorrect Knowledge Object promotion

---

## Medium

Potential consequences include:

- bounded feature malfunction
- partial migration failure
- stale documentation affecting contributors
- degraded observability
- incomplete traceability
- plugin compatibility issue

---

## Low

Potential consequences include:

- minor usability issue
- local documentation inconsistency
- non-critical maintenance overhead
- small performance regression
- optional metadata drift

---

# 9. Master Change Impact Matrix

| Changed Artifact | Primary Direct Impact | Mandatory Review Areas |
|---|---|---|
| Vision | Product Principles, roadmap, Product Specifications | Product Governance, Architecture |
| Product Principle | Engineering Laws, ADRs, Product behavior, quality policy | Product Governance, Engineering Governance |
| Engineering Law | Governance, ADRs, architecture tests, implementation constraints | Engineering Governance, Architecture |
| AI Governance | reasoning services, prompts, autonomy, validation, audit | AI Governance, Security |
| ADR | specifications, interfaces, components, dependencies | Architecture |
| Governance Document | reviews, quality gates, repository automation | Engineering Governance |
| Glossary | Ontology, specifications, documentation | Ontology Steward |
| Ontology | schemas, rules, knowledge, Product semantics | Ontology Steward, Knowledge Governance |
| Schema | interfaces, persistence, events, tests, migrations | Schema Steward, Interface Owners |
| Knowledge Specification | Knowledge Store, Product use, learning, governance | Knowledge Governance, Architecture |
| Knowledge Object | rules, reasoning, requirements, tests, future decisions | Scope Owner, Domain Validator |
| Rule | Product behavior, Test Cases, runtime decisions | Domain Owner, Rule Governance |
| Product Specification | requirements, architecture, components, acceptance criteria | Product Governance |
| Requirement | rules, risks, tests, implementation | Product Owner, Quality Engineering |
| Risk | strategy, mitigation, tests, release decision | Risk Owner, Quality Engineering |
| Test Strategy | Test Cases, data, automation, execution scope | Quality Engineering |
| Test Case | automation, coverage, execution, reporting | Quality Engineering |
| Automation Asset | execution, evidence, maintenance | Automation Owner |
| Interface | providers, consumers, contract tests, migrations | Interface Owner, Architecture |
| Component | implementation, interfaces, telemetry, deployment | Component Owner |
| Plugin Contract | plugins, runtime registration, compatibility | Architecture, Plugin Owners |
| Plugin Implementation | external integration, runtime behavior, tests | Plugin Owner |
| Execution Contract | adapters, orchestration, evidence, results | Execution Platform Owner |
| Runtime Configuration | behavior, deployment, performance, security | Runtime Owner, Operations |
| Workspace Model | isolation, access, storage, all scoped assets | Architecture, Security |
| Credential Contract | plugins, runtime, security controls | Security |
| Report Definition | metrics, source queries, stakeholder decisions | Reporting Owner |
| Release Process | quality gates, operations, approvals | Release Owner, Engineering Governance |

---

# 10. Foundation Change Impact

## 10.1 Vision Change

A Vision change SHALL trigger review of:

- Product Principles
- roadmap
- Product capability scope
- success metrics
- major ADRs
- Product Specifications
- repository narrative
- release direction

A Vision change is Level 4 unless explicitly proven editorial.

Required approvals:

- Product Governance
- Architecture
- Engineering Governance

---

## 10.2 Product Principle Change

Review:

- Engineering Laws
- ADRs implementing the principle
- Product Specifications
- AI behavior
- governance controls
- quality criteria
- repository templates
- AI agent instructions

Example:

Changing `Discover Before Asking` may affect:

```text
ADR-006

↓

Discovery Specification

↓

Orchestrator

↓

Question Policy

↓

Tests

↓

Telemetry
```

---

## 10.3 Engineering Law Change

Review:

- all governance documents
- related ADRs
- architecture constraints
- quality gates
- architecture tests
- AI coding rules
- implementation conformance
- exception records

Engineering Law changes SHALL require explicit migration from the previous law where implementations already depend on it.

---

## 10.4 AI Governance Change

Review:

- autonomy levels
- confidence thresholds
- reasoning services
- high-risk action policy
- Knowledge Candidate lifecycle
- prompt templates
- model evaluation suites
- human approval flows
- audit records
- runtime enforcement
- Security policy

Any autonomy increase SHALL be treated as security-relevant.

---

# 11. ADR Change Impact

An ADR change SHALL first be classified as:

- clarification
- amendment
- supersession
- reversal
- implementation-note update
- status transition

## 11.1 Clarification

A clarification SHALL NOT change the decision.

Review:

- wording
- affected references
- consistency with implementation

---

## 11.2 Amendment

An amendment changes part of the decision without replacing it entirely.

Review:

- downstream specifications
- components
- interfaces
- dependency rules
- tests
- existing exceptions

---

## 11.3 Supersession

A superseding ADR SHALL identify:

- replaced decision
- replacement decision
- affected artifacts
- migration plan
- compatibility period
- consumers
- completion criteria

The old ADR remains historically traceable.

---

## 11.4 ADR Status Change

Changing an ADR to `Accepted` SHALL require:

- decision-owner approval
- affected-owner consultation
- identified implementation plan

Changing to `Superseded` SHALL require a replacement reference.

---

# 12. Governance Change Impact

Changes to governance MAY affect:

- review routing
- approval requirements
- quality gates
- artifact templates
- automated checks
- contributor guidance
- AI agent behavior
- exceptions
- release criteria

Each governance rule SHALL be classified as:

- advisory
- manually enforced
- automatically enforced
- release-blocking

When governance changes from advisory to blocking:

- implementation of the gate
- rollout timing
- legacy exceptions
- remediation ownership
- failure messaging

SHALL be defined.

---

# 13. Glossary and Ontology Change Impact

## 13.1 Term Addition

Review:

- uniqueness
- synonyms
- ownership
- ontology mapping
- schema usage
- documentation consistency

---

## 13.2 Term Rename

A semantic rename SHALL preserve:

- stable ID
- previous label
- aliases
- migration guidance
- affected schemas
- affected queries
- search indexes
- generated documentation

---

## 13.3 Definition Change

Review:

- ontology entities
- relationships
- Knowledge Objects
- rules
- requirements
- schemas
- Test Cases
- reports
- AI retrieval behavior

A definition change may be breaking even when no schema changes.

---

## 13.4 Entity Split

When an ontology entity is split:

- new stable IDs are created
- original identity is deprecated or retained as parent
- existing instances are classified
- schemas are updated
- rules are reviewed
- knowledge migration is defined
- queries and reports are updated

---

## 13.5 Entity Merge

When entities merge:

- conflicts are detected
- relationship semantics are reconciled
- duplicate Knowledge Objects are resolved
- schemas and indexes are migrated
- historical identity remains traceable

---

## 13.6 Relationship Change

Changing relationship direction, cardinality, or meaning SHALL trigger review of:

- graph storage
- validation rules
- inference
- queries
- schemas
- deletion behavior
- impact-analysis logic

---

# 14. Schema Change Impact

Every schema change SHALL be classified as:

- additive compatible
- additive conditionally compatible
- behavioral
- breaking
- corrective
- deprecating

## 14.1 Optional Field Addition

Review:

- default behavior
- producer behavior
- consumer tolerance
- validation
- serialization
- documentation
- tests

An optional field may still be behaviorally breaking if its presence changes interpretation.

---

## 14.2 Required Field Addition

Generally breaking.

Requires:

- producer updates
- consumer updates
- persistence migration
- compatibility plan
- default or backfill strategy
- contract tests
- rollout sequencing

---

## 14.3 Field Removal

Breaking unless the field was previously deprecated and unused.

Review:

- all consumers
- stored data
- events
- reports
- tests
- compatibility adapters

---

## 14.4 Field Rename

Treat as remove-plus-add unless an alias or translation layer preserves compatibility.

Stable semantic identifiers SHOULD be used where possible.

---

## 14.5 Type Change

Review:

- precision
- null behavior
- serialization
- validation
- persistence
- query behavior
- UI rendering
- AI structured output
- migration

---

## 14.6 Enum Change

Adding a value may break consumers using exhaustive matching.

Removing or renaming a value is breaking.

Review:

- rules
- interfaces
- database constraints
- reports
- Test Cases
- plugin adapters

---

## 14.7 Constraint Tightening

Examples:

- smaller maximum length
- narrower format
- newly prohibited null
- reduced numeric range

Usually breaking for existing data and producers.

---

## 14.8 Constraint Relaxation

May affect:

- business validation
- security
- assumptions in consumers
- test coverage
- reports

Relaxation is not automatically low risk.

---

## 14.9 Schema Impact Checklist

```text
□ Producers identified

□ Consumers identified

□ Persisted records identified

□ Events identified

□ API contracts identified

□ Validation rules reviewed

□ Migrations defined

□ Backward compatibility assessed

□ Forward compatibility assessed

□ Contract tests updated

□ Historical data interpretation preserved
```

---

# 15. Knowledge Change Impact

## 15.1 Knowledge Object Creation

Review:

- ontology type
- schema validity
- scope
- provenance
- evidence
- conflict detection
- owner
- approval authority
- future consumers

---

## 15.2 Knowledge Object Update

Review:

- whether a new version is required
- effective date
- affected rules
- affected requirements
- affected reasoning
- executions using previous versions
- scope precedence
- conflict status
- retraining or re-indexing needs

Approved Knowledge Objects SHOULD be versioned rather than overwritten.

---

## 15.3 Knowledge Scope Change

Moving knowledge from:

```text
Project → Organization
```

or:

```text
Feature → Project
```

increases its blast radius.

Review:

- authority
- privacy
- conflicts
- inheritance
- overrides
- affected Workspaces
- validation level

Broader-scope promotion SHALL require stronger validation.

---

## 15.4 Knowledge Deprecation

Review:

- active consumers
- replacement knowledge
- affected rules
- future reasoning
- historical execution interpretation
- cache invalidation
- index updates

---

## 15.5 Knowledge Conflict Resolution

Review:

- all conflicting objects
- authority
- scope
- provenance
- validation decisions
- downstream usage
- historical decisions
- whether correction or supersession is required

---

## 15.6 Knowledge Lifecycle Policy Change

Changes to candidate approval or auto-learning may affect:

- AI Governance
- Knowledge Store
- Rule Engine
- Product behavior
- audit
- security
- quality gates
- historical candidate status

---

# 16. Rule Change Impact

Every rule change SHALL identify:

- semantic owner
- source
- affected inputs
- affected outputs
- effective scope
- effective period
- precedence
- consumers
- tests
- historical behavior

## 16.1 Rule Logic Change

Review:

- requirements
- Product behavior
- edge cases
- risk
- Test Cases
- expected results
- reports
- knowledge dependencies
- explanation output

---

## 16.2 Rule Precedence Change

High-impact because behavior may change without any individual rule changing.

Review:

- scope inheritance
- overrides
- conflicts
- resolution records
- all affected executions
- explanation behavior
- regression tests

---

## 16.3 Rule Activation or Deactivation

Review:

- effective date
- affected Workspaces
- cached decisions
- running executions
- audit
- rollback

---

## 16.4 Confidence Threshold Change

When confidence thresholds affect routing or approval, review:

- AI Governance
- user-question behavior
- auto-approval
- false-positive risk
- false-negative risk
- learning lifecycle
- telemetry
- evaluation suites

---

## 16.5 Rule Source Change

Changing a rule's authoritative source requires validation that the new authority is valid and compatible.

---

# 17. Product Specification Change Impact

A Product Specification change SHALL review:

- capability scope
- requirements
- business rules
- risks
- architecture
- components
- interfaces
- Test Strategy
- user documentation
- reports
- roadmap
- acceptance criteria

## 17.1 Capability Addition

Review:

- ownership
- Knowledge dependencies
- new interfaces
- security
- Workspace scope
- runtime needs
- plugin needs
- test strategy
- operational support

---

## 17.2 Capability Removal

Review:

- consumers
- data retention
- deprecation
- UI removal
- plugin behavior
- Knowledge Objects
- documentation
- migration
- historical evidence

---

## 17.3 Behavior Change

Review:

- requirements
- acceptance criteria
- rules
- Test Cases
- reports
- existing users
- backward compatibility
- release communication

---

## 17.4 Scope Expansion

A capability moving from one project type to all Workspaces may become a platform-wide change.

Review architecture, security, scalability, and governance.

---

# 18. Requirement Change Impact

## 18.1 Requirement Addition

Review:

- source
- owner
- priority
- business rules
- risks
- acceptance criteria
- implementation
- Test Cases
- coverage
- release target

---

## 18.2 Requirement Modification

Review:

- existing business rules
- Test Cases
- automation
- evidence
- open Bugs
- completed releases
- user documentation
- downstream reports

---

## 18.3 Requirement Removal

Review:

- reason
- Product Specification
- active implementation
- tests
- automation
- data
- reports
- unresolved Bugs
- historical traceability

Requirement history SHALL be retained.

---

## 18.4 Acceptance-Criteria Change

Review:

- Test Cases
- expected results
- automation assertions
- coverage
- open Bugs
- verification status

A previously verified requirement may require re-verification.

---

## 18.5 Priority Change

Review:

- roadmap
- release scope
- risk
- test allocation
- execution schedule
- automation investment

Priority changes generally do not change semantic behavior but may affect delivery and quality planning.

---

# 19. Risk Change Impact

## 19.1 New Risk

Review:

- affected requirement or change
- mitigation
- owner
- Test Strategy
- release criteria
- monitoring
- acceptance authority

---

## 19.2 Severity Increase

Review:

- test depth
- approval level
- release blocking
- security consultation
- rollback readiness
- monitoring

---

## 19.3 Risk Closure

Requires:

- mitigation evidence
- validation evidence
- authorized closure decision
- residual-risk statement

---

## 19.4 Risk Acceptance

Review:

- authority
- expiry
- business impact
- monitoring
- contingency
- release record

---

# 20. Test Strategy Change Impact

Review:

- scope
- covered requirements
- risks
- test levels
- environments
- data
- automation targets
- execution schedule
- quality thresholds
- release gates
- resource assumptions

Reducing test scope SHALL identify accepted risk and approver.

---

# 21. Test Case Change Impact

## 21.1 Test Case Addition

Review:

- source objective
- coverage
- data
- environment
- automation eligibility
- expected result
- owner

---

## 21.2 Test Case Modification

Review:

- requirement coverage
- automation implementation
- historical comparability
- execution reports
- expected result
- data
- linked Bugs

---

## 21.3 Test Case Removal

Review:

- coverage gap
- replacement
- obsolete requirement
- duplicate coverage
- regulatory obligations
- regression history

A Test Case SHALL NOT be removed only because it currently fails.

---

## 21.4 Expected Result Change

This may indicate:

- changed requirement
- corrected test
- changed rule
- accepted Product behavior change

The authoritative source SHALL be identified before changing the expected result.

---

# 22. Automation Change Impact

## 22.1 Locator Change

Review:

- Semantic UI entity
- locator Knowledge Object
- affected automation assets
- fallback strategy
- execution stability
- confidence
- evidence

---

## 22.2 Automation Framework Change

Review:

- Execution Engine abstraction
- adapters
- asset compatibility
- evidence formats
- CI integration
- plugins
- training
- migration
- rollback

Core Product behavior SHALL remain independent of the framework.

---

## 22.3 Assertion Change

Review:

- Test Case expected result
- business rule
- requirement
- result classification
- historical comparison

---

## 22.4 Test Data Change

Review:

- data policy
- privacy
- validity
- partition coverage
- cleanup
- environment compatibility
- determinism

---

## 22.5 Retry Change

Review:

- false-pass risk
- execution duration
- flakiness metrics
- result interpretation
- reporting
- failure evidence

Retries SHALL NOT hide deterministic Product failures.

---

# 23. Interface Change Impact

## 23.1 Additive Compatible Change

May include:

- optional request field
- optional response field
- new endpoint
- new capability flag

Review actual consumer tolerance.

---

## 23.2 Breaking Interface Change

Includes:

- required input addition
- removed field
- changed meaning
- changed error behavior
- changed lifecycle
- changed authentication
- changed ordering guarantee
- changed event semantics

Required activities:

```text
Consumer Inventory

↓

Version Strategy

↓

Migration Plan

↓

Contract Tests

↓

Compatibility Period

↓

Communication

↓

Rollout

↓

Removal
```

---

## 23.3 Error Contract Change

Review:

- retry behavior
- fallback
- user messaging
- monitoring
- plugin translation
- Test Cases
- reporting

---

## 23.4 Capability Declaration Change

Review:

- plugin selection
- runtime routing
- degraded behavior
- feature exposure
- compatibility

---

## 23.5 Event Change

Review:

- producers
- consumers
- ordering
- duplication
- idempotency
- replay
- schema registry
- retention
- historical events

---

# 24. Component Change Impact

## 24.1 Internal Refactor

May remain Level 1 if:

- interfaces remain unchanged
- behavior remains unchanged
- persistence remains compatible
- telemetry remains sufficient
- ownership remains unchanged

Required evidence:

- tests
- dependency validation
- behavior equivalence

---

## 24.2 Responsibility Change

If responsibility moves between components, review:

- Architecture Specification
- ownership
- interfaces
- data
- dependencies
- deployment
- observability
- tests
- migration

This is generally an architectural change.

---

## 24.3 Component Split

Review:

- new boundaries
- contracts
- data ownership
- deployment
- failure isolation
- observability
- transactional behavior
- migration
- ownership

---

## 24.4 Component Merge

Review:

- lost boundaries
- new coupling
- ownership
- scalability
- security
- deployment
- contract consolidation
- consumer migration

---

## 24.5 Component Removal

Review:

- all consumers
- owned data
- interfaces
- runtime registrations
- alerts
- dashboards
- documentation
- replacement capability

---

# 25. Plugin Change Impact

## 25.1 New Plugin

Review:

- approved Plugin Interface
- capability declaration
- external SDK
- security
- credentials
- configuration
- normalized errors
- Workspace enablement
- contract tests
- operations
- ownership

---

## 25.2 Plugin Upgrade

Review:

- vendor API changes
- authentication
- permission scopes
- response formats
- rate limits
- error behavior
- deprecated capabilities
- test environments
- rollback

---

## 25.3 Plugin Contract Change

Review all plugins and runtime consumers.

This is normally Level 3 or Level 4.

---

## 25.4 Plugin Removal

Review:

- enabled Workspaces
- stored configuration
- credentials
- dependent workflows
- data retention
- replacement
- communication

---

## 25.5 External Vendor Change

Vendor changes SHALL be normalized inside the plugin.

Core changes are required only when the platform contract itself must evolve.

---

# 26. Execution Engine Change Impact

Review:

- Execution Engine interface
- adapters
- orchestration
- execution plans
- evidence
- result normalization
- retries
- cancellation
- timeout behavior
- parallelism
- Workspace scope
- Security controls
- reports
- historical execution interpretation

## 26.1 New Execution Adapter

Review:

- interface conformance
- capability declaration
- external SDK
- evidence support
- error normalization
- lifecycle support
- security
- contract tests

---

## 26.2 Result Classification Change

Review:

- reporting
- Bugs
- quality gates
- historical metrics
- dashboards
- Test Cases
- release policy

---

## 26.3 Evidence Format Change

Review:

- evidence store
- reports
- Bug analysis
- retention
- privacy
- viewers
- historical access

---

# 27. Runtime Change Impact

## 27.1 Timeout Change

Review:

- user experience
- false failure
- resource usage
- plugin behavior
- retries
- execution evidence
- service-level objectives

---

## 27.2 Retry Policy Change

Review:

- idempotency
- duplicated side effects
- external rate limits
- false success
- cost
- observability

---

## 27.3 Concurrency Change

Review:

- race conditions
- data isolation
- Workspace limits
- external systems
- ordering
- evidence association
- resource capacity

---

## 27.4 Scheduling Change

Review:

- time zones
- missed runs
- duplicate runs
- Workspace quotas
- notifications
- reports
- operational support

---

## 27.5 Deployment Topology Change

Review:

- architecture
- networking
- security
- state management
- scaling
- recovery
- observability
- data residency
- cost
- rollback

---

# 28. Workspace Change Impact

Changes to Workspace architecture SHALL review:

- isolation
- identity
- membership
- authorization
- configuration
- Knowledge scope
- data
- credentials
- plugins
- executions
- evidence
- retention
- deletion
- audit

## 28.1 Workspace Scope Resolution Change

Review all scoped artifact types:

```text
Requirements

Knowledge

Rules

Semantic UI

Test Assets

Automation

Execution

Evidence

Bugs

Reports
```

---

## 28.2 Workspace Merge

Requires explicit migration for:

- identities
- Knowledge conflicts
- rules
- credentials
- configurations
- artifacts
- histories
- ownership
- access controls

---

## 28.3 Workspace Split

Requires allocation rules for every scoped artifact and relationship.

---

## 28.4 Workspace Deletion

Review:

- retention
- legal hold
- evidence
- Knowledge promotion
- credentials
- external plugins
- audit
- backups
- traceability tombstones

---

# 29. Security Change Impact

Every security-impacting change SHALL review:

- assets
- threats
- trust boundaries
- authentication
- authorization
- credentials
- encryption
- logs
- data exposure
- external content
- AI prompt injection
- destructive actions
- audit
- incident response
- rollback

Security changes require Security approval.

## 29.1 Permission Expansion

Treat as high risk.

Review:

- least privilege
- affected roles
- external scopes
- audit
- user consent
- revocation
- AI authority

---

## 29.2 Credential Handling Change

Review:

- storage
- retrieval
- rotation
- redaction
- logging
- plugin boundaries
- test fixtures
- incident response

---

## 29.3 Trust-Boundary Change

Generally requires an ADR and threat-model review.

---

## 29.4 Sensitive-Data Classification Change

Review:

- access
- retention
- evidence
- reports
- trace graph
- AI context
- external providers
- redaction

---

# 30. AI Change Impact

## 30.1 Model Provider Change

Review:

- AI provider interface
- capability compatibility
- structured output
- token limits
- data handling
- security
- latency
- cost
- evaluation results
- fallback behavior
- audit metadata

---

## 30.2 Model Version Change

A model version update SHALL be evaluated against:

- reasoning quality
- structured-output conformance
- hallucination rate
- tool-use behavior
- safety
- latency
- cost
- confidence calibration
- regression suite

---

## 30.3 Prompt Template Change

Review:

- capability behavior
- input schema
- output schema
- hidden business logic
- security
- prompt injection
- evaluation suite
- token usage
- model compatibility

---

## 30.4 Autonomy Change

Increasing autonomy SHALL review:

- AI Governance
- Security
- human approval
- rollback
- audit
- execution permissions
- knowledge promotion
- error recovery

---

## 30.5 Confidence Threshold Change

Review:

- user-question rate
- auto-generation
- review volume
- false acceptance
- false rejection
- learning decisions
- telemetry
- evaluation data

---

## 30.6 AI Context Change

Review:

- Knowledge retrieval
- source authority
- scope
- privacy
- prompt size
- stale knowledge
- conflicting knowledge
- provenance
- deterministic rule order

---

## 30.7 Controlled Learning Change

Review:

- candidate lifecycle
- validator authority
- auto-approval policy
- knowledge categories
- conflicts
- audit
- rollback
- historical candidates
- business-rule protection

---

# 31. Persistence Change Impact

## 31.1 Database Technology Change

Review:

- repository interfaces
- data migration
- consistency
- transactions
- indexing
- query behavior
- backups
- recovery
- operations
- performance
- security

Domain behavior SHALL remain independent of the database technology.

---

## 31.2 Table or Collection Change

Review:

- schemas
- repositories
- migration
- historical data
- queries
- reports
- retention
- rollback

---

## 31.3 Index Change

Review:

- performance
- write cost
- storage
- query semantics
- operational rollout

---

## 31.4 Data Migration

Every migration SHALL define:

```yaml
migration_id:
source_version:
target_version:
affected_data:
preconditions:
transformation:
validation:
rollback:
owner:
execution_order:
evidence:
```

---

## 31.5 Irreversible Migration

Requires:

- backup
- simulation
- approval
- verification
- contingency
- explicit risk acceptance

---

# 32. Configuration Change Impact

Configuration changes SHALL be classified as:

- environment-only
- Workspace-scoped
- organization-scoped
- global
- security-sensitive
- behavior-changing

Review:

- schema
- defaults
- inheritance
- overrides
- validation
- rollout
- rollback
- secrets
- documentation
- telemetry

A configuration change that alters business behavior SHALL be governed like a behavioral change.

---

# 33. Dependency Change Impact

## 33.1 New Dependency

Review:

- ownership
- purpose
- license
- security
- maintenance
- transitive dependencies
- vendor lock-in
- replacement
- runtime size
- data access
- boundary compliance

---

## 33.2 Dependency Upgrade

Review:

- release notes
- breaking changes
- vulnerabilities
- runtime behavior
- API changes
- transitive changes
- license
- rollback
- compatibility tests

---

## 33.3 Dependency Removal

Review:

- consumers
- replacement behavior
- generated artifacts
- build
- operations
- documentation

---

## 33.4 Vendor SDK Dependency

Vendor SDKs SHALL remain inside approved adapter boundaries.

An upgrade SHALL not force vendor types into Core contracts.

---

# 34. Observability Change Impact

Changes to logs, metrics, traces, and alerts SHALL review:

- incident detection
- dashboards
- reports
- privacy
- data volume
- retention
- operational runbooks
- service-level objectives
- audit
- cost

Removing telemetry requires validation that no quality gate, alert, or audit depends on it.

---

# 35. Report and Metric Change Impact

## 35.1 Metric Formula Change

Review:

- source data
- historical comparability
- dashboards
- quality gates
- stakeholder decisions
- release reports
- documentation

Metric versioning SHOULD be used when historical meaning changes.

---

## 35.2 Report Field Change

Review:

- consumers
- exports
- APIs
- dashboards
- automation
- documentation

---

## 35.3 Filter or Aggregation Change

Review:

- conclusions
- coverage
- historical trends
- stakeholder expectations
- audit

---

# 36. Documentation Change Impact

Documentation changes SHALL identify whether the document is:

- normative
- informative
- generated
- example
- reference
- playbook

Changes to normative documentation may require implementation updates.

Changes to informative documentation usually follow the authoritative artifact.

A documentation update SHALL NOT redefine behavior owned elsewhere.

---

# 37. Template Change Impact

Template changes may affect all future artifacts created from them.

Review:

- required metadata
- ownership
- traceability fields
- quality gates
- AI instructions
- compatibility with existing artifacts
- playbooks

Templates SHOULD be versioned when structural expectations change.

---

# 38. Playbook Change Impact

Review:

- governance policy
- affected operators
- automation
- approval steps
- quality gates
- incident behavior
- release process
- training

A playbook SHALL not conflict with its governing specification or policy.

---

# 39. Repository Structure Change Impact

Changes to top-level directories or artifact placement SHALL review:

- SPEC-007
- MANIFEST
- indexes
- reading order
- AI instructions
- scripts
- CI validation
- documentation links
- generators
- ownership
- migration

Repository restructuring generally requires Architecture and Engineering Governance approval.

---

# 40. File Rename and Move Impact

A file rename or move SHALL preserve:

- stable artifact ID
- version history
- inbound references
- outbound references
- indexes
- generated navigation
- ownership metadata
- archive links

A compatibility redirect or reference map SHOULD exist where external consumers use paths.

---

# 41. Artifact Status Change Impact

## 41.1 Draft to Accepted

Requires:

- owner
- required approval
- traceability
- quality checks
- dependency validation
- downstream action plan

---

## 41.2 Accepted to Deprecated

Requires:

- reason
- replacement
- affected consumers
- migration timeline
- support window

---

## 41.3 Deprecated to Archived

Requires:

- migration completion
- no unsupported active consumers
- retained history
- updated indexes

---

## 41.4 Rejected Artifact

Rejected artifacts SHALL not remain referenced as authoritative.

---

# 42. Ownership Change Impact

An ownership change SHALL review:

- authority
- scope
- affected artifacts
- open changes
- exceptions
- operational obligations
- approval routes
- contact metadata
- access
- machine-readable indexes

Ownership transfer SHALL follow `governance/OWNERSHIP_MATRIX.md`.

---

# 43. Change-to-Reviewer Matrix

| Change Area | Required Reviewer or Approver |
|---|---|
| Vision or Product Principle | Product Governance |
| Engineering Law | Engineering Governance and Architecture |
| ADR | Architecture |
| Governance | Engineering Governance |
| AI policy | AI Governance |
| Security boundary | Security |
| Ontology | Ontology Steward and Knowledge Governance |
| Schema | Schema Steward |
| Business Rule | Domain Owner and Rule Governance |
| Knowledge lifecycle | Knowledge Governance |
| Product behavior | Product Capability Owner |
| Architecture boundary | Architecture |
| Component internals | Component Owner or delegated reviewer |
| Interface | Interface Owner and affected consumers |
| Plugin | Plugin Owner, Interface Owner, Security |
| Execution safety | Execution Platform Owner and Security |
| Workspace isolation | Architecture and Security |
| Data migration | Data Owner and Platform Operations |
| Test Strategy | Quality Engineering |
| Release | Release Owner |
| Operational process | Platform Operations |

---

# 44. Change-to-Test Matrix

| Change Type | Minimum Validation |
|---|---|
| Editorial | format and link validation |
| Metadata | metadata schema and index validation |
| Ontology | ontology validation, schema and knowledge regression |
| Schema | schema validation, contract tests, migration tests |
| Rule | unit tests, boundary tests, Product regression |
| Knowledge Object | provenance, conflict, scope-resolution tests |
| Requirement | coverage review and affected Test Cases |
| Product behavior | functional, integration, regression tests |
| Architecture | architecture tests and dependency checks |
| Interface | contract tests, provider and consumer tests |
| Component | unit and integration tests |
| Plugin | contract, integration, security tests |
| Execution Engine | lifecycle, adapter, evidence, failure tests |
| Runtime | operational, recovery, performance tests |
| Workspace | isolation and authorization tests |
| Security | security validation and threat-model review |
| AI model | evaluation suite and structured-output validation |
| Prompt | prompt evaluation and safety tests |
| Migration | forward, rollback, integrity, idempotency tests |
| Report | metric reconciliation and historical comparison |
| Release process | release rehearsal or pipeline validation |

---

# 45. Change-to-Documentation Matrix

| Changed Artifact | Documentation to Review |
|---|---|
| Foundation | README, ROADMAP, governance, AI instructions |
| ADR | related specifications and architecture diagrams |
| Governance | checklists, quality gates, playbooks |
| Ontology | glossary, schemas, examples |
| Schema | interface docs, examples, migrations |
| Rule | rule catalog, Product behavior docs, tests |
| Product Specification | requirements, user docs, roadmap |
| Interface | API docs, plugin docs, consumer guides |
| Component | component spec, operational docs |
| Plugin | plugin reference, configuration docs |
| Runtime | runbooks, deployment docs |
| Security | security guidance, incident playbooks |
| AI | model registry, evaluation docs, prompt registry |
| Workspace | administration docs and isolation policy |
| Release | changelog and migration guide |

---

# 46. Change-to-Data Matrix

| Change | Data Impact Questions |
|---|---|
| Schema field addition | Is backfill needed? What is the default? |
| Field removal | Is historical data retained? |
| Type change | Can existing values convert safely? |
| Enum change | Are unknown values tolerated? |
| Rule change | Are stored decisions recalculated? |
| Knowledge update | Are caches and indexes refreshed? |
| Scope change | Does data move between authority levels? |
| Workspace change | Is isolation preserved? |
| Interface change | Are stored events replayable? |
| Metric change | Is historical comparison still valid? |
| Retention change | Which data may be deleted or archived? |
| Security classification change | Must access and encryption change? |
| Plugin removal | What integration metadata remains? |
| Artifact deletion | Are tombstones required? |

---

# 47. Change-to-Release Matrix

## Patch Release Candidate

Usually:

- backward-compatible defect fix
- editorial or metadata correction
- compatible internal improvement
- security patch without contract break

---

## Minor Release Candidate

Usually:

- backward-compatible capability addition
- optional interface extension
- new plugin
- compatible schema addition
- new governed rule without breaking existing behavior

---

## Major Release Candidate

Usually:

- breaking interface
- changed architecture contract
- incompatible schema
- changed Workspace model
- changed Knowledge authority
- removed capability
- changed execution contract
- changed major runtime assumptions

Release classification SHALL follow repository versioning policy.

---

# 48. Compatibility Analysis

Every potentially breaking change SHALL assess:

## 48.1 Backward Compatibility

Can the new provider work with an old consumer or old data?

---

## 48.2 Forward Compatibility

Can the old provider or consumer tolerate new data or behavior?

---

## 48.3 Data Compatibility

Can historical data be read and interpreted?

---

## 48.4 Behavioral Compatibility

Does the same input produce meaningfully compatible behavior?

---

## 48.5 Operational Compatibility

Can the change coexist during rollout?

---

## 48.6 Security Compatibility

Does compatibility preserve security policy?

Compatibility mechanisms SHALL NOT preserve insecure behavior solely for convenience.

---

# 49. Consumer Impact Analysis

For each changed contract, identify:

```yaml
consumer_id:
owner:
version:
usage:
criticality:
required_change:
migration_status:
validation_status:
release_target:
```

Consumers include:

- components
- plugins
- Workspaces
- external API users
- automation assets
- reports
- runtime services
- AI agents
- repository generators

Unknown consumers SHALL be recorded as risk.

---

# 50. Migration Analysis

Every migration SHALL answer:

1. What moves or changes?
2. Which versions are supported?
3. Who owns migration?
4. What is the order?
5. Can old and new versions coexist?
6. Is dual-write or translation required?
7. How is success validated?
8. How is rollback performed?
9. What happens to failed records?
10. How is progress observed?
11. When is old behavior removed?
12. Which evidence proves completion?

---

# 51. Rollout Strategy

Possible rollout strategies include:

- all-at-once
- Workspace-by-Workspace
- organization-by-organization
- feature flag
- canary
- percentage rollout
- shadow execution
- dual-read
- dual-write
- compatibility adapter
- opt-in preview
- parallel plugin versions

The strategy SHALL match change risk and reversibility.

---

# 52. Rollback Impact

A rollback plan SHALL consider:

- code
- schemas
- data
- rules
- Knowledge Objects
- configuration
- plugins
- runtime state
- external side effects
- audit
- user-visible behavior

Code rollback alone may be insufficient after an irreversible data or external-system change.

---

# 53. Impact on Historical Records

Changes SHALL preserve interpretation of:

- past requirements
- previous rules
- Knowledge Object versions
- historical executions
- evidence
- Bugs
- reports
- releases
- approvals

Historical records SHALL retain references to the versions that governed them.

A current rule SHALL NOT be retroactively applied to a historical execution unless explicitly performing re-analysis.

---

# 54. Impact on Generated Artifacts

Generated artifacts MAY include:

- indexes
- repository graphs
- API documentation
- schema documentation
- reports
- AI context packs
- navigation pages
- dependency graphs
- ownership indexes

When their sources change, generated artifacts SHALL be:

```text
Regenerated

↓

Validated

↓

Committed or Published
```

Stale generated artifacts SHALL be detected where practical.

---

# 55. Impact on AI Context

Changes to authoritative artifacts may affect AI context construction.

Review:

- reading order
- selected specifications
- relevant ADRs
- ontology
- rules
- knowledge retrieval
- prompt inputs
- context size
- conflicting versions
- deprecated artifacts

AI agents SHALL not continue using superseded artifacts because a cached context remains available.

---

# 56. Impact on Controlled Learning

Changes may invalidate learned knowledge.

Review whether existing Knowledge Objects were derived from:

- old business rules
- old UI structure
- old API behavior
- old requirements
- old plugin versions
- old environment assumptions

Affected knowledge SHALL be:

- revalidated
- superseded
- scope-reduced
- deprecated
- or retained with a historical effective period

---

# 57. Impact on UI Knowledge Graph

Changes to UI or semantic models may affect:

- screens
- elements
- actions
- relationships
- locator knowledge
- feature mapping
- Test Cases
- automation
- risk
- discovered workflows

A changed selector alone should update evidence and locator knowledge.

A changed semantic meaning may require ontology, requirement, and test updates.

---

# 58. Impact on Discovery

Review whether a change affects:

- discovery sources
- authorization
- source priority
- evidence quality
- semantic normalization
- question policy
- confidence
- user escalation
- learning candidates

Changes to discovery order may alter what the system asks users and what knowledge it proposes.

---

# 59. Impact on Reporting

Any change to:

- result classification
- requirement status
- risk status
- coverage calculation
- rule outcome
- execution evidence
- Bug lifecycle
- release scope

may affect reports.

Reports SHALL identify metric and source versions when meaning changes.

---

# 60. Impact Analysis Workflow

The canonical workflow is:

```text
1. Register Change

↓

2. Classify Change Type

↓

3. Identify Changed Artifact

↓

4. Resolve Owner

↓

5. Traverse Incoming Relationships

↓

6. Traverse Outgoing Relationships

↓

7. Inspect Dependencies

↓

8. Inspect Scope and Workspace

↓

9. Identify Consumers

↓

10. Determine Compatibility

↓

11. Determine Security and AI Impact

↓

12. Determine Data and Migration Impact

↓

13. Determine Validation Scope

↓

14. Determine Reviewers

↓

15. Determine Release Strategy

↓

16. Record Risks and Unknowns

↓

17. Approve Analysis

↓

18. Implement

↓

19. Verify

↓

20. Close Impact Record
```

---

# 61. Impact Analysis Record

Every Level 2 or higher change SHOULD use a structured impact record.

Recommended schema:

```yaml
change_id:
title:
status:
requested_by:
accountable_owner:
change_type:
impact_level:
severity:
scope:
changed_artifacts:
reason:
expected_outcome:

direct_impacts:
indirect_impacts:
affected_owners:
affected_consumers:
affected_workspaces:
affected_interfaces:
affected_schemas:
affected_rules:
affected_knowledge:
affected_components:
affected_plugins:
affected_runtime:
affected_data:
affected_security:
affected_ai:
affected_tests:
affected_documents:
affected_operations:

breaking_change:
compatibility:
migration_required:
migration_plan:
rollout_strategy:
rollback_plan:

risks:
unknowns:
assumptions:
exceptions:

required_reviews:
required_approvals:
validation_plan:
quality_gates:
release_target:

implementation_evidence:
validation_evidence:
completed_at:
```

---

# 62. Machine-Readable Impact Graph

Impact analysis SHOULD use:

```text
meta/REPOSITORY_GRAPH.yaml
```

and MAY maintain:

```text
meta/CHANGE_IMPACT_INDEX.yaml
```

Recommended relationship queries:

```text
changed artifact

↓

incoming relationships

↓

outgoing relationships

↓

transitive dependents

↓

owners

↓

validation assets

↓

releases
```

The impact engine SHALL respect:

- relationship types
- lifecycle status
- versions
- scope
- Workspace authorization
- ownership
- dependency classification

---

# 63. Impact Traversal Rules

## 63.1 Upstream Traversal

Traverse upstream to determine:

- governing intent
- decision authority
- semantic ownership
- whether the change is permitted
- whether a higher artifact must change first

---

## 63.2 Downstream Traversal

Traverse downstream to determine:

- consumers
- implementation
- tests
- automation
- runtime
- evidence
- reports
- releases

---

## 63.3 Transitive Traversal

Transitive traversal SHALL have:

- cycle detection
- depth controls
- relationship filtering
- scope authorization
- version awareness

---

## 63.4 Relationship Filtering

Not every relationship implies change.

Examples:

- `implements` usually indicates direct impact
- `validates` indicates test review
- `evidenced_by` may require historical preservation, not modification
- `supersedes` indicates lifecycle impact
- `related_to` alone is insufficient to infer mandatory change

---

# 64. Impact Confidence

Automated or AI-assisted impact recommendations MAY include confidence.

Confidence SHALL reflect:

- graph completeness
- relationship precision
- ownership resolution
- consumer discovery
- version certainty
- scope certainty

Suggested classifications:

```text
Confirmed

Probable

Possible

Unknown
```

Confidence SHALL NOT replace human approval for high-impact changes.

---

# 65. Unknown Impact Handling

Unknown impact SHALL be recorded when:

- relationships are missing
- consumers are undiscovered
- ownership is unclear
- legacy behavior is undocumented
- external vendor behavior is uncertain
- historical data is not understood
- Workspace usage cannot be enumerated

Possible responses:

- block change
- perform discovery
- use staged rollout
- add telemetry
- create compatibility layer
- limit scope
- obtain risk acceptance

---

# 66. Change Risk Scoring

A change-risk model MAY consider:

| Factor | Example Scale |
|---|---|
| Authority level | implementation to Foundation |
| Blast radius | local to global |
| Reversibility | easy to irreversible |
| Data impact | none to destructive |
| Security impact | none to trust-boundary change |
| AI autonomy impact | none to autonomous destructive action |
| Consumer count | one to unknown or platform-wide |
| Compatibility | fully compatible to breaking |
| Test confidence | comprehensive to absent |
| Operational complexity | none to coordinated migration |

The scoring algorithm SHALL be represented as a governed deterministic rule if used for approvals.

---

# 67. Review Requirements by Impact Level

## Level 0

Required:

- artifact owner or delegated reviewer

---

## Level 1

Required:

- component or artifact owner
- relevant automated validation

---

## Level 2

Required:

- domain owner
- affected contract or schema owner
- Quality Engineering where behavior changes

---

## Level 3

Required:

- Architecture
- affected owners
- migration owner
- Security or AI Governance where relevant
- Release coordination

---

## Level 4

Required:

- Architecture
- Engineering Governance
- Product Governance
- relevant specialized governance
- Security
- formal rollout and rollback approval

---

# 68. Change Approval Gates

A change SHALL NOT be approved until applicable gates pass.

## Classification Gate

```text
□ Change type identified

□ Scope identified

□ Impact level identified

□ Severity identified
```

## Ownership Gate

```text
□ Accountable owner identified

□ Affected owners identified

□ Required approvers identified
```

## Traceability Gate

```text
□ Upstream authority identified

□ Downstream consumers identified

□ Broken relationships resolved

□ New relationships recorded
```

## Compatibility Gate

```text
□ Backward compatibility assessed

□ Forward compatibility assessed

□ Historical interpretation assessed

□ Breaking status declared
```

## Migration Gate

```text
□ Migration need assessed

□ Migration plan exists when required

□ Rollback is defined

□ Migration owner is assigned
```

## Security and AI Gate

```text
□ Security impact assessed

□ AI autonomy impact assessed

□ Workspace isolation assessed

□ Sensitive-data impact assessed
```

## Validation Gate

```text
□ Required tests identified

□ Regression scope identified

□ Evidence requirements identified

□ Quality gates identified
```

## Release Gate

```text
□ Rollout strategy defined

□ Consumer communication defined

□ Operational readiness reviewed

□ Release classification determined
```

---

# 69. Change Impact Anti-Patterns

## 69.1 File-Only Analysis

```text
Changed File

↓

Only Review Changed File
```

Invalid.

---

## 69.2 Implementation-First Change

```text
Modify Code

↓

Update Specification Later
```

Invalid for governed behavior.

---

## 69.3 Test-Only Expected Result Update

Changing an expected result to match current implementation without validating the requirement is prohibited.

---

## 69.4 Hidden Breaking Change

Labeling a breaking behavior change as an internal refactor is prohibited.

---

## 69.5 Schema-Only Migration

Updating a schema without migrating persistence, consumers, and tests is incomplete.

---

## 69.6 Prompt Patch as Business Fix

Changing a prompt to alter deterministic business behavior without changing the authoritative rule is prohibited.

---

## 69.7 Global Change Through Configuration

Using global configuration to bypass architecture or governance review is prohibited.

---

## 69.8 Unknown Consumers Ignored

A lack of consumer inventory SHALL increase risk rather than reduce it.

---

## 69.9 Historical Overwrite

Overwriting rule or knowledge history so historical executions cannot be reconstructed is prohibited.

---

## 69.10 AI-Generated Impact Accepted Without Validation

AI impact suggestions are candidates, not final authority.

---

# 70. Change Impact Exceptions

An exception MAY be approved when full analysis or remediation cannot be completed before a necessary change.

Exception metadata:

```yaml
id:
change_id:
missing_analysis:
reason:
risk:
scope:
affected_artifacts:
mitigation:
monitoring:
owner:
approved_by:
created_at:
expires_at:
resolution_plan:
```

Exceptions SHALL be:

- explicit
- time-bounded
- reviewable
- visible in release evidence

An expired exception becomes an active governance violation.

---

# 71. Violation Severity

## Critical Violations

Examples:

- security-impacting change without Security review
- cross-Workspace change without isolation analysis
- destructive migration without rollback or approved irreversibility
- AI autonomy increase without authorization
- Knowledge authority change without governance
- credential contract change without Security approval

Critical violations block implementation, merge, and release.

---

## High Violations

Examples:

- breaking interface without consumer analysis
- rule change without Domain Owner approval
- schema change without migration assessment
- architecture change without ADR
- Product behavior change without requirement and test updates
- release without impact evidence

High violations block merge or release.

---

## Medium Violations

Examples:

- incomplete documentation impact
- missing non-critical consumer
- outdated generated index
- incomplete operational review
- weak rollback detail for reversible change

Medium violations require remediation or approved exception.

---

## Low Violations

Examples:

- minor metadata omission
- non-authoritative example not updated
- optional notification omitted
- low-risk internal documentation stale

Low violations SHOULD be corrected during maintenance.

---

# 72. Automated Impact Analysis

The repository SHOULD automate:

- reverse-reference lookup
- transitive dependency discovery
- owner resolution
- consumer inventory
- broken-link detection
- schema-consumer detection
- rule-consumer detection
- Test Case coverage lookup
- plugin-contract impact
- Workspace scope detection
- version compatibility checks
- generated-artifact staleness
- exception expiry
- release inclusion

Suggested tests and tools:

```text
tests/governance/test_change_impact_metadata.*

tests/governance/test_breaking_change_declaration.*

tests/governance/test_consumer_inventory.*

tests/governance/test_migration_requirements.*

tests/governance/test_generated_artifact_staleness.*

tests/governance/test_change_exception_expiry.*
```

---

# 73. AI Agent Instructions

Before modifying an accepted artifact, an AI agent SHALL:

1. identify the artifact ID and version
2. classify the change
3. locate the accountable owner
4. retrieve upstream authorities
5. retrieve direct downstream relationships
6. inspect transitive dependencies
7. identify affected schemas, rules, knowledge, interfaces, and components
8. identify affected Test Cases and automation
9. assess Workspace and scope impact
10. assess security and AI-governance impact
11. determine whether the change is breaking
12. identify migrations and compatibility requirements
13. identify required reviewers
14. produce an impact summary
15. preserve unknowns and uncertainty
16. update traceability and indexes
17. avoid implementation when critical impact remains unresolved

An AI agent MUST NOT:

- claim no impact without evidence
- hide breaking changes
- invent consumers
- fabricate compatibility
- change expected tests merely to match implementation
- overwrite historical artifacts
- promote a change without owner authority
- treat generated impact analysis as final approval
- bypass Security, Architecture, Product, or Knowledge Governance
- use prompt changes to conceal rule changes

---

# 74. Change Impact Review Checklist

## Classification

```text
□ Change categories are identified.

□ Scope is explicit.

□ Impact level is assigned.

□ Risk severity is assigned.

□ Editorial changes do not alter normative meaning.
```

## Authority and Ownership

```text
□ The authoritative artifact is changed first.

□ The accountable owner is identified.

□ Affected owners are identified.

□ Required approvers are identified.

□ Ownership changes follow governance.
```

## Traceability

```text
□ Incoming relationships are reviewed.

□ Outgoing relationships are reviewed.

□ Transitive consumers are reviewed.

□ Stable identifiers are preserved.

□ Historical relationships remain interpretable.
```

## Architecture and Dependencies

```text
□ Architectural impact is assessed.

□ Dependency direction remains valid.

□ New dependencies are reviewed.

□ No hidden cross-component coupling is introduced.

□ ADR requirements are evaluated.
```

## Semantics, Schemas, and Rules

```text
□ Ontology impact is assessed.

□ Schema compatibility is assessed.

□ Rule behavior and precedence are assessed.

□ Knowledge conflicts and stale knowledge are assessed.

□ Scope resolution remains valid.
```

## Product and Requirements

```text
□ Product behavior impact is assessed.

□ Requirements and acceptance criteria are updated.

□ Risks are reviewed.

□ User-visible changes are identified.

□ Roadmap and release scope are reviewed.
```

## Interfaces and Consumers

```text
□ Providers are identified.

□ Consumers are identified.

□ Contract tests are updated.

□ Breaking changes are declared.

□ Deprecation and migration are defined.
```

## Data and Workspace

```text
□ Persisted data impact is assessed.

□ Migration and rollback are defined.

□ Workspace isolation is preserved.

□ Retention and historical interpretation are preserved.

□ Cross-Workspace impact is authorized.
```

## AI and Security

```text
□ AI autonomy impact is assessed.

□ Model and prompt evaluations are identified.

□ Security review is complete where required.

□ Credential and sensitive-data impact is assessed.

□ External-content trust is reviewed.
```

## Validation

```text
□ Test scope is proportional to risk.

□ Regression tests are identified.

□ Migration tests are defined.

□ Operational validation is defined.

□ Required evidence is identified.
```

## Release and Operations

```text
□ Release classification is correct.

□ Rollout strategy is defined.

□ Rollback strategy is defined.

□ Monitoring is updated.

□ Consumer communication is planned.
```

## Completion

```text
□ Derived artifacts are regenerated.

□ Indexes are updated.

□ Changelog is updated.

□ Exceptions are recorded.

□ Validation evidence is attached.
```

---

# 75. Definition of Done

This document is complete when:

- change types are defined
- impact levels and severity are defined
- all major artifact families have impact rules
- Foundation, ADR, governance, ontology, schema, knowledge, rule, Product, requirement, test, automation, interface, component, plugin, execution, runtime, Workspace, security, AI, data, and release impact are covered
- migration and compatibility analysis are defined
- reviewer and test matrices are defined
- machine-readable impact records are defined
- automated impact expectations are defined
- exception and violation handling are defined
- AI agent guidance is defined

Change-impact governance implementation is complete when:

- every Level 2 or higher change has an impact record
- repository relationships support impact traversal
- consumer inventories can be generated
- breaking changes are detected or explicitly declared
- schema and interface migrations are enforced
- required reviewers are resolved automatically
- test scope can be derived from traceability
- generated artifact staleness is detected
- expired exceptions are reported
- critical and high violations block acceptance
- release records include impact and validation evidence

---

# 76. Summary

QA Intelligence SHALL treat every governed change as an impact graph.

The canonical process is:

```text
Identify Change

↓

Classify Change

↓

Locate Authority

↓

Locate Owner

↓

Traverse Relationships

↓

Identify Consumers

↓

Assess Compatibility

↓

Assess Data and Migration

↓

Assess Security and AI

↓

Assess Validation

↓

Plan Rollout and Rollback

↓

Approve

↓

Implement

↓

Verify

↓

Release

↓

Preserve Evidence
```

Foundation changes affect direction.

ADR changes affect architecture.

Ontology changes affect meaning.

Schema changes affect structure.

Knowledge changes affect future reasoning.

Rule changes affect deterministic behavior.

Product changes affect requirements and outcomes.

Interface changes affect providers and consumers.

Component changes affect implementation boundaries.

Plugin changes affect external integrations.

Runtime changes affect execution and operation.

Workspace changes affect isolation and scope.

Security changes affect trust and authority.

AI changes affect probabilistic behavior and autonomy.

Data changes affect persistence and history.

Test changes affect confidence.

Release changes affect delivery and recovery.

A change is not complete when one file is updated.

A change is complete only when every material effect is identified, owned, migrated where necessary, validated, approved, released, and traceable.
