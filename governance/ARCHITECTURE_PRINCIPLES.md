---
id: GOV-001
title: Architecture Principles
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
  - SPEC-007
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

# Architecture Principles

## 1. Purpose

This document defines the architecture principles that govern the design, implementation, review, and evolution of QA Intelligence.

The principles consolidate the system-wide constraints established by:

* the product vision
* product principles
* engineering laws
* AI governance
* the canonical glossary
* the system landscape
* accepted Architecture Decision Records

This document provides a concise architecture review baseline for humans and AI agents.

It does not replace the authoritative specifications or ADRs from which these principles are derived.

When this document conflicts with an accepted specification or ADR, the authoritative source SHALL take precedence.

---

## 2. Scope

These principles apply to:

* specifications
* architecture decisions
* ontology
* schemas
* knowledge models
* business rules
* product capabilities
* architecture modules
* components
* plugins
* runtime services
* AI agents
* source code
* tests
* deployment design
* repository governance

Every technical and product design SHALL be evaluated against these principles.

---

## 3. Architecture Hierarchy

QA Intelligence SHALL follow this authority hierarchy:

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
Runtime Behavior
```

A lower layer MUST NOT silently redefine a higher layer.

Implementation behavior is not an authoritative architecture source.

When implementation and specification conflict, the conflict SHALL be resolved explicitly rather than normalized as accepted behavior.

---

# 4. Core Architecture Principles

## AP-001: Understand Before Generate

The system SHALL establish sufficient understanding before generating an engineering artifact.

Generated artifacts include:

* requirements
* business rules
* risk assessments
* test strategies
* test cases
* test data
* automation
* reports
* Knowledge Candidates

Generation SHALL be based on:

* validated knowledge
* discoverable evidence
* deterministic rules
* explicit assumptions
* governed AI reasoning

The system MUST NOT generate outputs solely because a prompt requests them when required context remains unresolved.

### Review Questions

* What evidence supports the generated output?
* Which knowledge and rules were used?
* Which assumptions remain unresolved?
* Is generation occurring before sufficient understanding?

---

## AP-002: Discover Before Asking

The system SHALL retrieve and discover available information before requesting user input.

The preferred sequence is:

```text
Existing Knowledge
      ↓
Repository Evidence
      ↓
Application Discovery
      ↓
API and Documentation Discovery
      ↓
Execution Evidence
      ↓
User Question
```

User interaction is an escalation mechanism, not the default information source.

The system SHALL NOT ask for information that is already available through authorized discovery.

### Review Questions

* Was existing knowledge queried first?
* Were available discovery sources inspected?
* Is every requested user input genuinely unresolved?
* Can the number of questions be reduced?

---

## AP-003: Knowledge Before Memory

Persistent system understanding SHALL be represented as structured knowledge.

Conversation history SHALL NOT be treated as authoritative knowledge.

Information that may influence future behavior SHALL pass through the governed Knowledge Candidate lifecycle before becoming a Knowledge Object.

The system MUST NOT depend on conversational context for long-term correctness.

### Review Questions

* Is persistent information stored as a structured Knowledge Object?
* Is conversation history being used as a hidden database?
* Does the information have provenance, scope, status, and version?
* Has temporary context been incorrectly promoted to knowledge?

---

## AP-004: Business Before UI

The system SHALL reason about business intent before reasoning about interface mechanics.

UI elements are implementation evidence of business behavior.

They are not the business model itself.

The system SHOULD understand:

* business entities
* business processes
* business rules
* user goals
* validations
* state transitions

before generating UI-level automation.

### Review Questions

* Is the design modeling business intent or only UI actions?
* Can the behavior survive a UI redesign?
* Are business entities and rules explicitly represented?
* Is UI structure being mistaken for business meaning?

---

## AP-005: Rules Before Prompts

Deterministic rules SHALL be evaluated before probabilistic AI reasoning.

The decision sequence SHALL be:

```text
Input Validation
      ↓
Knowledge Retrieval
      ↓
Rule Evaluation
      ↓
Deterministic Resolution
      ↓
LLM Reasoning When Required
      ↓
Output Validation
```

Prompts SHALL NOT be the authoritative location for:

* business rules
* validation logic
* governance policies
* execution constraints
* knowledge
* architecture decisions

### Review Questions

* Can this behavior be expressed deterministically?
* Is business logic hidden inside a prompt?
* Is the Rule Engine invoked before the LLM?
* Is the LLM duplicating an existing rule?

---

## AP-006: Single Source of Truth

Every governed concept SHALL have one authoritative owner.

Examples:

* ADRs own architecture decisions.
* Specifications own behavioral and structural contracts.
* Ontology owns semantic meaning.
* Schemas own machine-validatable structures.
* Rules own deterministic decisions.
* Knowledge Objects own validated domain knowledge.

Other artifacts MAY reference or summarize authoritative sources but MUST NOT redefine them.

### Review Questions

* Which artifact owns this concept?
* Does another artifact define the same concept differently?
* Can duplicate content be replaced with a reference?
* Is ownership clear and enforceable?

---

## AP-007: Structured Knowledge Over Unstructured Context

Information used for repeatable system reasoning SHALL be structured whenever practical.

Structured information SHOULD include:

* stable identifiers
* types
* scope
* relationships
* provenance
* evidence
* confidence
* lifecycle status
* version

Unstructured text MAY be retained as evidence but SHALL NOT replace normalized knowledge.

### Review Questions

* Is important information only present in prose?
* Can it be represented as a schema-validated object?
* Are relationships explicit?
* Can the system retrieve and compare it deterministically?

---

## AP-008: Observation Is Not Knowledge

Raw observations SHALL be treated as evidence.

They SHALL NOT immediately become authoritative knowledge.

Examples of observations include:

* discovered UI behavior
* API responses
* execution logs
* AI inferences
* user statements
* screenshots
* defect reports
* repository changes

The required lifecycle is:

```text
Observation
      ↓
