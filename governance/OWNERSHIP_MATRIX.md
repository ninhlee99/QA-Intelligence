---
id: GOV-005
title: Ownership Matrix
version: 1.0.0
status: accepted
owner:
  - Engineering Governance
  - Architecture
depends_on:
  - SPEC-003
  - SPEC-004
  - SPEC-006
  - SPEC-007
  - GOV-001
  - GOV-002
  - GOV-003
  - GOV-004
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

# Ownership Matrix

## 1. Purpose

This document defines ownership, accountability, approval authority, and responsibility boundaries across the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- assign one authoritative owner to every governed responsibility
- prevent duplicated or ambiguous ownership
- define who may create, approve, modify, deprecate, and operate artifacts
- separate business ownership from technical implementation
- distinguish decision authority from execution responsibility
- provide deterministic routing for engineering reviews
- support human and AI contribution governance
- make ownership machine-verifiable where practical

This document answers the following questions:

- Who owns this concept?
- Who may change it?
- Who must approve the change?
- Who implements it?
- Who is consulted?
- Who operates it?
- Who resolves conflicts?
- Who is accountable when ownership boundaries are violated?

Every authoritative artifact, platform capability, and lifecycle transition SHALL have an identified owner.

Unowned authoritative behavior is prohibited.

---

# 2. Ownership Philosophy

Ownership means authority combined with accountability.

An owner is not merely the person or module that currently edits an artifact.

An owner is the party responsible for:

- correctness
- lifecycle
- compatibility
- review
- conflict resolution
- deprecation
- governance compliance
- communication to dependents

The system SHALL prefer:

```text
One Authoritative Owner

↓

Multiple Governed Contributors

↓

Explicit Consumers
```

The system SHALL avoid:

```text
Multiple Implicit Owners

↓

Conflicting Definitions

↓

Unclear Accountability
```

Ownership SHALL follow responsibility, not organizational convenience.

---

# 3. Ownership Principles

## 3.1 One Authoritative Owner

Every governed concept SHALL have exactly one authoritative owner.

Multiple contributors MAY collaborate.

Multiple reviewers MAY approve.

Multiple consumers MAY depend on the artifact.

Only one owner SHALL possess final responsibility for the authoritative definition.

---

## 3.2 Ownership Does Not Imply Exclusive Contribution

An owner MAY accept contributions from:

- other engineering teams
- domain experts
- product owners
- security reviewers
- users
- external systems
- AI agents

Contributors SHALL NOT become authoritative owners merely by creating or modifying content.

---

## 3.3 Implementation Does Not Own Intent

The module implementing a capability SHALL NOT automatically own:

- product intent
- business rules
- ontology
- governance
- architecture decisions
- knowledge truth

Implementation ownership and semantic ownership are separate.

---

## 3.4 Consumers Do Not Redefine Providers

A consumer SHALL NOT redefine the contract or meaning owned by a provider.

When a consumer requires a change, it SHALL submit the change to the authoritative owner.

---

## 3.5 Ownership Is Explicit

Ownership SHALL be declared in:

- artifact metadata
- component specifications
- interface specifications
- rule metadata
- schema metadata
- Knowledge Object metadata
- plugin registration
- runtime configuration where applicable

Ownership SHALL NOT be inferred only from:

- directory location
- source-code authorship
- Git history
- current maintainer
- organizational assumptions
- conversation context

---

## 3.6 Ownership Is Versioned

Ownership changes SHALL be recorded.

A change of owner SHALL identify:

- previous owner
- new owner
- effective date
- transferred responsibilities
- outstanding risks
- pending changes
- approval
- affected artifacts

Ownership SHALL NOT change silently.

---

## 3.7 Authority Follows Scope

An owner may authorize changes only within its approved scope.

For example:

- a project owner may govern project-level knowledge
- an organization owner may govern organization-level policy
- a global architecture owner may govern platform-wide boundaries
- a plugin owner may govern the plugin implementation but not product rules

Narrower-scope ownership SHALL NOT override broader authoritative policy unless the policy explicitly permits scoped override.

---

## 3.8 High-Risk Decisions Require Independent Approval

The owner MAY propose a high-risk change.

Where required by governance, the owner SHALL NOT be the sole approver.

High-risk changes include:

- security policy changes
- architecture boundary changes
- destructive runtime capabilities
- business-rule learning
- credential handling changes
- Workspace isolation changes
- breaking interface changes
- changes to AI autonomy

---

# 4. Responsibility Model

QA Intelligence uses the following responsibility classifications.

## 4.1 Accountable Owner — A

The party ultimately accountable for correctness and lifecycle.

There SHALL be exactly one accountable owner for each governed responsibility.

---

## 4.2 Responsible Implementer — R

The party performing the work.

There MAY be multiple responsible implementers.

A responsible implementer SHALL operate within the owner's contract.

---

## 4.3 Approver — P

The party authorized to accept or reject a change.

Approval MAY be required from multiple parties for high-risk changes.

The accountable owner and approver MAY be the same only when governance permits it.

---

## 4.4 Consulted — C

A party whose expertise or impact assessment is required before a decision.

Consultation is bidirectional.

A consulted party is expected to review and respond.

---

## 4.5 Informed — I

A party that SHALL be notified after a decision or change.

Information flow is primarily one-way.

---

## 4.6 Operator — O

The party responsible for runtime operation, monitoring, incident response, and recovery.

Operational ownership does not grant semantic ownership.

---

## 4.7 Validator — V

The party responsible for validating evidence, conformance, or learned knowledge.

Validation does not automatically grant modification authority.

---

# 5. Canonical Roles

The governance model defines roles independently of current organizational structure.

One person or team MAY perform multiple roles when segregation-of-duty rules permit it.

## 5.1 Product Governance

Owns:

- product vision
- product scope
- capability intent
- user outcomes
- product priority
- acceptance of product-level behavior

Does not own:

- technical architecture
- implementation technology
- runtime infrastructure
- schema mechanics

---

## 5.2 Architecture

Owns:

- architectural boundaries
- dependency direction
- platform abstractions
- system decomposition
- cross-domain contracts
- architectural exceptions
- accepted ADR lifecycle

Does not own:

- individual business rules
- project-specific knowledge
- vendor implementation details
- daily runtime operation

---

## 5.3 Engineering Governance

Owns:

- repository governance
- artifact lifecycle policy
- review policy
- quality gates
- traceability requirements
- governance automation
- repository-wide compliance

Does not own:

- product capability meaning
- domain-specific business knowledge
- component implementation

---

