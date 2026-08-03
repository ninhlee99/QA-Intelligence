---
id: GOV-004
title: Dependency Matrix
version: 1.1.0
status: accepted
owner:
  - Architecture
  - Engineering Governance
depends_on:
  - SPEC-003
  - SPEC-006
  - SPEC-007
  - GOV-001
  - GOV-002
  - GOV-003
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

# Dependency Matrix

## 1. Purpose

This document defines the allowed, restricted, and prohibited dependencies within the QA Intelligence Engineering Knowledge Base and runtime architecture.

Its objectives are to:

* preserve architectural boundaries
* prevent circular dependencies
* prevent lower layers from redefining higher layers
* isolate business logic from external technologies
* protect Workspace boundaries
* preserve AI provider independence
* make dependency review deterministic
* support automated architecture conformance checks

This document applies to:

* repository artifacts
* specifications
* ontology
* schemas
* rules
* knowledge
* product capabilities
* architecture modules
* components
* interfaces
* runtime services
* plugins
* infrastructure adapters
* tests
* AI agents

Dependency violations are architectural defects.

---

# 2. Dependency Philosophy

Dependencies SHALL point toward stable abstractions and authoritative knowledge.

The architecture SHALL prefer:

```text
Volatile Implementation
          ↓
Stable Interface
          ↓
Domain Contract
          ↓
Architecture Decision
          ↓
Foundation Principle
```

The architecture SHALL NOT depend on implementation details to determine system intent.

A valid dependency means:

> The dependent artifact may use, implement, constrain itself by, or reference the dependency without redefining it.

A dependency does not grant ownership.

---

# 3. Dependency Classification

Every dependency SHALL be classified as one of the following.

## 3.1 Allowed

The dependency is architecturally valid.

Symbol:

```text
A
```

---

## 3.2 Allowed Through Contract

The dependency is permitted only through an approved interface, schema, event, capability, or service contract.

Symbol:

```text
C
```

---

## 3.3 Restricted

The dependency may be permitted only for a documented use case with architecture review.

Symbol:

```text
R
```

---

## 3.4 Prohibited

The dependency violates architectural boundaries.

Symbol:

```text
P
```

---

## 3.5 Not Applicable

The dependency has no valid architectural meaning.

Symbol:

```text
—
```

---

# 4. Repository Layer Model

The canonical repository layers are:

```text
Foundation

Architecture Decisions

Governance

Knowledge

Product

Architecture

Interfaces

Components

Runtime

Implementation

Tests
```

Supporting artifact domains include:

```text
Ontology

Schemas

Rules

Knowledge Objects

Plugins

Infrastructure

Examples

Templates

Playbooks

Reference

Meta
```

---

# 5. Authoritative Dependency Direction

The principal dependency direction is:

```text
Foundation
      ↓
Architecture Decisions
      ↓
Governance
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
Tests and Runtime Evidence
```

This diagram expresses authority, not necessarily source-code import direction.

A lower layer SHALL conform to higher layers.

A higher layer SHALL remain independent of lower-layer implementation details.

---

# 6. Specification Dependency Matrix

The row represents the dependent layer.

The column represents the target dependency.

| From \ To    | Foundation | ADR | Governance | Knowledge | Product | Architecture | Interfaces | Components | Runtime |
| ------------ | ---------: | --: | ---------: | --------: | ------: | -----------: | ---------: | ---------: | ------: |
| Foundation   |          A |   P |          P |         P |       P |            P |          P |          P |       P |
| ADR          |          A |   A |          R |         R |       R |            R |          R |          R |       R |
| Governance   |          A |   A |          A |         A |       A |            A |          A |          A |       A |
| Knowledge    |          A |   A |          A |         A |       P |            P |          C |          P |       P |
| Product      |          A |   A |          A |         A |       A |            R |          C |          P |       P |
| Architecture |          A |   A |          A |         A |       A |            A |          C |          R |       R |
| Interfaces   |          A |   A |          A |         A |       A |            A |          A |          P |       R |
| Components   |          A |   A |          A |         A |       A |            A |          C |          A |       R |
| Runtime      |          A |   A |          A |         A |       A |            A |          A |          A |       A |

## 6.1 Interpretation

### Foundation

Foundation Specifications SHALL remain independent of all downstream layers.

Foundation MAY reference another Foundation Specification when responsibilities remain distinct and circular dependencies are avoided.

---

### Architecture Decision Records

ADRs MAY depend on Foundation and other ADRs.

An ADR MAY reference downstream concerns for context.

It SHALL NOT depend on a specific downstream implementation for its validity unless the ADR explicitly records an implementation-specific decision.