Knowledge Candidate
      ↓
Classification
      ↓
Normalization
      ↓
Conflict Detection
      ↓
Validation
      ↓
Approval
      ↓
Knowledge Object
```

### Review Questions

* Is an observation being persisted directly?
* Has the candidate been classified and normalized?
* Were conflicts checked?
* Was the approval policy applied?

---

## AP-009: Controlled Learning

Learning SHALL be governed, traceable, versioned, and reversible.

Only approved Knowledge Objects may influence deterministic reasoning.

Automatic learning MAY be permitted for low-risk knowledge when an explicit governance policy authorizes it.

Business rules, regulatory requirements, and validation behavior SHOULD require human validation unless a stricter approved policy exists.

### Review Questions

* What is being learned?
* Who or what approved it?
* Can the learned knowledge be revoked?
* Is the learning scope appropriate?
* Is the original evidence preserved?

---

## AP-010: Explain Every Decision

Every significant system decision SHALL be explainable.

An explanation SHOULD identify:

* inputs
* knowledge used
* rules applied
* evidence considered
* confidence
* assumptions
* selected outcome
* rejected alternatives
* responsible module

The system SHALL NOT rely on hidden reasoning as the sole justification for an action.

### Review Questions

* Can the system explain why this outcome occurred?
* Are the supporting rules and evidence identifiable?
* Are assumptions visible?
* Can the decision be audited later?

---

## AP-011: Preserve Traceability

Important artifacts SHALL remain connected throughout the engineering lifecycle.

The target traceability chain is:

```text
Requirement
      ↓
Business Rule
      ↓
Validation Rule
      ↓
Risk
      ↓
Test Strategy
      ↓
Test Case
      ↓
Automation
      ↓
Execution
      ↓
Observation
      ↓
Knowledge Candidate
      ↓
Knowledge Object
```

Traceability SHALL use stable identifiers rather than fragile text matching whenever possible.

### Review Questions

* Can the artifact be traced to its origin?
* Can execution results be traced to a requirement or rule?
* Are identifiers stable?
* Does the change impact chain remain discoverable?

---

## AP-012: Semantic UI Instead of Raw DOM

LLMs SHALL NOT reason directly over raw HTML as their primary UI representation.

The UI reasoning pipeline SHALL be:

```text
Raw DOM
      ↓
DOM Cleaning
      ↓
Semantic Analysis
      ↓
Semantic UI
      ↓
UI Knowledge Graph
      ↓