## 5.4 AI Governance

Owns:

- AI autonomy levels
- confidence policy
- validation requirements
- AI safety constraints
- controlled learning policy
- AI provider governance
- high-risk AI action policy

Does not own:

- model-provider implementation
- Product feature priority
- general runtime infrastructure

---

## 5.5 Knowledge Governance

Owns:

- Knowledge Object lifecycle
- Knowledge Candidate policy
- classification policy
- conflict policy
- approval policy
- scope policy
- provenance requirements
- knowledge deprecation

Does not own:

- source observations
- Product behavior
- persistence implementation
- external discovery systems

---

## 5.6 Ontology Steward

Owns:

- semantic definitions
- entity types
- relationship types
- taxonomies
- semantic constraints
- terminology consistency

Does not own:

- serialization structure
- persistence tables
- business-rule execution
- UI implementation

---

## 5.7 Schema Steward

Owns:

- machine-validatable structures
- schema composition
- schema versioning
- compatibility declarations
- schema validation requirements

Does not own:

- semantic meaning
- business decisions
- persistence technology
- Product intent

---

## 5.8 Rule Governance

Owns:

- deterministic rule lifecycle
- rule identifiers
- rule classification
- rule precedence
- conflict resolution
- rule versioning
- rule validation requirements

Domain experts MAY own the business meaning expressed by a rule.

The Rule Governance role owns how the rule is represented and governed.

---

## 5.9 Product Capability Owner

Owns:

- capability behavior
- capability boundaries
- business outcomes
- functional requirements
- acceptance criteria
- product-level lifecycle

Does not own:

- platform architecture
- plugin implementation
- external provider behavior
- governed knowledge truth

---

## 5.10 Domain Expert

Owns or validates:

- domain-specific meaning
- business-rule correctness
- regulatory interpretation
- business process behavior
- domain terminology

A Domain Expert may approve business knowledge but SHALL NOT independently change platform architecture.

---

## 5.11 Component Owner

Owns:

- component responsibility
- internal design
- implementation quality
- component lifecycle
- component conformance
- component tests
- implementation documentation

Does not own upstream product or knowledge definitions.

---

## 5.12 Interface Owner

Owns:

- interface contract
- lifecycle semantics
- versioning
- compatibility
- normalized errors
- consumer communication
- contract tests

The Interface Owner SHALL represent both provider and consumer needs without transferring semantic ownership.

---

## 5.13 Plugin Owner

Owns:

- plugin implementation
- vendor adaptation
- capability declaration
- vendor error translation
- plugin compatibility
- plugin security
- plugin tests

Does not own:

- business logic
- Product decisions
- Core contracts
- external vendor product behavior

---

## 5.14 Execution Platform Owner

Owns:

- Execution Engine contract
- execution orchestration
- normalized execution results
- execution lifecycle
- execution safety controls
- evidence collection contracts

Individual execution adapter owners own their implementations.

---

## 5.15 Workspace Owner

Owns:

- project Workspace
- project configuration
- Workspace membership
- Workspace-scoped authorization
- project-level asset lifecycle
- project-level retention decisions within policy

Does not own:

- global ontology
- platform-wide governance
- organization-wide policy

---

## 5.16 Security

Owns:

- security policy
- trust boundaries
- credential policy
- authorization requirements
- sensitive-data classifications
- security review
- security incident governance

Security does not implement every security control but SHALL approve high-risk security changes.

---

## 5.17 Platform Operations

Owns:

- deployment
- runtime availability
- monitoring
- incident response
- backup and recovery
- resource management
- operational runbooks
- operational access

Does not own:

- Product meaning
- business rules
- Knowledge Object truth
- architecture policy

---

## 5.18 Quality Engineering

Owns:

- test policy
- quality criteria
- validation strategy
- conformance testing
- defect-quality standards
- release-quality evidence

Does not own the Product requirements being tested.

---

## 5.19 Repository Maintainer

Owns:

- repository structure enforcement
- file placement checks
- metadata validation
- index maintenance
- branch and merge mechanics
- repository automation

Does not own the semantic content of every artifact.

---

## 5.20 AI Agent

An AI agent MAY act as:

- contributor
- analyst
- generator
- reviewer assistant
- implementation assistant
- evidence collector

An AI agent SHALL NOT implicitly become:

- accountable owner
- final approver
- security authority
- high-risk knowledge validator
- architecture exception approver

AI authority SHALL be explicitly granted by AI Governance.

---

# 6. Repository Artifact Ownership Matrix

| Artifact | Accountable Owner | Responsible | Approver | Consulted | Informed |
|---|---|---|---|---|---|
| `README.md` | Repository Maintainer | Documentation Contributors | Engineering Governance | Architecture, Product Governance | All Contributors |
| `ROADMAP.md` | Product Governance | Product Capability Owners | Product Governance | Architecture, Engineering Leads | All Contributors |
| `CHANGELOG.md` | Repository Maintainer | Release Contributors | Release Owner | Artifact Owners | All Consumers |
| `MANIFEST.yaml` | Engineering Governance | Repository Maintainer | Engineering Governance | Architecture | All AI Agents and Contributors |
| Foundation Specifications | Engineering Governance | Specification Authors | Architecture and Engineering Governance | Product Governance, AI Governance | All Contributors |
| ADRs | Architecture | Decision Authors | Architecture | Affected Owners, Security where applicable | All Consumers |
| Governance Documents | Engineering Governance | Governance Authors | Engineering Governance | Architecture, Security, AI Governance | All Contributors |
| Knowledge Specifications | Knowledge Governance | Knowledge Architects | Knowledge Governance and Architecture | Ontology Steward, Schema Steward, AI Governance | Product Owners |
| Product Specifications | Product Capability Owner | Product Analysts and Authors | Product Governance | Knowledge Governance, Architecture, Quality Engineering | Component Owners |
| Architecture Specifications | Architecture | Architects | Architecture | Product Owners, Component Owners, Security | Engineering Teams |
| Component Specifications | Component Owner | Component Team | Architecture or Delegated Technical Approver | Interface Owners, Quality Engineering | Dependent Components |
| Interface Specifications | Interface Owner | Contract Authors | Architecture or Delegated Contract Approver | Providers, Consumers, Security | All Consumers |
| Runtime Specifications | Execution Platform Owner or Platform Operations | Runtime Engineers | Architecture | Security, Component Owners | Operators and Consumers |
| Ontology | Ontology Steward | Domain Modelers | Knowledge Governance | Domain Experts, Schema Steward | Knowledge and Product Owners |
| Schemas | Schema Steward | Schema Authors | Schema Steward | Ontology Steward, Interface Owners | Implementers |
| Rules | Rule Governance and Domain Owner | Rule Authors | Domain Owner and Rule Governance | Knowledge Governance, Quality Engineering | Product Owners |
| Knowledge Objects | Scope-specific Knowledge Owner | Knowledge Curators | Governance Policy or Authorized Validator | Domain Expert | Authorized Consumers |
| Knowledge Candidates | Knowledge Governance | Candidate Producers | Authorized Validator | Domain Expert where required | Candidate Originator |
| Templates | Artifact-type Owner | Template Authors | Engineering Governance | Primary Consumers | Contributors |
| Examples | Related Artifact Owner | Documentation Contributors | Related Artifact Owner | Quality Engineering | Contributors |
| Reference Documents | Reference Owner | Reference Curators | Reference Owner | Domain Experts | Consumers |
| Playbooks | Process Owner | Process Authors | Engineering Governance | Operators and Implementers | Contributors |
| Meta Indexes | Engineering Governance | Repository Automation | Repository Maintainer | Artifact Owners | AI Agents and Contributors |
| `.ai/` Instructions | AI Governance | AI Platform Contributors | AI Governance and Engineering Governance | Architecture, Security | AI Agents |