---

### Governance

Governance MAY inspect all repository layers because it defines repository-wide controls.

Governance SHALL NOT take ownership of the business behavior defined by those layers.

---

### Knowledge

Knowledge Specifications MAY depend on Foundation, ADRs, Governance, and other Knowledge Specifications.

They MUST NOT depend on Product capabilities.

Knowledge is foundational to Product.

Product must consume Knowledge rather than define it.

---

### Product

Product Specifications MAY depend on Knowledge.

They MAY reference interfaces required to express capability boundaries.

They MUST NOT depend on component or runtime implementation details.

---

### Architecture

Architecture Specifications MAY depend on Product and Knowledge.

They MAY define the organization of Components but SHOULD NOT depend on a component implementation.

---

### Components

Component Specifications MAY depend on Architecture and governing Product or Knowledge Specifications.

They SHALL communicate through defined Interfaces where ownership boundaries are crossed.

---

### Interfaces

Interface Specifications MAY depend on the contracts and concepts they expose.

They SHALL NOT assume a specific implementation unless explicitly declared as implementation-specific.

---

### Runtime

Runtime Specifications MAY depend on all governing layers.

Runtime SHALL execute approved behavior but MUST NOT redefine it.

---

# 7. Artifact Domain Dependency Matrix

| From \ To         | Ontology | Schemas | Rules | Knowledge Objects | Templates | Examples | Reference | Meta |
| ----------------- | -------: | ------: | ----: | ----------------: | --------: | -------: | --------: | ---: |
| Ontology          |        A |       P |     P |                 P |         R |        R |         A |    C |
| Schemas           |        A |       A |     R |                 P |         R |        R |         A |    C |
| Rules             |        A |       A |     A |                 C |         R |        R |         A |    C |
| Knowledge Objects |        A |       A |     C |                 A |         R |        R |         A |    C |
| Templates         |        A |       A |     A |                 A |         A |        R |         A |    C |
| Examples          |        A |       A |     A |                 A |         A |        A |         A |    C |
| Reference         |        A |       R |     R |                 R |         R |        R |         A |    C |
| Meta              |        A |       A |     A |                 A |         A |        A |         A |    A |

---

# 8. Ontology Dependencies

Ontology defines semantic meaning.

Ontology MAY depend on:

* Foundation terminology
* Canonical Glossary
* approved external standards
* other ontology modules
* shared reference enumerations

Ontology MUST NOT depend on:

* persistence schemas
* source code
* plugins
* runtime behavior
* UI selectors
* provider-specific types
* test automation frameworks

The semantic meaning of an entity SHALL remain independent of its serialization and implementation.

Valid:

```text
Knowledge Object Schema
          ↓
Ontology Entity
```

Invalid:

```text
Ontology Entity
          ↓
Knowledge Object Database Table
```

---

# 9. Schema Dependencies

Schemas define machine-validatable structure.

Schemas MAY depend on:

* ontology entities
* shared schema definitions
* reference enumerations
* accepted specifications
* versioned interface contracts

Schemas MUST NOT:

* redefine ontology meaning
* contain hidden business decisions
* depend directly on source-code classes
* depend on vendor-specific objects outside an adapter boundary
* silently introduce required behavior not defined by a specification

Schema composition SHOULD use explicit versioned references.

Circular schema references SHALL be avoided.

Where recursive models are necessary, recursion SHALL be intentional, bounded where practical, and documented.

---

# 10. Rule Dependencies

Rules define deterministic decisions.

The Rule Engine and governed rules MAY depend on:

* ontology
* schema-validated input
* approved Knowledge Objects
* configuration explicitly authorized by policy
* deterministic utility functions
* reference enumerations

Rules MUST NOT depend directly on:

* LLM output without validation
* conversation history
* raw DOM
* external SDKs
* Playwright
* user interface components
* unapproved Knowledge Candidates
* plugin-specific response objects
* runtime logs as authoritative truth

Valid:

```text
Validated Input

↓

Knowledge Retrieval

↓

Rule Evaluation
```

Invalid:

```text
Rule

↓

LLM

↓

Decision
```

When a rule cannot resolve an input, it MAY return an unresolved result to the reasoning layer.

The rule itself SHALL NOT call an LLM to invent a resolution.

---

# 11. Knowledge Dependencies

Authoritative Knowledge Objects MAY depend on:

* ontology definitions
* schemas
* source evidence
* provenance records
* approved relationships
* lifecycle governance
* scoped identifiers
* version metadata

Knowledge Objects MUST NOT depend on:

* conversation history
* prompt text
* temporary session instructions
* unvalidated AI inference
* mutable display labels as identity
* implementation-specific object references
* inaccessible evidence without a documented retention policy

