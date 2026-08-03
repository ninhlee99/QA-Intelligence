---
id: ADR-007
title: Plugin as Adapter
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Architecture
  - Plugin
related_specs:
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-006
supersedes: []
superseded_by: null
---

# ADR-007: Plugin as Adapter

## 1. Context

QA Intelligence integrates with many external systems throughout its lifecycle.

Examples include:

- browsers
- Playwright
- Selenium
- Jira
- Azure DevOps
- GitHub
- GitLab
- REST APIs
- GraphQL APIs
- databases
- file systems
- cloud storage
- CI/CD platforms
- communication tools

These technologies evolve independently of QA Intelligence.

The platform must remain stable even when external technologies change.

---

## 2. Problem

If the Core Engine communicates directly with external systems:

- dependencies become tightly coupled
- implementation details leak into business logic
- replacing one technology requires core changes
- testing becomes difficult
- modules become difficult to maintain
- different integrations behave inconsistently

QA Intelligence requires a stable abstraction between the Core Platform and external technologies.

---

## 3. Decision

All communication between QA Intelligence and external systems SHALL occur through Plugins.

Plugins SHALL implement adapter interfaces defined by the Core Platform.

The Core Platform SHALL depend only on interfaces.

Plugins SHALL depend on external technologies.

The dependency direction SHALL always be:

```text
Core Platform
      ↓
Plugin Interface
      ↓
Plugin Implementation
      ↓
External System
```

The Core Platform MUST NOT directly depend on external libraries or services.

---

## 4. Decision Rules

### 4.1 Adapter Pattern

Every plugin SHALL implement a well-defined interface.

Examples:

- BrowserPlugin
- ExecutionPlugin
- IssueTrackerPlugin
- RepositoryPlugin
- StoragePlugin
- NotificationPlugin
- AIProviderPlugin

The Core Platform communicates only through these interfaces.

---

### 4.2 Technology Isolation

Technology-specific code SHALL remain inside plugins.

Examples:

Playwright logic SHALL remain inside the Playwright Plugin.

Jira REST APIs SHALL remain inside the Jira Plugin.

GitHub SDK usage SHALL remain inside the GitHub Plugin.

---

### 4.3 Stable Interfaces

Plugin interfaces SHALL remain stable across implementation changes.

Changing an implementation SHALL NOT require changes to the Core Platform.

---

### 4.4 Replaceability

Any plugin SHALL be replaceable by another implementation that satisfies the same interface.

Examples:

```text
Playwright Plugin
        ↓

Selenium Plugin
```

or

```text
OpenAI Plugin
        ↓

Anthropic Plugin
```

The Core Platform SHALL continue to operate without modification.

---

### 4.5 Plugin Independence

Plugins SHALL NOT communicate directly with one another.

Cross-plugin coordination SHALL occur through the Core Platform.

---

### 4.6 Business Logic Ownership

Plugins SHALL NOT contain business logic.

Plugins SHALL only:

- translate requests
- translate responses
- manage technology-specific communication
- handle protocol differences
- expose capabilities

Business decisions belong to the Core Platform.

---

### 4.7 Stateless Design

Plugins SHOULD be stateless whenever practical.

Persistent state SHALL belong to platform-managed services rather than plugin implementations.

---

### 4.8 Error Translation

Plugins SHALL translate technology-specific failures into platform-standard errors.

Example:

```text
Playwright Timeout

↓

ExecutionTimeout
```

instead of exposing Playwright-specific exceptions.

---

### 4.9 Capability Discovery

Plugins SHOULD expose supported capabilities.

Example:

```text
Supports Screenshots

Supports Video Recording

Supports Network Capture

Supports Tracing
```

The Core Platform should adapt based on available capabilities rather than implementation details.

---

### 4.10 Lifecycle Management

Plugins SHALL support a defined lifecycle.

Minimum lifecycle:

```text
Load

↓

Initialize

↓

Ready

↓

Execute

↓

Shutdown
```

The Core Platform owns plugin lifecycle management.

---

## 5. Rationale

### 5.1 Loose Coupling

The Core Platform remains independent of technology choices.

---

### 5.2 Extensibility

New technologies can be integrated without modifying the Core Platform.

---

### 5.3 Testability

Plugin interfaces can be mocked during testing.

---

### 5.4 Maintainability

Technology upgrades are isolated within plugin implementations.

---

### 5.5 Vendor Independence

The platform avoids lock-in to any specific provider.

---

## 6. Alternatives Considered

### 6.1 Direct Integration

Rejected.

Business logic becomes tightly coupled to external technologies.

---

### 6.2 Shared Utility Libraries

Rejected.

Utility libraries still expose technology-specific APIs to business modules.

---

### 6.3 Plugin as Adapter

Accepted.

Provides clear separation between platform logic and external technologies.

---

## 7. Consequences

### Positive

- loose coupling
- technology independence
- replaceable implementations
- easier testing
- easier maintenance
- vendor neutrality
- consistent integration model

### Negative

- additional abstraction layer
- interface version management
- plugin lifecycle management
- capability negotiation

---

## 8. Risks and Mitigations

### Risk

Plugin interfaces become too generic.

Mitigations:

- capability-based interfaces
- domain-focused contracts
- interface versioning
- regular architectural review

---

### Risk

Plugin implementations diverge.

Mitigations:

- contract testing
- compatibility validation
- standardized error model
- certification process

---

### Risk

Performance overhead.

Mitigations:

- lightweight adapters
- efficient serialization
- connection reuse
- performance monitoring

---

## 9. AI Guidance

### AI Coding Agents MUST

- implement integrations through plugin interfaces
- isolate technology-specific code
- translate external errors into platform errors
- keep plugins focused on adaptation

### AI Coding Agents MUST NOT

- place business logic inside plugins
- call external SDKs directly from the Core Platform
- create dependencies between plugins
- expose vendor-specific APIs to business modules

### AI Runtime Agents MUST

- discover plugin capabilities
- invoke plugins through interfaces
- handle standardized platform errors
- remain implementation-independent

---

## 10. Compliance

An implementation complies with this ADR when:

- all external integrations are implemented as plugins
- the Core Platform depends only on interfaces
- plugins contain no business logic
- implementations are replaceable
- plugin failures are translated into platform-standard errors

Non-compliant architecture:

```text
Core Engine
      ↓
Playwright SDK
```

Compliant architecture:

```text
Core Engine
      ↓
Browser Plugin Interface
      ↓
Playwright Plugin
      ↓
Playwright SDK
```

---

## 11. Related Decisions

- ADR-001 defines the Knowledge Store.
- ADR-002 defines Rule Engine precedence.
- ADR-003 defines Semantic UI.
- ADR-004 defines the UI Knowledge Graph.
- ADR-005 defines the Knowledge Candidate lifecycle.
- ADR-006 defines Discovery Before Asking.
- ADR-008 will define Workspace Isolation.

---

## 12. Implementation Notes

Future specifications should define:

- plugin interface contracts
- plugin registry
- plugin discovery
- capability negotiation
- lifecycle management
- dependency injection
- version compatibility
- contract testing
- security model
- sandboxing

This ADR establishes Plugins as the only architectural boundary between the Core Platform and external technologies.