---

# 7. Specification Ownership

## 7.1 Foundation Specifications

Foundation Specifications define platform-wide invariants.

Accountable owners:

- Engineering Governance
- Architecture, where architectural boundaries are defined
- AI Governance, where AI authority is defined

Foundation changes SHALL require cross-domain review.

No downstream component owner may independently modify a Foundation rule to simplify implementation.

---

## 7.2 Knowledge Specifications

Knowledge Governance is accountable for the Knowledge specification family.

Individual responsibilities include:

| Specification | Primary Owner |
|---|---|
| SPEC-101 Ontology | Ontology Steward |
| SPEC-102 Knowledge Object | Knowledge Governance |
| SPEC-103 Knowledge Store | Knowledge Governance |
| SPEC-104 Rule Engine | Rule Governance |
| SPEC-105 Learning Engine | Knowledge Governance and AI Governance |

Architecture approval SHALL be required where a Knowledge specification changes platform boundaries or dependency direction.

---

## 7.3 Product Specifications

Every Product Specification SHALL identify one Product Capability Owner.

The Product Capability Owner is accountable for:

- capability intent
- scope
- expected outcomes
- functional behavior
- acceptance criteria
- interaction with other capabilities

Knowledge Governance SHALL be consulted when Product behavior consumes or creates knowledge.

Architecture SHALL be consulted when Product behavior creates a new platform boundary.

---

## 7.4 Architecture Specifications

Architecture owns system-level decomposition and cross-component collaboration.

A Component Owner MAY propose architecture changes.

The Architecture role SHALL approve them before implementation establishes the new boundary.

---

## 7.5 Component Specifications

Each component SHALL have one Component Owner.

The Component Owner SHALL ensure that the component:

- has one primary responsibility
- conforms to its Architecture Specification
- uses approved interfaces
- respects dependency direction
- has adequate tests
- has documented lifecycle behavior
- does not absorb upstream ownership

---

## 7.6 Interface Specifications

Every interface SHALL have one Interface Owner.

The Interface Owner is accountable for:

- contract stability
- semantic clarity
- versioning
- compatibility
- deprecation
- error model
- lifecycle behavior
- contract test availability

Provider and consumer teams SHALL be consulted.

Neither side may change the shared contract unilaterally.

---

## 7.7 Runtime Specifications

Runtime ownership SHALL be divided by execution responsibility.

Examples:

| Runtime Concern | Owner |
|---|---|
| Orchestration | Runtime Orchestration Owner |
| Scheduling | Scheduling Owner |
| Execution lifecycle | Execution Platform Owner |
| Observability | Platform Operations |
| Recovery | Platform Operations |
| Workspace runtime isolation | Workspace Platform Owner |
| Runtime security enforcement | Security and Runtime Owner |
| Evidence collection | Execution Platform Owner |
| Reporting pipeline operation | Reporting Runtime Owner |

Runtime owners SHALL NOT redefine Product or Knowledge semantics.

---

## 7.8 Canonical Specification Owner Registry

| Range | Specification | Accountable Owner |
|---|---|---|
| SPEC-201–212 | Product capability specifications | Named Product Capability Owner |
| SPEC-301–308 | Architecture module specifications | Architecture |
| SPEC-401, SPEC-403 | Knowledge repository components | Knowledge Platform |
| SPEC-402 | Rule repository component | Rule Platform |
| SPEC-404 | Execution Manager | Execution Platform |
| SPEC-405 | Plugin Registry | Platform Engineering |
| SPEC-406 | Workspace Manager Component | Security Platform |
| SPEC-407 | Playwright Plugin | Quality Engineering |
| SPEC-408 | Ontology Repository | Ontology Steward |
| SPEC-409 | Git Plugin | Platform Engineering |
| SPEC-501–507 | Interface contracts | Architecture and named domain contract owner |
| SPEC-601–605 | Runtime specifications | Runtime Platform or named operational owner |

The roles Knowledge Platform, Rule Platform, Execution Platform, Security Platform, Runtime Platform, UI Intelligence, and Knowledge Engineering are scoped engineering ownership roles defined by this registry. They do not supersede Knowledge Governance, Rule Governance, Security, Operations, AI Governance, or Architecture approval authority.

Every Product Specification SHALL resolve its named capability role to one accountable Product Capability Owner before leaving `draft`.

---

# 8. Semantic Ownership Matrix