Knowledge Candidates MAY reference observations and provisional classifications.

Knowledge Candidates SHALL NOT be treated as authoritative dependencies by deterministic Product or Rule behavior.

Valid:

```text
Product Capability
        ↓
Approved Knowledge Object
```

Invalid:

```text
Product Capability
        ↓
Unapproved Knowledge Candidate
```

---

# 12. Product Dependencies

Product capabilities MAY depend on:

* approved Knowledge interfaces
* Rule Engine interfaces
* ontology concepts
* product-level requirements
* platform services through contracts
* discovery capabilities through contracts
* execution capabilities through contracts

Product capabilities MUST NOT depend directly on:

* Playwright
* Selenium
* Cypress
* Appium
* Jira SDK
* GitHub SDK
* OpenAI SDK
* database drivers
* browser-specific types
* storage implementation
* plugin implementation classes
* raw DOM

Product expresses business capability.

It does not own technology integration.

---

# 13. Architecture Module Dependencies

Architecture modules MAY depend on:

* Foundation
* ADRs
* Knowledge contracts
* Product contracts
* platform abstractions
* standard Interfaces
* shared architecture utilities

Architecture modules SHOULD depend on abstractions owned by the platform.

They MUST NOT depend directly on:

* external vendor SDKs
* plugin implementation internals
* database-specific models
* UI framework components
* model-provider response classes
* Workspace-private resources belonging to another Workspace

Architecture modules SHALL coordinate through explicit contracts rather than hidden shared state.

---

# 14. Component Dependencies

Components MAY depend on:

* their governing Architecture Specification
* their governing Product or Knowledge Specification
* platform Interfaces
* shared ontology and schemas
* approved utility components
* runtime abstractions where required

A component MUST NOT:

* import another component's internal implementation
* access another component's database tables directly
* mutate another component's owned state
* bypass an exposed contract
* own responsibilities assigned to another component
* create circular component dependencies

Valid:

```text
Component A

↓

Interface B

↓

Component B
```

Invalid:

```text
Component A

↓

Component B Internal Repository
```

---

# 15. Interface Dependencies

Interfaces define architectural boundaries.

Interfaces MAY depend on:

* ontology types
* versioned schemas
* normalized error models
* capability declarations
* lifecycle contracts
* security classifications

Interfaces MUST NOT expose:

* vendor SDK types
* database entity classes
* framework-specific request objects
* internal component state
* unversioned polymorphic payloads
* secrets
* implementation-only exceptions

Interface contracts SHALL remain stable enough for independent implementation and testing.

---

# 16. Runtime Dependencies

Runtime MAY depend on:

* application orchestration
* component interfaces
* plugin interfaces
* Execution Engine interfaces
* Workspace services
* observability interfaces
* configuration services
* security services

Runtime MUST NOT:

* redefine product requirements
* create new business rules
* promote Knowledge Candidates directly
* bypass governance
* invoke external systems outside an approved adapter
* infer Workspace scope implicitly
* use provider-specific behavior as platform truth

Runtime owns execution coordination.

It does not own business meaning.

---

# 17. Source-Code Dependency Direction

The recommended source-code dependency direction is:

```text
Entry Points

↓

Application Layer

↓

Domain Capabilities

↓

Domain Interfaces

↓

Adapter Interfaces

↓

Plugin and Infrastructure Implementations

↓

External Technologies
```

Dependencies between source-code packages SHOULD point inward toward stable contracts.

Infrastructure and plugins implement interfaces defined by the platform.

The platform domain SHALL NOT implement interfaces defined by a vendor adapter.

---

# 18. Runtime Source Dependency Matrix

| From \ To      | Domain | Application | Interfaces | Runtime | Plugins | Infrastructure | External SDK |
| -------------- | -----: | ----------: | ---------: | ------: | ------: | -------------: | -----------: |
| Domain         |      A |           P |          C |       P |       P |              P |            P |
| Application    |      A |           A |          C |       R |       P |              P |            P |
| Interfaces     |      A |           R |          A |       R |       P |              P |            P |
| Runtime        |      A |           A |          A |       A |       C |              C |            P |
| Plugins        |      A |           R |          A |       R |       R |              C |            A |
| Infrastructure |      A |           R |          A |       R |       R |              A |            A |
| Entry Points   |      A |           A |          A |       A |       C |              C |            R |

## 18.1 Domain

Domain contains platform meaning and deterministic behavior.

Domain SHALL remain free from runtime, plugin, infrastructure, and vendor dependencies.

---

## 18.2 Application