Reasoning
```

Raw DOM MAY be retained as supporting evidence.

Semantic UI is the canonical representation for UI meaning.

### Review Questions

* Is raw HTML being sent directly to an LLM?
* Has irrelevant DOM noise been removed?
* Are business roles and relationships represented?
* Is the semantic representation traceable to source evidence?

---

## AP-013: Relationships Are First-Class Knowledge

QA Intelligence SHALL model important relationships explicitly.

A collection of isolated documents or entities is insufficient for reasoning about complex systems.

The UI Knowledge Graph and broader knowledge graph SHOULD represent relationships such as:

* requirement defines business rule
* rule validates field
* feature contains screen
* screen contains semantic element
* test case verifies requirement
* automation implements test case
* execution produces observation
* candidate derives from evidence

### Review Questions

* Are meaningful relationships modeled explicitly?
* Is the design relying on inference from document proximity?
* Can graph traversal answer impact questions?
* Are relationship provenance and confidence preserved?

---

## AP-014: Stable Identity Over Mutable Representation

Core entities SHALL use stable identifiers independent of labels, locations, selectors, or display text.

Examples include:

* Knowledge Object IDs
* requirement IDs
* rule IDs
* semantic UI IDs
* test case IDs
* workspace IDs
* plugin IDs
* execution IDs

Mutable attributes SHALL NOT be used as the sole identity mechanism.

### Review Questions

* Will this entity remain identifiable after a rename?
* Is identity tied to a CSS selector or display label?
* Can versions and relationships reference it safely?
* Is identifier reuse prevented?

---

## AP-015: Provenance Is Mandatory

Every authoritative knowledge item and significant derived artifact SHALL preserve provenance.

Provenance SHOULD identify:

* origin
* source type
* source identifier
* timestamp
* originating Workspace
* extraction or creation method
* supporting evidence
* responsible agent or user
* approval path

Knowledge without provenance SHALL NOT be treated as fully trustworthy.

### Review Questions

* Where did this information come from?
* Is the source immutable or retrievable?
* Can the transformation path be reconstructed?
* Is the approver or approval policy known?

---

## AP-016: Evidence Must Be Preserved

Reasoning and learning SHALL retain the evidence required for later validation.

Normalization SHALL NOT destroy original evidence.

Generated summaries MAY improve accessibility but SHALL NOT replace source evidence.

Evidence retention SHALL follow applicable security and data-retention policies.

### Review Questions

* Can the original evidence be inspected?
* Has normalization removed important details?
* Is evidence linked rather than copied unnecessarily?
* Are retention and access rules defined?

---

## AP-017: Confidence Is Not Authority

Confidence scores represent estimated certainty.

They do not establish truth or authorization.

A high-confidence inference SHALL NOT bypass:

* governance
* conflict detection
* approval requirements
* schema validation
* security policy
* deterministic rules

### Review Questions

* Is confidence being used as approval?
* Is the source reliable?
* Does governance permit automatic acceptance?
* Are conflicts present despite high confidence?

---

## AP-018: Human Validation Before High-Risk Learning

Knowledge that materially affects business behavior, compliance, security, or irreversible execution SHALL require human validation unless an accepted governance policy explicitly states otherwise.

High-risk knowledge includes:

* business rules
* financial rules
* regulatory requirements
* security controls
* destructive operations
* production execution decisions

### Review Questions

* What is the impact of incorrect learning?
* Is human approval required?
* Is the approver authorized?
* Can the decision be reversed?

---

# 5. System Structure Principles

## AP-019: Clear Domain Ownership

Every module, component, and artifact SHALL have a clearly defined owner and responsibility.

Ownership SHALL answer:

* what the unit owns
* what it may change
* what it exposes
* what it depends on
* what it must not contain

Shared ownership without a governing contract SHOULD be avoided.

### Review Questions

* Which module owns this behavior?
* Is responsibility duplicated?
* Does the unit expose a clear contract?
* Is ownership documented?

---

## AP-020: One Responsibility Per Module

A module SHALL have one primary reason to change.

Modules SHOULD NOT combine unrelated responsibilities such as:

* knowledge persistence and UI automation
* rule evaluation and external API integration
* discovery and approval governance
* plugin adaptation and business reasoning

When responsibilities diverge, the module SHALL be decomposed.

### Review Questions

* What is the module's single primary responsibility?
* How many unrelated reasons can cause it to change?
* Can parts evolve independently?
* Does the name accurately describe its responsibility?

---

## AP-021: Separation of Reasoning and Execution

Reasoning determines what should happen.

Execution performs the approved action.

These concerns SHALL remain separate.

```text
Knowledge and Evidence
      ↓
Reasoning
      ↓
Decision or Plan
      ↓
Validation
      ↓
Execution
      ↓