| Concept | Authoritative Owner | Representation Owner | Implementation Owner |
|---|---|---|---|
| Product Vision | Product Governance | Foundation Specification Owner | Not applicable |
| Engineering Law | Engineering Governance | Foundation Specification Owner | All implementers conform |
| Architecture Decision | Architecture | ADR Owner | Affected Component Owners |
| Requirement | Product Capability Owner | Schema Steward | Product and Requirement Components |
| Business Rule | Domain Owner | Rule Governance | Rule Engine Component Owner |
| Validation Rule | Domain Owner | Rule Governance | Validation Component Owner |
| Knowledge Object | Knowledge Governance | Schema Steward | Knowledge Store Component Owner |
| Knowledge Candidate | Knowledge Governance | Schema Steward | Learning Pipeline Owner |
| Ontology Entity | Ontology Steward | Ontology Steward | Knowledge and Product Implementers |
| Semantic UI | Semantic UI Domain Owner | Schema Steward | Semantic Analyzer Component Owner |
| UI Knowledge Graph | Knowledge Graph Owner | Ontology and Schema Stewards | Graph Component Owner |
| Test Strategy | Quality Engineering | Product Artifact Schema Owner | Test Strategy Component Owner |
| Test Case | Quality Engineering and Product Owner | Schema Steward | Test Design Component Owner |
| Automation Asset | Automation Capability Owner | Schema Steward | Automation Component Owner |
| Execution Result | Execution Platform Owner | Interface and Schema Owners | Execution Adapter Owner |
| Bug | Bug Analysis Capability Owner | Schema Steward | Bug Analysis Component Owner |
| Report | Reporting Capability Owner | Report Schema Owner | Reporting Component Owner |
| Credential | Security | Credential Contract Owner | Credential Provider Owner |
| Workspace | Workspace Platform Owner | Workspace Schema Owner | Workspace Component Owner |

Semantic ownership SHALL take precedence over representation and implementation ownership.

---

# 9. Knowledge Ownership

## 9.1 Knowledge Ownership Is Scope-Specific

Knowledge SHALL be owned according to scope.

```text
Global
      ↓
Organization
      ↓
Project
      ↓
Feature
      ↓
Screen
      ↓
Session
```

| Scope | Default Accountable Owner |
|---|---|
| Global | Knowledge Governance |
| Organization | Authorized Organization Knowledge Owner |
| Project | Workspace or Project Knowledge Owner |
| Feature | Product Capability Owner or Delegated Domain Owner |
| Screen | Feature Owner or Semantic UI Owner |
| Session | Session Orchestrator; non-persistent by default |

A narrower-scope owner SHALL NOT modify broader-scope knowledge.

---

## 9.2 Knowledge Type Ownership

| Knowledge Type | Semantic Owner | Governance Owner | Validator |
|---|---|---|---|
| Business Rule | Domain Owner | Knowledge Governance and Rule Governance | Authorized Domain Expert |
| Validation Rule | Domain Owner | Rule Governance | Quality Engineering or Domain Expert |
| Requirement | Product Capability Owner | Knowledge Governance | Product Approver |
| API Knowledge | API Capability Owner | Knowledge Governance | Interface Owner |
| Locator Knowledge | Semantic UI Owner | Knowledge Governance | Automation Validator |
| Automation Rule | Automation Capability Owner | Rule Governance | Quality Engineering |
| Preference | Scope Owner | Knowledge Governance | Authorized User or Policy |
| Known Issue | Bug Analysis Owner | Knowledge Governance | Quality Engineering |
| Credential Reference | Security | Security | Authorized Credential Administrator |

Credential values SHALL NOT become general Knowledge Objects.

Only governed credential references and metadata may participate in the knowledge system.

---

## 9.3 Knowledge Candidate Ownership

The producer of a Knowledge Candidate owns the submission, not the truth.

A candidate producer is responsible for:

- capturing the observation
- preserving evidence
- identifying scope
- recording provenance
- proposing classification
- disclosing uncertainty

Knowledge Governance owns the candidate lifecycle.

An authorized validator owns the validation decision.

The scope-specific Knowledge Owner becomes accountable only after approval.

---

## 9.4 Knowledge Conflict Ownership

When Knowledge Objects conflict:

1. Knowledge Governance owns conflict orchestration.
2. The scope-specific Knowledge Owner evaluates authority.
3. Domain Experts validate business meaning.
4. Ontology Steward resolves semantic conflicts.
5. Architecture resolves structural ownership conflicts.
6. Security resolves restricted-data conflicts.

The persistence component SHALL NOT resolve semantic conflicts automatically unless an approved deterministic rule exists.

---

# 10. Rule Ownership

Every rule SHALL identify two distinct forms of ownership where applicable.

## 10.1 Semantic Rule Owner

Owns the business meaning.

Examples:

- Product Owner
- Domain Expert
- Compliance Owner
- Security
- Quality Engineering

---

## 10.2 Rule Representation Owner

Rule Governance owns:

- rule structure
- lifecycle
- metadata
- precedence model
- versioning
- conflict mechanism
- execution eligibility

---

## 10.3 Rule Implementation Owner

The Rule Engine Component Owner owns:

- rule loading
- evaluation
- deterministic execution
- diagnostics
- performance
- test infrastructure
- platform error handling

The implementation owner SHALL NOT alter rule meaning.

---

## 10.4 Rule Approval Matrix

| Rule Type | Required Semantic Approver | Governance Approver |
|---|---|---|
| Business Rule | Domain Owner | Rule Governance |
| Validation Rule | Domain Owner or Quality Engineering | Rule Governance |
| Security Rule | Security | Rule Governance |
| Regulatory Rule | Authorized Compliance Owner | Rule Governance |
| Risk-Scoring Rule | Risk Capability Owner | Rule Governance |
| Confidence Rule | AI Governance | Rule Governance |
| Repository Rule | Engineering Governance | Rule Governance |
| Runtime Safety Rule | Security and Execution Platform Owner | Rule Governance |

---

# 11. AI Ownership

## 11.1 AI Governance Ownership

AI Governance is accountable for:

- autonomy levels
- permitted AI actions
- confidence thresholds
- validation requirements
- human review requirements
- controlled learning
- model-risk policy
- AI audit requirements
- AI fallback behavior

---

## 11.2 AI Provider Ownership

The AI Platform Owner owns:

- AI provider interface
- model capability discovery
- provider selection mechanics
- provider adapters
- request and response normalization
- usage and cost telemetry
- provider error translation

The AI Platform Owner does not own:

- Product reasoning policy
- business rules
- Knowledge Object approval
- AI autonomy authorization

---

## 11.3 Prompt Ownership

Prompts used as implementation assets SHALL have an owner.

Prompt ownership includes:

- purpose
- input contract
- output contract
- versioning
- security review
- evaluation
- deprecation

Prompt owners SHALL NOT place authoritative knowledge or deterministic business rules in prompts.

---

## 11.4 AI Output Ownership

An AI agent owns generation provenance.

It does not own the accepted artifact.

Ownership transfers only through the appropriate lifecycle:

```text
AI Output

↓

Validation

↓

Approval

↓

Authoritative Artifact Owner
```

Until approval, AI output SHALL remain a draft, proposal, or candidate.

---

## 11.5 AI Agent Authority Matrix