Application orchestrates domain capabilities.

Application MAY depend on interfaces.

It SHALL NOT directly instantiate vendor clients.

---

## 18.3 Runtime

Runtime wires dependencies and manages execution.

Runtime MAY select plugin and infrastructure implementations through contracts.

---

## 18.4 Plugins

Plugins implement platform interfaces.

Plugins MAY use external SDKs.

Plugins SHALL NOT become an upstream dependency of Domain or Product code.

---

## 18.5 Infrastructure

Infrastructure provides storage, messaging, caching, secrets, telemetry, and similar technical services.

Infrastructure SHALL implement platform-owned contracts.

---

# 19. Plugin Dependency Rules

A plugin MAY depend on:

* its platform-defined plugin interface
* shared normalized schemas
* shared error contracts
* capability definitions
* vendor SDKs
* approved infrastructure services
* plugin-local utilities

A plugin MUST NOT depend on:

* another plugin implementation
* Product internals
* Knowledge Store internals
* Rule Engine internals
* Workspace-private state outside the supplied context
* another provider's SDK
* undocumented global mutable state

Cross-plugin workflows SHALL be coordinated by Core or Runtime.

Invalid:

```text
Jira Plugin

↓

GitHub Plugin
```

Valid:

```text
Jira Plugin
        ↑
Core Orchestrator
        ↓
GitHub Plugin
```

Plugins MAY share platform-provided libraries when those libraries contain no plugin-specific business coordination.

---

# 20. Execution Engine Dependency Rules

Execution Engine implementations MAY depend on:

* the Execution Engine interface
* normalized execution schemas
* evidence contracts
* platform error models
* Workspace execution context
* technology-specific SDKs

An Execution Engine implementation MUST NOT depend on:

* Product internals
* business-rule ownership
* Knowledge Candidate approval logic
* another Execution Engine implementation
* report-generation internals
* unrelated plugins

Playwright-specific code SHALL remain inside the Playwright execution adapter.

Core SHALL depend on:

```text
Execution Engine Interface
```

Core SHALL NOT depend on:

```text
Playwright API
```

---

# 21. LLM Dependency Rules

LLM access SHALL occur through a governed AI provider interface.

The AI adapter MAY depend on:

* provider SDK
* model capability declarations
* prompt-rendering infrastructure
* structured-output adapters
* token accounting
* provider-specific error translation

The following modules MUST NOT depend directly on an LLM provider:

* Rule Engine
* Knowledge Store
* Ontology
* schemas
* plugins unrelated to AI
* Execution Engine
* Workspace storage
* deterministic validation components
* Product modules

Reasoning modules MAY depend on the platform AI interface.

They SHALL validate output before it enters Product, Knowledge, Rule, or Execution workflows.

Invalid:

```text
Rule Engine

↓

OpenAI SDK
```

Valid:

```text
Reasoning Service

↓

AI Provider Interface

↓

OpenAI Adapter
```

---

# 22. Semantic UI Dependency Rules

The Semantic UI pipeline SHALL follow:

```text
DOM Collector

↓

DOM Cleaner

↓

Semantic Analyzer

↓

Feature Extractor

↓

Semantic UI

↓

UI Knowledge Graph
```

Allowed dependencies:

* DOM Cleaner → collected DOM evidence
* Semantic Analyzer → cleaned DOM
* Feature Extractor → semantic entities
* UI Knowledge Graph → Semantic UI entities and relationships
* Reasoning → Semantic UI and UI Knowledge Graph

Prohibited dependencies:

* LLM → raw DOM as primary input
* Product behavior → CSS selector
* Business Rule → browser node reference
* Ontology → page implementation
* UI Knowledge Graph → Playwright object handle
* Semantic UI identity → mutable selector only

Raw DOM SHALL remain evidence, not the canonical semantic model.

---

# 23. Discovery Dependency Rules

Discovery MAY depend on:

* Knowledge retrieval
* plugin interfaces
* Semantic UI pipeline
* API discovery interfaces
* repository search interfaces
* execution evidence interfaces
* Workspace context

Discovery MUST NOT:

* ask the user before checking available authorized sources
* persist observations directly as Knowledge Objects
* bypass scope or authorization
* use external technology without a plugin
* treat incomplete evidence as confirmed business truth

The preferred dependency sequence is:

```text
Task

↓

Workspace Context

↓

Knowledge Retrieval

↓

Discovery Sources

↓

Rule Evaluation

↓

Reasoning

↓

User Question When Necessary
```

---

# 24. Workspace Dependency Rules

Every project-scoped operation SHALL depend on an explicit Workspace context.

Workspace-scoped services MAY depend on:

* organization-level shared services
* global read-only ontology
* approved templates
* platform plugin registry
* scoped credentials
* Workspace configuration

A Workspace MUST NOT depend on:

* another Workspace's private data
* another Workspace's credentials
* another Workspace's runtime state
* another Workspace's temporary session context
* implicit global project state

Cross-Workspace access requires:

* explicit authorization
* explicit source and target scopes
* auditable policy
* contract-defined behavior
* conflict-handling rules

---

# 25. Credential Dependency Rules

Components SHALL access credentials through an approved credential interface.

They MUST NOT depend on:

* environment variables scattered through business code
* plaintext configuration
* specification content
* prompt content
* test fixtures containing real secrets
* Knowledge Objects
* conversation context

Credential references MAY cross interfaces.

Credential values SHOULD remain inside the credential provider and consuming adapter boundary.

---

# 26. Configuration Dependency Rules

Configuration MAY influence:

* provider selection
* feature activation
* retry limits
* timeouts
* thresholds authorized by governance
* resource limits
* environment behavior

Configuration MUST NOT:

* override Engineering Laws
* override accepted ADRs
* redefine ontology
* contain hidden business rules
* bypass validation
* authorize destructive behavior by itself
* disable required governance without explicit policy

Configuration schemas SHALL be versioned.

Configuration inheritance SHALL respect:

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

Narrower scopes MAY override broader scopes only when the property permits scoped override.

---

# 27. Event Dependency Rules

Events MAY be used to reduce direct coupling.

An event producer SHALL depend on an event contract.

It SHALL NOT depend on event consumers.

An event consumer SHALL depend on the event contract, not on the producer implementation.

Events SHALL include:

* event type
* version
* event identifier
* timestamp
* source
* Workspace scope
* correlation identifier
* payload schema
* provenance where applicable

Events MUST NOT be used to hide synchronous ownership or transactional requirements.

Event chains that affect authoritative knowledge SHALL preserve validation and governance.

---

# 28. Persistence Dependency Rules

Domain and Product modules SHALL access persistence through platform-owned repository interfaces.

They SHALL NOT depend directly on:

* SQL dialect
* database driver
* collection name
* table structure
* ORM entity
* search-engine SDK
* graph database SDK

Persistence adapters MAY depend on those implementation technologies.

Valid:

```text
Knowledge Service

↓

Knowledge Repository Interface

↓

PostgreSQL Adapter
```

Invalid:

```text
Knowledge Service

↓

PostgreSQL Client
```

Persisted structures SHALL conform to approved schemas and lifecycle rules.

---

# 29. Test Dependency Rules

Tests MAY depend on the artifact or contract they validate.

Test categories SHALL observe the following boundaries.

## 29.1 Unit Tests

Unit tests SHOULD depend only on the unit and stable test utilities.

They SHOULD NOT require external systems.

---

## 29.2 Contract Tests

Contract tests SHALL depend on versioned Interfaces and Schemas.

They MAY certify multiple implementations against the same contract.

---

## 29.3 Integration Tests

Integration tests MAY depend on adapters and controlled infrastructure.

They SHALL preserve Workspace and credential isolation.

---

## 29.4 Architecture Tests

Architecture tests SHOULD validate:

* forbidden imports
* cyclic dependencies
* plugin boundaries
* domain independence
* provider isolation
* Workspace isolation
* interface usage

---

## 29.5 End-to-End Tests

End-to-end tests MAY cross multiple layers through supported entry points.

They SHALL NOT be used as the only validation of domain rules or contracts.

---

# 30. Documentation Dependency Rules

Documents MAY reference authoritative artifacts.

They MUST NOT duplicate authoritative definitions without clearly identifying the source.

Derived documents SHALL declare:

* source artifacts
* generation method where applicable
* generated status
* synchronization expectations

Examples and tutorials MAY simplify behavior.

They SHALL clearly distinguish simplification from normative requirements.

---

# 31. Meta and Index Dependencies

The `meta/` layer MAY depend on all artifact domains for indexing and graph generation.

Repository artifacts MUST NOT depend on an index as their sole source of truth.

Valid:

```text
SPEC-101

↓

Ontology definitions
```

Invalid:

```text
SPEC-101

↓

SPEC_INDEX.yaml

↓

Ontology definition inferred indirectly
```

Indexes are derived navigation artifacts.

When an index conflicts with an authoritative artifact, the authoritative artifact wins.

---

# 32. Circular Dependency Rules

Circular dependencies are prohibited between:

* specification layers
* runtime components
* plugins
* schemas, unless recursion is an explicit domain requirement
* module ownership boundaries
* Knowledge and Product definitions