Evidence and Results
```

Execution engines SHALL NOT redefine business intent.

### Review Questions

* Is execution logic making business decisions?
* Can reasoning be tested without real execution?
* Is the execution plan explicit?
* Can execution results be compared against the original intent?

---

## AP-022: Core Platform Is Technology-Independent

The Core Platform SHALL depend on platform-owned abstractions rather than vendor-specific SDKs or infrastructure.

Technology-specific dependencies SHALL remain behind plugin or infrastructure adapters.

The Core Platform MUST NOT directly depend on:

* Playwright
* Selenium
* Jira SDKs
* GitHub SDKs
* AI provider SDKs
* cloud-provider APIs
* database-specific clients

except inside approved adapter boundaries.

### Review Questions

* Does Core import a vendor library?
* Can the external technology be replaced?
* Is the dependency hidden behind an interface?
* Has vendor behavior leaked into domain logic?

---

## AP-023: Plugin as Adapter

All external-system communication SHALL occur through plugins implementing platform-defined interfaces.

Plugins SHALL:

* translate platform requests
* translate external responses
* expose capabilities
* translate errors
* manage technology-specific lifecycle behavior

Plugins SHALL NOT:

* own business rules
* make product decisions
* communicate directly with other plugins
* redefine platform contracts

### Review Questions

* Is this integration implemented as a plugin?
* Does the plugin contain business logic?
* Does it expose vendor-specific types?
* Is cross-plugin coordination routed through Core?

---

## AP-024: Capability Over Implementation Identity

The system SHALL reason about what a provider can do rather than which provider it is.

Examples:

```text
supports_browser_automation
supports_network_capture
supports_trace_recording
supports_issue_creation
supports_repository_search
supports_structured_output
```

Core behavior SHOULD depend on capability declarations and contracts.

It SHOULD NOT branch on vendor names unless required by an explicitly approved compatibility rule.

### Review Questions

* Is behavior selected by provider name?
* Can capability negotiation replace vendor-specific logic?
* Are required and optional capabilities declared?
* Is graceful degradation defined?

---

## AP-025: Standard Contracts at Boundaries

Every architectural boundary SHALL use an explicit contract.

Contracts SHOULD define:

* input
* output
* errors
* lifecycle
* capabilities
* version
* security constraints
* idempotency expectations
* observability requirements

Vendor-specific types SHALL NOT cross platform boundaries.

### Review Questions

* Is the boundary contract documented?
* Are errors normalized?
* Is contract versioning defined?
* Can the boundary be tested independently?

---

## AP-026: Standardized Error Model

External and component-specific errors SHALL be translated into platform-standard error categories.

Errors SHOULD preserve:

* platform error code
* category
* severity
* retryability
* source
* technical cause
* user-safe message
* evidence
* correlation identifier

Implementation-specific exceptions MUST NOT propagate uncontrolled across architectural boundaries.

### Review Questions

* Is the error meaningful outside the originating technology?
* Can retry behavior be determined?
* Is the original cause preserved?
* Does the error reveal sensitive information?

---

## AP-027: Explicit Lifecycle Management

Stateful architectural units SHALL expose explicit lifecycle states and transitions.

Examples include:

* plugins
* workspaces
* execution engines
* discovery sessions
* Knowledge Candidates
* Knowledge Objects
* runtime jobs

Lifecycle transitions SHALL be validatable and auditable.

### Review Questions

* What states can this unit enter?
* Which transitions are permitted?
* Who owns the transition?
* What happens after failure or interruption?

---

## AP-028: Configuration Over Hardcoding

Environment-specific, provider-specific, and policy-controlled behavior SHALL be configurable.

Configuration MAY include:

* capability selection
* execution options
* confidence thresholds
* retention periods
* feature flags
* plugin settings
* governance policies

Business rules SHALL remain governed rule objects rather than arbitrary configuration strings.

### Review Questions

* Is a changeable value hardcoded?
* Is the configuration scoped correctly?
* Is configuration schema-validated?
* Could configuration bypass an architectural rule?

---

## AP-029: AI Provider Independence

The Core Platform SHALL remain independent of a specific LLM or AI provider.

AI providers SHALL be accessed through governed interfaces.

Provider replacement SHOULD NOT require changes to:

* knowledge models
* rules
* product workflows
* business logic
* execution contracts

Provider-specific features MAY be used only behind capability-aware adapters.

### Review Questions

* Is provider-specific behavior present in Core?
* Can another provider implement the same contract?
* Are model limitations isolated?
* Is output independently validated?

---

# 6. Isolation and Scope Principles

## AP-030: Workspace Is the Project Execution Boundary

Every project SHALL operate inside a Workspace.

The Workspace SHALL contain or reference project-specific:

* configuration
* knowledge scope
* semantic UI
* UI Knowledge Graph
* requirements
* test assets
* plugin configuration
* execution artifacts
* temporary runtime state
* credentials
* logs

Project execution SHALL NOT occur without an active Workspace context.

### Review Questions

* Is the active Workspace explicit?
* Where will generated artifacts be stored?
* Which configuration and credentials apply?
* Can another Workspace access this state?

---

## AP-031: Scope Is Explicit

Every relevant Knowledge Object, rule, configuration value, artifact, and runtime operation SHALL have an explicit scope.

Supported conceptual scopes include:

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

An item SHALL NOT influence a broader scope than its approved scope.

### Review Questions

* What is the item's scope?
* Can it leak into another project or organization?
* Is scope inheritance defined?
* How are scope conflicts resolved?

---

## AP-032: No Implicit Cross-Workspace Sharing

Resources SHALL NOT be shared across Workspaces unless an explicit policy and contract authorize the sharing.

Shared resources MAY include:

* global ontology
* approved templates
* platform plugins
* organization-level knowledge
* organization-level secrets

Project-specific assets SHALL remain private by default.

### Review Questions

* Is sharing explicit?
* Is authorization checked?
* Is the shared scope appropriate?
* Is usage auditable?

---

## AP-033: Credentials Are Isolated

Credentials SHALL be isolated by their approved scope.

Credentials MUST NOT be:

* embedded in source code
* stored in prompts
* stored in specifications
* included in examples
* copied into Knowledge Objects
* exposed through logs
* implicitly shared across Workspaces

Credential access SHALL be auditable.

### Review Questions

* Where is the credential stored?
* Which Workspace or organization owns it?
* Who can access it?
* Could it appear in evidence or logs?

---

## AP-034: Failure Isolation

A failure in one Workspace, plugin instance, execution session, or external integration SHOULD NOT cascade into unrelated operations.

The architecture SHOULD support:

* bounded retries
* timeouts
* cancellation
* circuit breaking where applicable
* resource quotas
* isolated recovery
* dead-letter or review queues

### Review Questions

* What is the failure boundary?
* Can the failure affect another Workspace?
* Is retry behavior bounded?
* Can the operation be safely resumed?

---

# 7. Execution Principles

## AP-035: Execution Engine Abstraction

Execution SHALL occur through a platform-defined Execution Engine interface.

The Core Platform SHALL NOT invoke execution-framework SDKs directly.

Execution engines MAY support:

* web
* API
* mobile
* desktop
* CLI
* service-level validation

Playwright is the default web execution implementation, not a mandatory Core dependency.

### Review Questions

* Is execution invoked through the abstraction?
* Can another engine satisfy the same contract?
* Are results normalized?
* Are engine-specific details isolated?

---

## AP-036: Execution Is Deterministic

Execution engines SHALL perform the supplied execution intent without changing its business meaning.

They MAY adapt technical operations to their capabilities.

They MUST NOT independently introduce:

* new business assertions
* new acceptance criteria
* unapproved test scope
* destructive actions
* hidden retries that alter semantics

### Review Questions

* Does execution preserve the approved plan?
* Are engine adaptations visible?
* Are retries semantically safe?
* Is every action traceable to intent?

---

## AP-037: Evidence Is a Required Execution Output

Execution SHALL produce normalized evidence appropriate to the capability.

Evidence MAY include:

* screenshots
* traces
* videos
* network logs
* console logs
* API payloads
* DOM snapshots
* timestamps
* environment metadata

Evidence SHALL be associated with:

* Workspace
* execution
* test case
* automation asset
* originating engine
* applicable requirement or rule

### Review Questions

* What evidence is collected?
* Is evidence linked to the execution context?
* Can the result be independently reviewed?
* Are sensitive values redacted?

---

## AP-038: Execution Results Are Normalized

All execution engines SHALL return a common result structure.

The result SHOULD include:

* execution identifier
* status
* start and end times
* duration
* steps
* assertions
* errors
* evidence
* metrics
* environment
* engine metadata
* provenance

Product modules SHALL NOT parse vendor-specific result formats directly.

### Review Questions

* Is the result schema common across engines?
* Are vendor-specific fields isolated?
* Can reports consume results independently?
* Are partial and interrupted results represented?

---

## AP-039: Safe Execution by Default

Execution SHALL follow the least-destructive valid behavior.

Potentially destructive actions SHALL require:

* explicit intent
* applicable authorization
* policy validation
* clear scope
* audit logging
* recovery or rollback consideration where practical

AI inference alone SHALL NOT authorize destructive execution.

### Review Questions

* Can the action alter production data?
* Is authorization explicit?
* Is the environment correctly identified?
* Is rollback or cleanup defined?

---

# 8. Governance Principles

## AP-040: No Hidden Intelligence

Behavior that materially affects system outcomes SHALL be represented in governed artifacts.

Important behavior SHALL NOT exist only in:

* prompt wording
* undocumented model behavior
* private helper code
* hidden configuration
* unreviewed scripts
* conversational instructions

### Review Questions

* Where is this behavior defined?
* Can reviewers discover it?
* Is it versioned?
* Is it testable independently of the LLM?

---

## AP-041: Every Decision Has an Owner

Every significant decision, artifact, rule, and lifecycle transition SHALL have a responsible owner.

Ownership MAY be:

* a role
* a team
* a domain module
* an approved governance policy

Unowned authoritative behavior is prohibited.

### Review Questions

* Who maintains this?
* Who approves changes?
* Who resolves conflicts?
* Is ownership recorded in metadata?

---

## AP-042: Architecture Changes Are Controlled

Accepted Foundation Specifications and ADRs SHALL be treated as frozen architecture inputs.

They MAY change only through:

* documented motivation
* impact analysis
* review
* migration planning where applicable
* version updates
* traceability updates
* explicit approval

Implementation pressure alone is not sufficient justification for silently changing architecture.

### Review Questions

* Does the change contradict a frozen decision?
* Has impact analysis been completed?
* Are dependent artifacts identified?
* Is migration required?

---

## AP-043: Compatibility Must Be Explicit

Changes to schemas, interfaces, rules, and persisted knowledge SHALL classify compatibility impact.

Changes SHALL be identified as:

* backward-compatible
* conditionally compatible
* breaking
* migration-required

Compatibility assumptions SHALL NOT remain implicit.

### Review Questions

* Can existing consumers continue to work?
* Are persisted objects still valid?
* Is version negotiation required?
* Is a migration plan available?

---

## AP-044: Security Is an Architectural Concern

Security SHALL be considered at every layer.

Security SHALL NOT be deferred solely to runtime implementation.

Design reviews SHALL consider:

* authorization
* authentication
* credential handling
* data isolation
* sensitive evidence
* prompt injection
* malicious content
* plugin trust
* destructive execution
* auditability
* retention

### Review Questions

* What is the trust boundary?
* What data is sensitive?
* Which actions require authorization?
* Can external content influence privileged behavior?

---

## AP-045: Least Privilege

Components, plugins, agents, and users SHALL receive only the permissions required for the approved operation.

Permissions SHOULD be:

* scoped
* time-bounded where practical
* revocable
* auditable
* separated by Workspace
* capability-specific

### Review Questions

* Does the actor need every granted permission?
* Can access be reduced?
* Is access bound to the Workspace?
* Is the permission usage logged?

---

## AP-046: Auditability

Significant system actions SHALL be auditable.

Audit records SHOULD capture:

* actor
* action
* target
* timestamp
* Workspace
* decision source
* approval
* result
* failure
* correlation identifier

Audit records SHALL preserve enough context to reconstruct significant decisions and actions.

### Review Questions

* Can the action be reconstructed later?
* Is the responsible actor identifiable?
* Are approvals recorded?
* Can records be tampered with unnoticed?

---

## AP-047: Version Everything That Influences Behavior

Behavior-affecting artifacts SHALL be versioned.

This includes:

* specifications
* ADRs
* schemas
* ontology
* rules
* Knowledge Objects
* prompts used as implementation assets
* plugin contracts
* execution plans
* configuration policies

Versioning SHALL support traceability and reproducibility.

### Review Questions

* Which version produced this outcome?
* Can previous behavior be reconstructed?
* Are versions immutable?
* Is compatibility declared?

---

## AP-048: Reversibility and Revocation

Authoritative knowledge, rules, approvals, and configuration changes SHOULD support controlled reversal.

Revocation SHALL preserve history.

Deletion SHALL NOT be used as a substitute for lifecycle governance when traceability is required.

### Review Questions

* Can the decision be revoked?
* What happens to dependent behavior?
* Is historical use preserved?
* Is rollback safe?

---

# 9. AI Architecture Principles

## AP-049: AI Is a Reasoning Component, Not the System of Record

LLMs SHALL assist with:

* interpretation
* classification
* extraction
* generation
* recommendation
* summarization
* ambiguity resolution

LLMs SHALL NOT serve as the authoritative store for:

* knowledge
* business rules
* execution state
* governance
* credentials
* lifecycle status
* architecture decisions

### Review Questions

* Is the LLM being used as storage?
* Can the behavior work after model replacement?
* Is the output persisted only after validation?
* Is the result independently verifiable?

---

## AP-050: AI Outputs Are Untrusted Until Validated

AI-generated output SHALL be treated as a proposal, inference, or candidate until validated.

Validation MAY include:

* schema validation
* rule validation
* evidence comparison
* consistency checking
* confidence evaluation
* governance approval
* human review

AI output SHALL NOT directly trigger high-risk actions without required controls.

### Review Questions

* How is the output validated?
* Can malformed or unsupported content pass through?
* Is human approval required?
* Is evidence attached?

---

## AP-051: AI Independence

The architecture SHALL preserve the ability to:

* change models
* change providers
* use multiple models
* use non-LLM algorithms
* disable AI for deterministic workflows
* replay decisions from stored evidence

Core domain correctness SHALL NOT depend on proprietary model behavior.

### Review Questions

* Is model behavior embedded in the domain contract?
* Can the workflow run deterministically when possible?
* Can another model reproduce the interface?
* Is provider-specific state persisted?

---

## AP-052: AI Autonomy Is Governed

AI actions SHALL follow the approved autonomy model.

Conceptual levels are:

```text
Level 0 — Observation
Level 1 — Recommendation
Level 2 — Generation
Level 3 — Controlled Learning
Level 4 — Administrative Action
```

The system SHALL enforce the permissions, validation, and approval requirements associated with each level.

### Review Questions

* What autonomy level is required?
* Is the agent authorized for that level?
* Does the action require approval?
* Is the outcome reversible?

---

## AP-053: AI Must State Uncertainty

AI-generated decisions and recommendations SHALL expose material uncertainty.

The system SHOULD identify:

* confidence
* assumptions
* missing evidence
* conflicts
* alternative interpretations
* required validation

Unsupported certainty SHALL NOT be presented as authoritative truth.

### Review Questions

* Is confidence visible?
* Are assumptions disclosed?
* Are conflicts hidden?
* Is the response more certain than the evidence allows?

---

## AP-054: AI Must Use Bounded Context

AI agents SHALL receive only the context required for the current task.

Context construction SHOULD be:

* scoped
* relevant
* provenance-aware
* version-aware
* access-controlled
* size-conscious

Sending entire repositories, raw DOMs, or unrelated conversation histories SHALL be avoided.

### Review Questions

* Is all supplied context relevant?
* Does the context respect access scope?
* Are authoritative sources prioritized?
* Can context noise be reduced?

---

## AP-055: AI Agents Must Follow Repository Governance

AI agents contributing to the repository SHALL:

* read governance instructions
* identify authoritative sources
* search before creating
* preserve metadata
* follow templates
* respect dependency direction
* update indexes
* report conflicts
* avoid silent architectural changes

AI-generated artifacts SHALL be reviewed under the same standards as human-authored artifacts.

### Review Questions

* Did the agent read the governing sources?
* Did it create a duplicate artifact?
* Are indexes and references updated?
* Did it modify an accepted decision silently?

---

# 10. Quality Principles

## AP-056: Contracts Are Testable

Every important contract SHALL be testable.

Applicable tests MAY include:

* schema tests
* rule tests
* contract tests
* compatibility tests
* lifecycle tests
* security tests
* architecture conformance tests
* execution adapter tests

A contract that cannot be validated SHOULD be reconsidered.

### Review Questions

* How will this contract be tested?
* Are positive and negative cases defined?
* Can implementations be certified independently?
* Is conformance automated where practical?

---

## AP-057: Deterministic Behavior Is Reproducible

For identical governed inputs, deterministic components SHOULD produce identical outputs.

Reproducibility requires versioned:

* rules
* schemas
* knowledge
* configuration
* execution plans
* component contracts

Where probabilistic behavior is used, its evidence, configuration, and outcome SHALL be recorded.

### Review Questions

* Can the outcome be reproduced?
* Which versions influenced it?
* Was probabilistic reasoning involved?
* Is the generated result preserved?

---

## AP-058: Graceful Degradation

The system SHOULD continue safely when optional capabilities are unavailable.

Examples include:

* unavailable screenshot capture
* unavailable video recording
* degraded AI provider
* inaccessible external issue tracker
* unavailable historical evidence

Degradation SHALL be explicit.

The system MUST NOT falsely report full capability when operating in a reduced mode.

### Review Questions

* Which capabilities are required?
* Which are optional?
* What happens when one is unavailable?
* Is degraded output clearly marked?

---

## AP-059: Observability Is Built In

Important modules and workflows SHALL expose sufficient telemetry for diagnosis and governance.

Observability SHOULD include:

* structured logs
* metrics
* traces
* correlation identifiers
* lifecycle events
* decision events
* error events
* knowledge retrieval events
* rule evaluation events
* plugin invocation events

Observability SHALL avoid exposing sensitive data.

### Review Questions

* Can failures be diagnosed?
* Can a request be traced across modules?
* Are key decisions observable?
* Is sensitive information redacted?

---

## AP-060: Performance Optimizations Must Preserve Correctness

Caching, parallelism, batching, summarization, and reduced-context techniques SHALL NOT violate:

* scope
* provenance
* version correctness
* isolation
* deterministic precedence
* governance
* security

Correctness and trust take precedence over optimization.

### Review Questions

* Can cached data become stale?
* Is cache scope correct?
* Does parallel execution create race conditions?
* Does summarization remove required evidence?

---

## AP-061: Simplicity Before Abstraction

Abstraction SHALL be introduced to preserve a real architectural boundary, stable contract, or variability point.

The system SHOULD avoid speculative abstractions with no current architectural justification.

Approved abstractions include:

* plugin interfaces
* Execution Engine interfaces
* knowledge contracts
* rule contracts
* Workspace boundaries

### Review Questions

* What concrete problem does the abstraction solve?
* Are multiple implementations expected?
* Does it reduce or increase understanding?
* Is the abstraction owned and testable?

---

## AP-062: Evolution Is Incremental

The platform SHOULD evolve through small, reviewable, traceable changes.

Large changes SHALL be decomposed where practical.

Each increment SHOULD preserve:

* valid architecture
* migration safety
* testability
* documentation consistency
* rollback capability

### Review Questions

* Can this change be divided safely?
* Does each increment remain coherent?
* Is migration staged?
* Can the previous version remain operational?

---

# 11. Dependency Principles

## 11.1 Allowed Direction

The conceptual dependency direction is:

```text
Foundation
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
```

Lower layers MAY implement higher-layer requirements.

Lower layers MUST NOT redefine higher-layer intent.

---

## 11.2 Runtime Dependency Direction

At runtime, dependencies SHOULD follow:

```text
Runtime Entry Point
      ↓