| Action | AI Agent Role | Human or Policy Authority Required |
|---|---|---|
| Observe evidence | Responsible | No additional approval unless restricted data is involved |
| Recommend change | Responsible | Owner reviews |
| Draft specification | Contributor | Artifact Owner approves |
| Draft ADR | Contributor | Architecture approves |
| Generate rule candidate | Contributor | Rule and Domain Owners approve |
| Generate Knowledge Candidate | Candidate Producer | Validator approves according to policy |
| Auto-approve low-risk technical knowledge | Policy Executor | Explicit AI Governance policy |
| Approve business rule | Prohibited by default | Authorized Domain Owner |
| Approve architecture exception | Prohibited | Architecture |
| Change security policy | Prohibited | Security |
| Execute destructive action | Restricted | Explicit authorization and runtime policy |
| Become accountable owner | Prohibited | Ownership must remain human or governed organizational role |

---

# 12. Architecture Ownership

Architecture owns:

- system boundaries
- domain boundaries
- dependency direction
- interface placement
- plugin boundaries
- Workspace isolation architecture
- Execution Engine abstraction
- architectural exception policy
- technology-independence requirements

Architecture does not own:

- every internal component implementation
- every Product decision
- every Knowledge Object
- project-level configuration
- routine operational decisions

Architecture SHALL intervene when a change:

- introduces a new dependency direction
- creates a new top-level module
- moves responsibility between domains
- introduces a new cross-domain contract
- creates a breaking platform interface
- changes isolation
- changes AI autonomy architecture
- adds a direct vendor dependency to Core
- creates plugin-to-plugin coupling
- changes source-of-truth ownership

---

# 13. Component Ownership

Each component SHALL declare:

```yaml
component_id:
name:
accountable_owner:
responsibility:
owned_data:
owned_interfaces:
consumed_interfaces:
allowed_dependencies:
prohibited_responsibilities:
runtime_operator:
security_classification:
```

The Component Owner is accountable for:

- component boundaries
- implementation quality
- internal architecture
- test coverage
- performance within contract
- failure behavior
- observability
- upgrade and migration
- documentation
- vulnerability remediation

The Component Owner SHALL NOT:

- redefine external contracts unilaterally
- directly modify another component's state
- absorb business rules for convenience
- bypass Workspace scope
- leak vendor types through platform interfaces
- create undocumented dependencies

---

# 14. Data Ownership

## 14.1 Data Ownership Principles

Each persisted data category SHALL have:

- semantic owner
- storage owner
- access-policy owner
- retention owner
- operational custodian
- deletion authority

These roles MAY differ.

---

## 14.2 Data Ownership Matrix

| Data Category | Semantic Owner | Storage Owner | Access Policy Owner | Retention Owner |
|---|---|---|---|---|
| Knowledge Objects | Knowledge Governance | Knowledge Store Owner | Knowledge Governance and Security | Knowledge Governance |
| Knowledge Candidates | Knowledge Governance | Learning Store Owner | Knowledge Governance | Knowledge Governance |
| Requirements | Product Capability Owner | Requirement Store Owner | Workspace Owner | Product Governance |
| Business Rules | Domain Owner | Rule Repository Owner | Rule Governance | Rule Governance |
| Semantic UI | Semantic UI Owner | UI Knowledge Store Owner | Workspace Owner | Discovery Capability Owner |
| UI Knowledge Graph | Knowledge Graph Owner | Graph Store Owner | Workspace Owner | Knowledge Governance |
| Test Assets | Quality Engineering | Test Asset Store Owner | Workspace Owner | Quality Engineering |
| Execution Evidence | Execution Platform Owner | Evidence Store Owner | Security and Workspace Owner | Execution Governance |
| Bugs | Bug Analysis Owner | Bug Store Owner | Workspace Owner | Quality Engineering |
| Reports | Reporting Owner | Report Store Owner | Workspace Owner | Product Governance |
| Credentials | Security | Credential Provider Owner | Security | Security |
| Audit Records | Engineering Governance and Security | Audit Store Owner | Security | Security and Compliance |
| Operational Metrics | Platform Operations | Telemetry Platform Owner | Platform Operations and Security | Platform Operations |

Storage ownership SHALL NOT confer semantic authority.

---

# 15. Interface Ownership

An Interface Owner SHALL:

- maintain the authoritative contract
- manage versions
- identify consumers
- publish compatibility policy
- approve breaking changes
- coordinate migration
- maintain contract tests
- normalize errors
- document security requirements
- define deprecation timelines

Provider implementations own conformance to the interface.

Consumers own correct use of the interface.

Neither owns the contract unless explicitly designated as Interface Owner.

---

## 15.1 Shared Interface Governance

When multiple teams depend on an interface:

1. One Interface Owner remains accountable.
2. Provider and consumer teams are consulted.
3. Breaking changes require impact analysis.
4. Migration responsibilities are assigned.
5. Compatibility tests are updated.
6. Deprecation is communicated.
7. No consumer may fork the authoritative contract silently.

---

# 16. Plugin Ownership

Each plugin SHALL declare:

```yaml
plugin_id:
vendor_or_technology:
accountable_owner:
interface_version:
capabilities:
security_classification:
supported_versions:
runtime_operator:
deprecation_policy:
```

The Plugin Owner owns:

- adapter correctness
- capability declarations
- vendor compatibility
- plugin-specific configuration
- error translation
- plugin-local security
- integration tests
- upgrade strategy

The Core Interface Owner owns:

- plugin contract
- common lifecycle
- normalized errors
- registration requirements
- capability protocol

The External Vendor owns its external product.

QA Intelligence SHALL NOT treat the Plugin Owner as accountable for vendor behavior beyond reasonable adapter handling.

---

# 17. Execution Ownership

Execution responsibilities SHALL be separated.

| Responsibility | Owner |
|---|---|
| Test intent | Product and Quality Engineering |
| Execution plan | Automation or Execution Capability Owner |
| Execution Engine contract | Execution Platform Owner |
| Execution adapter | Adapter-specific Owner |
| Runtime orchestration | Runtime Orchestration Owner |
| Execution authorization | Security and Workspace Owner |
| Environment selection | Workspace Owner |
| Evidence contract | Execution Platform Owner |
| Evidence storage | Evidence Store Owner |
| Execution result interpretation | Product Capability Owner |
| Incident response | Platform Operations |
| Destructive-action policy | Security and AI Governance where AI is involved |

The Execution Engine implementation SHALL NOT own test intent or business assertions.

---

# 18. Workspace Ownership

Every Workspace SHALL have an accountable Workspace Owner.

The Workspace Owner is responsible for:

- membership
- project configuration
- project-level authorization
- project-level knowledge approval assignments
- plugin enablement within policy
- environment registration
- project asset retention
- project archive and deletion requests

The Workspace Platform Owner is responsible for:

- Workspace lifecycle contract
- isolation enforcement
- shared platform behavior
- Workspace schema
- Workspace service availability

Security owns the minimum access-control requirements.

A Workspace Owner SHALL NOT weaken platform-wide security or isolation policy.

---

# 19. Security Ownership

Security SHALL be accountable for:

- credential handling
- access-control policy
- sensitive-data classification
- prompt-injection defense requirements
- external-content trust policy
- destructive-action controls
- audit requirements
- incident severity policy
- security exception approval

Component Owners are responsible for implementing applicable controls.

Platform Operations is responsible for operating controls.

Quality Engineering is responsible for validating controls.

Security ownership is not delegated merely because another team implements the mechanism.

---

# 20. Quality Ownership

Quality is shared, but accountability SHALL remain explicit.

## 20.1 Artifact Quality

The artifact owner is accountable for content quality.

---

## 20.2 Implementation Quality

The Component Owner is accountable for implementation quality.

---

## 20.3 Contract Quality

The Interface Owner is accountable for contract quality.

---

## 20.4 Product Quality

The Product Capability Owner and Quality Engineering share responsibility.

The Product Capability Owner owns expected behavior.

Quality Engineering owns quality assessment and validation strategy.

---

## 20.5 Release Quality

The Release Owner is accountable for the release decision.

Quality Engineering supplies quality evidence.

Security supplies security evidence.

Platform Operations supplies operational readiness evidence.

The Release Owner SHALL NOT misrepresent missing evidence as successful validation.

---

# 21. Runtime and Operational Ownership

Platform Operations owns:

- service availability
- deployment
- runtime monitoring
- incident coordination
- operational recovery
- infrastructure capacity
- production access processes
- backup and restore operation

Component Owners support incidents involving their components.

Security owns security-incident policy.

Workspace Owners are informed of incidents affecting their project.

Operational workarounds SHALL NOT become permanent architecture without review.

---

# 22. Incident Ownership

Every incident SHALL identify:

- Incident Commander
- affected Component Owner
- affected Product Owner
- Platform Operations owner
- Security owner where applicable
- communication owner
- remediation owner
- post-incident review owner

The Incident Commander owns coordination, not every technical decision.

The affected authoritative owner SHALL approve permanent changes to governed artifacts.

Emergency changes SHALL be reconciled with specifications and ADRs after stabilization.

---

# 23. Change Ownership

## 23.1 Change Proposer

The proposer owns:

- problem statement
- initial evidence
- expected outcome
- affected scope
- identified dependencies

The proposer does not automatically own the decision.

---

## 23.2 Artifact Owner

The Artifact Owner owns:

- classification
- review routing
- semantic correctness
- lifecycle decision
- compatibility determination

---

## 23.3 Implementer

The implementer owns:

- implementation correctness
- tests
- migration execution
- documentation updates
- conformance evidence

---

## 23.4 Approver

The approver owns:

- acceptance or rejection
- review completeness
- explicit conditions
- acknowledgement of residual risk

Approval SHALL be recorded.

---

## 23.5 Operator

The operator owns:

- deployment execution
- rollout monitoring
- rollback execution
- operational evidence

The operator SHALL NOT approve semantic changes by deploying them.

---

# 24. Change Approval Matrix

| Change Type | Accountable Owner | Required Approver |
|---|---|---|
| Foundation change | Engineering Governance | Architecture and relevant Governance Owner |
| New ADR | Architecture | Architecture |
| ADR supersession | Architecture | Architecture and affected Owners |
| Governance policy change | Engineering Governance | Engineering Governance |
| AI autonomy change | AI Governance | AI Governance and Security where high risk |
| Ontology change | Ontology Steward | Knowledge Governance |
| Breaking schema change | Schema Steward | Schema Steward and affected Interface Owners |
| Business-rule change | Domain Owner | Domain Owner and Rule Governance |
| Knowledge lifecycle change | Knowledge Governance | Knowledge Governance and Architecture |
| Product behavior change | Product Capability Owner | Product Governance |
| Architecture boundary change | Architecture | Architecture |
| Component internal change | Component Owner | Delegated Technical Approver |
| Breaking interface change | Interface Owner | Architecture and affected Owners |
| New plugin | Plugin Owner | Interface Owner and Security |
| Execution safety change | Execution Platform Owner | Security |
| Workspace isolation change | Workspace Platform Owner | Architecture and Security |
| Credential policy change | Security | Security |
| Runtime operational change | Platform Operations | Platform Operations |
| Release | Release Owner | Release Owner after required gates |

---

# 25. Breaking Change Ownership

A breaking change SHALL have one accountable Change Owner.

The Change Owner is responsible for:

- impact analysis
- affected-consumer inventory
- migration plan
- compatibility strategy
- communication
- timeline
- rollback plan
- completion tracking

The owner of the changed artifact remains accountable for the artifact.

The Change Owner may be a separate coordinating role.

Consumers own migration of their implementation.

The provider owns migration guidance and compatibility support as defined by policy.

---

# 26. Deprecation Ownership

The authoritative Artifact Owner owns deprecation.

Deprecation SHALL define:

- deprecated artifact
- replacement
- reason
- effective date
- support window
- migration path
- affected consumers
- final removal authority

Consumers SHALL NOT continue indefinite use merely because migration ownership is unclear.

The Artifact Owner SHALL identify consumers before removal.

---

# 27. Conflict Resolution Ownership

## 27.1 Product Conflict

Resolved by Product Governance.

Architecture is consulted when the conflict affects boundaries.

---

## 27.2 Architecture Conflict

Resolved by Architecture through ADR review.

---

## 27.3 Semantic Conflict

Resolved by the Ontology Steward and relevant Domain Owner.

---

## 27.4 Knowledge Conflict

Resolved through Knowledge Governance and scope-specific authority.

---

## 27.5 Rule Conflict

Resolved by Rule Governance and the semantic Domain Owner.

---

## 27.6 Schema Conflict

Resolved by the Schema Steward without redefining ontology meaning.

---

## 27.7 Interface Conflict

Resolved by the Interface Owner with provider and consumer consultation.

Architecture resolves unresolved cross-domain disputes.

---

## 27.8 Security Conflict

Security requirements take precedence over convenience and performance.

Architecture resolves structural implications.

---

## 27.9 Ownership Conflict