A detected cycle SHALL be resolved by one or more of the following:

* extract a stable shared contract
* move the responsibility to its authoritative owner
* introduce an event boundary
* invert the dependency
* remove duplicate ownership
* split the artifact or component
* revise the architecture decision

Cycles SHALL NOT be hidden through:

* dynamic imports
* service locators
* global registries
* reflection
* event misuse
* duplicated types
* shared mutable state

---

# 33. Transitive Dependency Rules

A dependency that is prohibited directly SHALL also be prohibited transitively when it exposes the same coupling.

Example:

```text
Core

↓

Shared Utility

↓

Playwright
```

This is still a prohibited Core-to-Playwright dependency.

Shared modules SHALL NOT be used to conceal vendor or layer violations.

Every transitive dependency SHALL be evaluated by its actual architectural effect.

---

# 34. Optional Dependency Rules

Optional dependencies SHALL:

* be declared explicitly
* expose capability availability
* define degraded behavior
* avoid silent fallback that changes business meaning
* define failure behavior
* preserve observability

Optional does not mean ungoverned.

A missing optional dependency SHALL NOT cause the system to report a capability it cannot provide.

---

# 35. Dependency Injection Rules

Runtime implementations SHOULD receive dependencies through explicit construction or approved dependency injection.

Dependency injection SHALL NOT become:

* a hidden service locator
* an untyped global registry
* a bypass around ownership
* a mechanism for arbitrary implementation access

Injected dependencies SHALL use platform-owned contracts.

Required dependencies SHALL fail during initialization when unavailable.

Optional dependencies SHALL expose explicit absence.

---

# 36. Dependency Versioning

Versioned dependencies SHALL declare compatible ranges or exact versions according to their stability and risk.

The following artifacts SHALL be version-aware:

* Interfaces
* schemas
* events
* rules
* Knowledge Objects
* plugin contracts
* execution contracts
* persisted data
* external standards

A component SHALL NOT assume compatibility based only on artifact name.

Breaking dependency changes require:

* version increment
* impact analysis
* migration plan
* consumer identification
* compatibility testing
* changelog update

---

# 37. Dependency Ownership

Every dependency SHALL have:

* an owning artifact or module
* a consuming artifact or module
* an explicit contract when crossing boundaries
* a compatibility expectation
* a failure expectation
* a lifecycle policy where applicable

Shared dependencies without ownership are prohibited.

A dependency owner is responsible for:

* contract accuracy
* versioning
* compatibility communication
* deprecation
* migration guidance
* conformance tests

---

# 38. Dependency Review Questions

Every design review SHALL answer:

1. What does this artifact depend on?
2. Why is each dependency required?
3. Is the target the authoritative owner?
4. Is the dependency direction valid?
5. Does the dependency cross an ownership boundary?
6. Is an interface required?
7. Are vendor-specific types leaking?
8. Is Workspace scope explicit?
9. Is the dependency versioned?
10. What happens if the dependency fails?
11. Can the dependency create a cycle?
12. Is the dependency direct or hidden transitively?
13. Does it bypass Knowledge, Rules, Governance, or Plugins?
14. Can the dependency be replaced?
15. Is the dependency testable?

---

# 39. Prohibited Dependency Catalogue

The following dependencies are prohibited by default.

```text
Foundation → downstream specification

Knowledge → Product

Knowledge → Runtime

Knowledge → Plugin implementation

Ontology → Schema implementation

Ontology → Database

Ontology → Vendor SDK

Rule Engine → LLM provider

Rule Engine → Conversation history

Rule Engine → Raw DOM

Product → Playwright

Product → External SDK

Product → Database driver

Core → Vendor SDK

Core → Plugin implementation

Plugin → Plugin

Plugin → Business-rule ownership

Execution Engine → Product decision ownership

Runtime → New business rule

Workspace A → Workspace B private state

Knowledge Object → Credential value

Prompt → Authoritative business rule

LLM output → Direct high-risk execution

Knowledge Candidate → Deterministic Product behavior

Implementation → Redefinition of accepted specification

Test fixture → Production credential

Shared utility → Hidden vendor dependency
```

Any exception requires architecture review and a time-bounded exception record.

---

# 40. Allowed Dependency Catalogue

The following dependencies are expected.

```text
Specification → Foundation

Specification → Related ADR

Product → Knowledge Interface

Product → Rule Engine Interface

Architecture → Product Specification

Architecture → Knowledge Specification

Component → Architecture Specification

Component → Platform Interface

Runtime → Component Interface

Runtime → Plugin Interface

Plugin → External SDK

Infrastructure Adapter → Infrastructure Technology

Schema → Ontology

Rule → Schema-validated Input

Rule → Approved Knowledge Object

Knowledge Object → Evidence

Knowledge Object → Ontology

Execution Plugin → Execution Engine Interface

Reasoning Service → AI Provider Interface

AI Adapter → AI Provider SDK

Test → Governing Contract
```