Application Orchestration
      ↓
Domain Capabilities
      ↓
Knowledge and Rule Interfaces
      ↓
Platform Interfaces
      ↓
Plugin and Infrastructure Adapters
      ↓
External Systems
```

Domain capabilities SHALL NOT depend directly on runtime entry points or external SDKs.

---

## 11.3 Prohibited Dependencies

The following dependencies are prohibited unless explicitly approved:

* Core Platform → vendor SDK
* Knowledge domain → UI framework
* Rule Engine → LLM provider
* Plugin → business decision ownership
* Plugin → another plugin
* Workspace A → Workspace B private state
* Product capability → raw database implementation
* Execution engine → business rule ownership
* lower-level specification → redefinition of Foundation law
* prompt → authoritative business rule

---

# 12. Architecture Review Procedure

Every significant design SHALL be reviewed in the following order:

```text
1. Purpose
2. Authoritative Owner
3. Architectural Layer
4. Applicable Principles
5. Related ADRs
6. Dependency Direction
7. Knowledge and Rule Impact
8. Workspace and Scope Impact
9. Security Impact
10. Traceability
11. Compatibility
12. Testability
13. Operational Impact
```

A design SHALL NOT proceed when it has an unresolved violation of an accepted principle.

Exceptions require:

* explicit justification
* identified risk
* mitigation
* owner
* expiration or review date
* architecture approval

---

# 13. Principle Conflict Resolution

Architecture principles are intended to reinforce one another.

When two principles appear to conflict, the review SHALL consider:

1. security
2. governance
3. correctness
4. data and Workspace isolation
5. deterministic rules
6. knowledge authority
7. traceability
8. maintainability
9. performance
10. convenience

Accepted Foundation Specifications and ADRs remain authoritative.

A principle conflict SHALL NOT be resolved only through implementation preference.

---

# 14. Architecture Conformance Checklist

A design is conformant when all applicable statements are true.

## Knowledge

```text
□ Existing knowledge is queried before new inference.
□ Observations are not persisted directly as knowledge.
□ Knowledge has scope, provenance, status, and version.
□ Conflicts are detected rather than overwritten.
□ Only approved knowledge affects deterministic reasoning.
```

## Rules and AI

```text
□ Deterministic rules execute before LLM reasoning.
□ Business logic is not hidden inside prompts.
□ AI outputs are validated.
□ Confidence is not treated as authority.
□ AI provider dependencies are isolated.
```

## Discovery and UI

```text
□ Discovery occurs before unnecessary user questions.
□ Raw DOM is not the primary LLM input.
□ Semantic UI represents business meaning.
□ UI relationships are modeled explicitly.
□ Original evidence remains available.
```

## Architecture

```text
□ Every module has one primary responsibility.
□ Domain logic is independent of external SDKs.
□ External integrations use plugins.
□ Boundaries use standard contracts.
□ Errors are normalized.
```

## Workspace and Security

```text
□ The active Workspace is explicit.
□ Project resources are isolated.
□ Credentials are not embedded or implicitly shared.
□ Permissions follow least privilege.
□ High-risk actions require authorization.
```

## Execution

```text
□ Execution uses the Execution Engine abstraction.
□ Execution does not redefine business intent.
□ Results are normalized.
□ Evidence is linked to execution context.
□ Destructive behavior is explicitly governed.
```

## Governance

```text
□ The authoritative owner is identified.
□ Dependencies follow the approved direction.
□ Traceability is preserved.
□ Behavior-affecting artifacts are versioned.
□ Breaking changes include impact analysis.
```

## Quality

```text
□ Contracts are testable.
□ Significant actions are observable.
□ Failure boundaries are defined.
□ Degraded capability is reported honestly.
□ Optimizations preserve correctness and scope.
```

---

# 15. Non-Conformance Handling

When a design or implementation violates an architecture principle:

1. Record the violation.
2. Identify the governing principle and authoritative source.
3. Stop dependent implementation when the violation affects correctness, security, or architectural integrity.
4. Determine whether the design or the governing artifact should change.
5. Perform impact analysis.
6. Apply the approved correction.
7. Update traceability and tests.
8. Record any temporary exception.

Temporary exceptions SHALL include:

```yaml
principle:
reason:
scope:
owner:
risk:
mitigation:
approved_by:
created_at:
expires_at:
resolution_plan:
```

Expired exceptions SHALL be treated as unresolved violations.

---

# 16. AI Review Instructions

Before generating or modifying architecture, an AI agent SHALL:

1. Read `MANIFEST.yaml`.
2. Read `governance/READING_ORDER.md`.
3. Read applicable Foundation Specifications.
4. Read related ADRs.
5. Read this document.
6. Identify the artifact owner.
7. Identify the architectural layer.
8. Search for an existing authoritative artifact.
9. Check dependency direction.
10. Evaluate all applicable principles.
11. Report conflicts before proceeding.
12. Preserve traceability in the resulting artifact.

An AI agent MUST NOT claim architecture conformance without evaluating the applicable principles.

---

# 17. Relationship to Other Governance Documents

This document defines architecture principles.

Supporting governance documents SHALL provide operational detail:

```text
governance/READING_ORDER.md
```

Defines the order in which humans and AI agents read repository artifacts.

```text
governance/DECISION_TREE.md
```

Defines how contributors determine where a decision or artifact belongs.

```text
governance/DEPENDENCY_MATRIX.md
```

Defines allowed and prohibited dependencies.

```text
governance/OWNERSHIP_MATRIX.md
```

Defines responsibility and approval ownership.

```text
governance/TRACEABILITY_MATRIX.md
```

Defines required relationships between engineering artifacts.

```text
governance/CHANGE_IMPACT_MATRIX.md
```

Defines how changes propagate across repository layers.

```text
governance/REVIEW_CHECKLIST.md
```

Defines detailed review questions.

```text
governance/QUALITY_GATES.md
```

Defines mandatory gates before acceptance and implementation.

---

# 18. Definition of Done

This document is complete when:

* the core architecture principles are consolidated
* each principle has an identifier
* each principle defines a review intent
* accepted ADR decisions are represented
* dependency direction is documented
* prohibited dependencies are documented
* conformance review is defined
* exception handling is defined
* AI review instructions are defined
* supporting governance documents are identified

Architecture governance implementation is complete when:

* architecture reviews reference principle identifiers
* exceptions are recorded and tracked
* conformance checks are incorporated into review workflows
* prohibited dependencies are tested where practical
* AI coding instructions reference this document
* quality gates validate architecture conformance

---

# 19. Principle Summary

The architecture of QA Intelligence SHALL preserve the following invariant chain:

```text
Understand
      ↓
Discover
      ↓
Retrieve Knowledge
      ↓
Evaluate Rules
      ↓
Reason When Required
      ↓
Validate
      ↓
Execute Through Abstractions
      ↓
Collect Evidence
      ↓
Create Knowledge Candidates
      ↓
Govern Learning
      ↓
Improve Future Reasoning
```

The platform SHALL remain:

* knowledge-driven
* deterministic where possible
* AI-assisted rather than AI-dependent
* technology-independent
* workspace-isolated
* explainable
* traceable
* governed
* testable
* continuously improvable

These principles are the architecture review baseline for all future specifications, components, and implementations in QA Intelligence.