Engineering Governance identifies the authoritative layer.

Architecture resolves domain-boundary ambiguity.

The conflicting teams SHALL NOT create parallel authoritative artifacts.

---

# 28. Segregation of Duties

The following combinations SHOULD be separated for high-risk actions:

- proposer and sole approver
- Knowledge Candidate producer and final business validator
- credential administrator and audit reviewer
- destructive-action requester and authorizer
- security-control implementer and sole security approver
- architecture-exception requester and sole approver
- release implementer and sole release approver
- audit-record producer and audit-retention administrator

Small teams MAY combine roles only through an explicitly approved risk-based policy.

---

# 29. Delegation Rules

Ownership MAY be delegated operationally.

Accountability remains with the authoritative owner unless ownership is formally transferred.

Delegation SHALL specify:

```yaml
delegating_owner:
delegate:
responsibilities:
scope:
authority:
limitations:
effective_from:
expires_at:
revocation_process:
```

Delegation SHALL NOT permit a narrower role to override higher-level governance.

Expired delegation SHALL have no authority.

---

# 30. Ownership Transfer

Ownership transfer SHALL follow:

```text
Transfer Proposal

↓

Current Owner Review

↓

New Owner Acceptance

↓

Dependency and Risk Review

↓

Approval

↓

Metadata Update

↓

Consumer Notification

↓

Effective Transfer
```

A transfer SHALL include:

- artifact inventory
- open issues
- pending changes
- compatibility commitments
- known risks
- exceptions
- operational responsibilities
- documentation
- access requirements

Ownership SHALL NOT be transferred only by moving files between directories.

---

# 31. Orphaned Ownership

An artifact is orphaned when:

- the declared owner no longer exists
- the owner rejects responsibility
- no role can approve changes
- no operator supports the runtime capability
- ownership metadata is missing
- two parties each assume the other owns it

Orphaned authoritative artifacts SHALL be escalated to Engineering Governance.

Orphaned runtime components SHALL be escalated to Architecture and Platform Operations.

High-risk orphaned artifacts SHALL block release or modification until an interim owner is assigned.

---

# 32. Shared Ownership Anti-Pattern

The following ownership declaration is prohibited:

```yaml
owner:
  - Everyone
```

The following declarations are insufficient:

```yaml
owner:
  - Engineering
```

```yaml
owner:
  - Platform
```

unless those terms map to explicit governed roles.

A valid ownership declaration identifies one accountable role.

Multiple parties MAY be listed separately as contributors, approvers, consulted parties, or operators.

---

# 33. Ownership and Dependency Boundaries

Ownership SHALL align with the Dependency Matrix.

A module that depends on another module:

- consumes the owner's contract
- does not inherit ownership
- cannot modify the provider's internal state
- cannot redefine provider semantics
- SHALL request contract changes through governance

Cross-owner dependencies SHALL use explicit interfaces.

Direct access to another owner's internal implementation is an ownership violation in addition to a dependency violation.

---

# 34. Ownership and Traceability

Every governed artifact SHOULD record:

```yaml
owner:
approvers:
contributors:
consulted:
consumers:
operator:
validator:
```

Traceability SHOULD support queries such as:

- Which artifacts does this owner maintain?
- Which components consume this interface?
- Which rules require this Domain Owner's approval?
- Which Knowledge Objects await this validator?
- Which exceptions belong to this owner?
- Which deprecated artifacts have unmigrated consumers?
- Which runtime services have no operator?
- Which AI-generated drafts await human ownership?

---

# 35. Machine-Readable Ownership Model

A machine-readable ownership index SHOULD be stored at:

```text
meta/OWNERSHIP_INDEX.yaml
```

or represented within:

```text
meta/REPOSITORY_GRAPH.yaml
```

Recommended record:

```yaml
artifact_id:
artifact_type:
path:
accountable_owner:
responsible:
approvers:
consulted:
informed:
operator:
validator:
scope:
status:
effective_from:
dependencies:
```

The machine-readable index is a derived navigation and validation artifact.

The authoritative artifact metadata remains the source of truth for individual ownership declarations.

Conflicts SHALL be reported rather than silently reconciled.

---

# 36. Ownership Validation Rules

Automated validation SHOULD detect:

- missing accountable owner
- multiple accountable owners
- unknown owner identifiers
- missing required approvers
- ownership inconsistent with artifact type
- owner without authority for scope
- expired delegation
- orphaned component
- runtime service without operator
- Knowledge Object without scope owner
- breaking change without Change Owner
- security-sensitive artifact without Security consultation
- AI-generated accepted artifact without authorized approval

Suggested checks:

```text
tests/governance/test_ownership_metadata.*

tests/governance/test_single_accountable_owner.*

tests/governance/test_owner_scope.*

tests/governance/test_required_approvers.*

tests/governance/test_delegation_expiry.*

tests/governance/test_orphaned_artifacts.*
```

---

# 37. AI Agent Ownership Instructions

Before creating or modifying an artifact, an AI agent SHALL:

1. identify the authoritative artifact type
2. identify the accountable owner
3. verify the owner's scope and authority
4. identify required approvers
5. identify affected consumers
6. identify consulted governance roles
7. preserve existing ownership metadata
8. avoid assigning itself as owner
9. label generated content as draft until approved
10. report missing or conflicting ownership
11. avoid modifying authoritative content when no owner can be determined
12. update ownership indexes when required

An AI agent MUST NOT:

- invent a human owner
- infer ownership solely from Git history
- approve its own high-risk output
- silently transfer ownership
- treat implementation authorship as semantic authority
- resolve an ownership conflict without governed authority
- assign broad groups such as “everyone” as owner
- accept missing ownership metadata in a final governed artifact

---

# 38. Ownership Review Questions

Every review SHALL answer:

1. Who is the single accountable owner?
2. Is the owner authoritative for this layer?
3. Is the owner authorized for this scope?
4. Who is implementing the change?
5. Who must approve it?
6. Which parties must be consulted?
7. Which consumers must be informed?
8. Who operates the resulting capability?
9. Who validates correctness?
10. Who resolves conflicts?
11. Is segregation of duties required?
12. Are ownership and dependency boundaries aligned?
13. Is ownership metadata machine-readable?
14. Is ownership transfer or delegation involved?
15. Could the artifact become orphaned?

---

# 39. Ownership Conformance Checklist

## Artifact Ownership

```text
□ Exactly one accountable owner is declared.

□ The owner is authoritative for the artifact type.

□ The owner's scope covers the artifact.

□ Required approvers are declared.

□ Consumers and consulted roles are identifiable.
```