Expected dependencies still require clear ownership and versioning.

---

# 41. Restricted Dependencies

The following dependencies require explicit review.

## 41.1 ADR to Downstream Implementation

An ADR may discuss implementation context.

It SHOULD remain valid independently of one implementation unless the implementation choice is itself the decision.

---

## 41.2 Architecture to Runtime

Architecture may constrain runtime behavior.

It SHOULD not depend on runtime implementation details.

---

## 41.3 Interface to Runtime

An interface may include lifecycle or execution semantics.

It MUST remain independently implementable.

---

## 41.4 Rule to External Reference Data

A deterministic rule may use approved external reference data through a normalized, versioned, cached, and governed data contract.

It MUST NOT call arbitrary external services during evaluation without an explicit architecture decision.

---

## 41.5 Knowledge to External Source

Knowledge may derive from external sources.

The dependency SHALL be represented as provenance and evidence, not as an uncontrolled runtime dependency.

---

# 42. Dependency Violation Severity

Violations SHALL be classified as follows.

## Critical

A dependency:

* bypasses security or authorization
* crosses Workspace isolation
* exposes credentials
* allows unvalidated AI output to execute destructive action
* makes unapproved knowledge authoritative
* permits external content to redefine governance

Critical violations SHALL block implementation and merge.

---

## High

A dependency:

* puts business logic inside a plugin
* makes Core depend on a vendor SDK
* makes Rule Engine depend on an LLM
* creates circular ownership
* bypasses an authoritative interface
* allows Product to depend on raw DOM

High violations SHALL block merge.

---

## Medium

A dependency:

* leaks implementation types
* lacks explicit versioning
* uses an undocumented shared utility
* creates excessive coupling
* bypasses a recommended abstraction without changing ownership

Medium violations require correction or approved exception.

---

## Low

A dependency:

* causes documentation coupling
* introduces avoidable but contained duplication
* reduces replaceability without affecting correctness

Low violations SHOULD be corrected before acceptance or recorded for remediation.

---

# 43. Dependency Exception Process

A prohibited or restricted dependency MAY be temporarily accepted only when:

* no safe immediate alternative exists
* the dependency is explicitly identified
* the scope is bounded
* risks are documented
* mitigation exists
* an owner is assigned
* architecture approval is recorded
* an expiration date is assigned
* a removal plan exists

Exception metadata SHALL include:

```yaml
id:
status:
source:
target:
classification:
reason:
scope:
risk:
mitigation:
owner:
approved_by:
created_at:
expires_at:
removal_plan:
related_specs:
related_adrs:
```

An expired exception SHALL become an active violation.

Exceptions MUST NOT silently become permanent architecture.

---

# 44. Automated Conformance

The repository SHOULD automate dependency validation where practical.

Automated checks SHOULD include:

* forbidden import detection
* package-layer rules
* circular dependency detection
* vendor SDK boundary detection
* direct plugin-to-plugin imports
* Core-to-adapter imports
* schema reference validation
* specification dependency validation
* broken artifact references
* Workspace scope checks
* unversioned interface detection
* credential scanning
* architecture exception expiry

Suggested test category:

```text
tests/architecture/
```

Suggested artifacts:

```text
tests/architecture/test_dependency_direction.*

tests/architecture/test_forbidden_imports.*

tests/architecture/test_plugin_isolation.*

tests/architecture/test_workspace_isolation.*

tests/architecture/test_schema_dependencies.*

tests/architecture/test_exception_expiry.*
```

Tool selection SHALL be implementation-language-specific and defined later.

---

# 45. Machine-Readable Dependency Model

The human-readable matrix SHOULD be complemented by:

```text
meta/REPOSITORY_GRAPH.yaml
```

or:

```text
meta/DEPENDENCY_GRAPH.yaml
```

A machine-readable dependency record SHOULD contain:

```yaml
source:
target:
type:
classification:
contract:
version:
scope:
owner:
evidence:
exception:
```

The machine-readable graph is derived governance metadata.

This document remains the normative dependency policy unless superseded by a versioned policy specification.

---

# 46. AI Agent Instructions

Before creating or modifying an artifact, an AI agent SHALL:

1. identify the artifact layer
2. list required dependencies
3. identify the owner of every dependency
4. check this matrix
5. detect direct and transitive prohibited dependencies
6. determine whether a contract is required
7. identify potential cycles
8. verify Workspace scope
9. verify version compatibility
10. report unresolved violations
11. avoid implementation until blocking violations are resolved
12. update machine-readable dependency metadata where required

An AI agent MUST NOT conceal a dependency violation by introducing:

* generic utility modules
* untyped dictionaries
* dynamic imports
* global state
* duplicated models
* provider-name conditionals
* hidden prompt logic

---

# 47. Dependency Review Checklist

## Artifact Dependencies

```text
□ The artifact depends only on valid upstream authorities.

□ The dependency owner is identified.

□ No definition is duplicated.

□ No circular dependency exists.

□ Dependency metadata is current.
```

## Source-Code Dependencies

```text
□ Domain code has no vendor dependencies.

□ Core does not import plugin implementations.

□ External SDKs remain inside adapters.

□ Cross-component calls use interfaces.

□ Transitive dependencies are valid.
```

## Knowledge and Rules

```text
□ Rules depend only on validated inputs.

□ Rules do not invoke LLMs.

□ Product does not depend on Knowledge Candidates.

□ Knowledge preserves ontology and schema ownership.

□ Conversation history is not authoritative.
```

## AI

```text
□ AI access uses a provider interface.

□ Provider-specific types do not leak.

□ AI output is validated.

□ AI does not authorize high-risk execution.

□ Deterministic components remain AI-independent.
```

## Workspace and Security

```text
□ Workspace context is explicit.

□ No private cross-Workspace access exists.

□ Credential values do not cross unsafe boundaries.

□ Permissions follow least privilege.

□ Sensitive dependencies are auditable.
```

## Plugins and Execution

```text
□ Plugins do not depend on other plugins.

□ Plugins contain no business-rule ownership.

□ Execution uses the Execution Engine interface.

□ Core does not depend on Playwright.

□ Execution results use normalized contracts.
```

---

# 48. Definition of Done

## 48.1 Downstream Specification Dependency Registry

| Source family | Depends on | Implemented by or consumed by |
|---|---|---|
| SPEC-101–105 Knowledge | Foundation, Governance, ADRs, earlier Knowledge specs | Product and Architecture |
| SPEC-201–212 Product | accepted Knowledge contracts and earlier Product capabilities | Architecture modules |
| SPEC-301–308 Architecture | Knowledge and Product meaning | Interface contracts |
| SPEC-501–507 Interfaces | ontology, schemas, lifecycle and security contracts | SPEC-401–409 Components |
| SPEC-401–409 Components | governing specifications and versioned Interfaces | Runtime composition |
| SPEC-601–605 Runtime | all governing layers and component/interface contracts | implementation and operations |

Canonical implementation edges are `SPEC-501 → SPEC-401`, `SPEC-502 → SPEC-402`, `SPEC-503 → SPEC-405/407/409`, `SPEC-504 → SPEC-404/407`, and `SPEC-506 → SPEC-401–409`.

The arrow means “contract is implemented or consumed by,” never “contract depends on implementation.”

---

This document is complete when:

* repository-layer dependencies are defined
* source-code dependency direction is defined
* ontology dependencies are defined
* schema dependencies are defined
* rule dependencies are defined
* knowledge dependencies are defined
* Product dependencies are defined
* component dependencies are defined
* plugin dependencies are defined
* Execution Engine dependencies are defined
* AI provider dependencies are defined
* Workspace dependencies are defined
* test dependencies are defined
* prohibited dependencies are catalogued
* exceptions are governed
* automated conformance expectations are defined

Dependency governance implementation is complete when:

* machine-readable dependency metadata exists
* forbidden imports are checked automatically
* circular dependencies are detected
* plugin boundaries are tested
* Core vendor independence is tested
* Workspace isolation is tested
* expired exceptions are detected
* dependency violations block merge according to severity

---

# 49. Summary

QA Intelligence SHALL preserve the following dependency model:

```text
Foundation and Decisions

↓

Semantic and Behavioral Contracts

↓

Product Capabilities

↓

Architecture and Components

↓

Interfaces

↓

Runtime Orchestration

↓

Plugins and Infrastructure

↓

External Technologies
```

Knowledge SHALL remain upstream of Product behavior.

Rules SHALL remain deterministic and independent of LLM providers.

Core SHALL remain independent of external technologies.

Plugins SHALL adapt external technologies without owning business logic.

Workspaces SHALL remain isolated.

Runtime SHALL execute approved intent without redefining it.

Every dependency SHALL be explicit, owned, reviewable, versioned where necessary, and testable.

A dependency that cannot be explained is not an acceptable dependency.