## Semantic Ownership

```text
□ Semantic ownership is separate from implementation ownership.

□ Schemas do not own meaning.

□ Storage components do not own data truth.

□ Plugins do not own business logic.

□ Runtime does not own Product intent.
```

## Knowledge and Rules

```text
□ Knowledge has a scope-specific owner.

□ Knowledge Candidates have a validator.

□ Business rules have a Domain Owner.

□ Rule Governance owns representation and lifecycle.

□ Conflict resolution ownership is defined.
```

## Components and Interfaces

```text
□ Every component has a Component Owner.

□ Every interface has an Interface Owner.

□ Providers and consumers cannot change contracts unilaterally.

□ Runtime services have an operator.

□ External adapters have named owners.
```

## AI

```text
□ AI-generated artifacts remain drafts until approval.

□ AI is not assigned as accountable owner.

□ High-risk AI actions have human or policy authority.

□ Controlled learning has an authorized validator.

□ AI Governance owns autonomy policy.
```

## Security and Operations

```text
□ Security-sensitive changes include Security approval.

□ Credentials have Security ownership.

□ Operational responsibilities are assigned.

□ Incident ownership is defined.

□ High-risk duties are appropriately separated.
```

## Change Lifecycle

```text
□ Breaking changes have a Change Owner.

□ Deprecation has an owner and migration path.

□ Delegation is explicit and time-bounded.

□ Ownership transfers are recorded.

□ No authoritative artifact is orphaned.
```

---

# 40. Ownership Violations

Ownership violations include:

- missing owner
- multiple unqualified owners
- implementation redefining Product intent
- schema redefining ontology
- plugin defining business rules
- runtime promoting knowledge without governance
- consumer modifying provider internals
- AI approving its own high-risk output
- Workspace owner overriding global security
- storage owner claiming semantic authority
- unapproved ownership transfer
- expired delegation
- unowned runtime service
- unresolved ownership conflict
- owner acting outside approved scope

Ownership violations SHALL be classified using the severity model below.

---

# 41. Violation Severity

## Critical

A violation:

- exposes credentials
- bypasses security ownership
- permits unauthorized destructive execution
- crosses Workspace ownership without authorization
- allows AI to become final high-risk authority
- gives unapproved knowledge production authority

Critical violations SHALL block implementation, merge, and release.

---

## High

A violation:

- creates multiple authoritative owners
- leaves an architecture boundary unowned
- gives a plugin business ownership
- gives runtime Product ownership
- allows contract changes without Interface Owner approval
- leaves a security-sensitive component without accountable ownership

High violations SHALL block merge.

---

## Medium

A violation:

- omits consulted parties
- uses ambiguous owner names
- lacks machine-readable ownership metadata
- has an expired operational delegation
- leaves deprecation coordination unclear

Medium violations require correction or approved remediation.

---

## Low

A violation:

- omits optional informed parties
- has outdated non-authoritative ownership documentation
- contains minor role-label inconsistencies

Low violations SHOULD be corrected during normal maintenance.

---

# 42. Ownership Exception Process

An ownership exception MAY be granted only when:

- normal ownership cannot immediately be established
- an interim accountable owner is assigned
- scope is bounded
- authority is documented
- risk is assessed
- approval is recorded
- expiration is defined
- permanent resolution is planned

Exception metadata:

```yaml
id:
status:
artifact:
normal_owner:
interim_owner:
reason:
scope:
authority:
limitations:
risk:
mitigation:
approved_by:
created_at:
expires_at:
resolution_plan:
```

An expired ownership exception SHALL result in an orphaned-artifact violation.

---

# 43. Relationship to Other Governance Documents

This document SHALL be used with:

```text
governance/ARCHITECTURE_PRINCIPLES.md
```

Defines the architectural constraints owners must preserve.

```text
governance/READING_ORDER.md
```

Defines which governing artifacts owners and contributors read first.

```text
governance/DECISION_TREE.md
```

Determines the artifact type and therefore its default owner.

```text
governance/DEPENDENCY_MATRIX.md
```

Defines the boundaries between owners and their consumers.

```text
governance/TRACEABILITY_MATRIX.md
```

Defines ownership of relationships across the engineering lifecycle.

```text
governance/CHANGE_IMPACT_MATRIX.md
```

Defines which owners participate when an artifact changes.

```text
governance/REVIEW_CHECKLIST.md
```

Defines ownership-related review questions.

```text
governance/QUALITY_GATES.md
```

Defines when ownership validation blocks acceptance.

---

# 44. Definition of Done

This document is complete when:

- canonical ownership roles are defined
- responsibility classifications are defined
- repository artifact ownership is defined
- semantic ownership is distinguished from representation and implementation
- Knowledge ownership is scope-aware
- Rule ownership is separated into semantic, governance, and implementation responsibilities
- AI ownership limitations are defined
- architecture, component, interface, plugin, execution, Workspace, and security ownership are defined
- approval responsibilities are defined
- conflict resolution ownership is defined
- delegation and transfer processes are defined
- orphaned ownership handling is defined
- machine-readable ownership expectations are defined
- ownership validation rules are defined

Ownership governance implementation is complete when:

- every governed artifact declares one accountable owner
- every component declares an owner
- every interface declares an owner
- every runtime service declares an operator
- every Knowledge Object resolves to a scope owner
- every high-risk change identifies required approvers
- ownership metadata is validated automatically
- expired delegations and ownership exceptions are detected
- orphaned artifacts block acceptance according to severity

---

# 45. Summary

QA Intelligence SHALL maintain the following ownership model:

```text
Intent Owner

↓

Semantic Owner

↓

Contract Owner

↓

Implementation Owner

↓

Runtime Operator

↓

Validator and Auditor
```

These roles may collaborate but SHALL NOT be confused.

Product owns product intent.

Domain Owners own business meaning.

Ontology owns semantics.

Schemas own structure.

Rule Governance owns deterministic rule representation and lifecycle.

Knowledge Governance owns the knowledge lifecycle.

Architecture owns platform boundaries.

Interface Owners own contracts.

Component Owners own implementation units.

Plugin Owners own external adaptation.

Platform Operations owns runtime operation.

Security owns security policy.

AI Governance owns AI authority.

AI agents contribute but do not become implicit accountable owners.

Every authoritative responsibility SHALL have one owner.

Every owner SHALL operate within an explicit scope.

Every cross-owner interaction SHALL use a governed contract.

Ownership that cannot be identified, explained, and audited is not acceptable ownership.
