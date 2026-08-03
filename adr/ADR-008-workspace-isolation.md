---
id: ADR-008
title: Workspace Isolation
status: accepted
version: 1.0.0
date: 2026-07-31
decision_owners:
  - Architecture
  - Workspace
related_specs:
  - SPEC-006
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-003
  - ADR-004
  - ADR-005
  - ADR-006
  - ADR-007
supersedes: []
superseded_by: null
---

# ADR-008: Workspace Isolation

## 1. Context

QA Intelligence supports multiple organizations, projects, repositories, environments, and execution sessions.

Each project may have its own:

- application
- source code
- requirements
- business rules
- automation assets
- plugins
- execution history
- configuration
- credentials

These assets must remain isolated while still allowing controlled reuse of shared platform knowledge.

The platform therefore requires a clear execution boundary.

---

## 2. Problem

Without isolation:

- projects may accidentally access each other's data
- business rules may leak across projects
- automation assets become mixed
- plugin configurations conflict
- execution artifacts overwrite each other
- credentials become difficult to secure
- AI reasoning may use incorrect project context

A shared runtime without isolation reduces reliability, security, and maintainability.

---

## 3. Decision

Every project SHALL execute inside its own **Workspace**.

A Workspace is the execution boundary for all project-specific resources.

The Core Platform SHALL manage multiple independent Workspaces concurrently.

Shared platform services SHALL remain outside individual Workspaces.

The logical architecture is:

```text
Core Platform
        │
        ├── Workspace A
        ├── Workspace B
        ├── Workspace C
        └── ...
```

Each Workspace SHALL operate independently.

---

## 4. Decision Rules

### 4.1 Workspace Boundary

A Workspace SHALL isolate project-specific assets, including:

- project configuration
- requirements
- Semantic UI
- UI Knowledge Graph
- automation assets
- execution artifacts
- temporary files
- plugin configuration
- credentials
- logs

Resources inside one Workspace MUST NOT be directly visible to another Workspace unless explicitly shared.

---

### 4.2 Shared vs Local Knowledge

Knowledge SHALL be separated by scope.

Typical scopes include:

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

Workspace isolation SHALL respect the defined knowledge scope.

---

### 4.3 Independent Execution

Each Workspace SHALL execute independently.

Examples:

- discovery
- automation generation
- execution
- reporting
- learning

Failures in one Workspace MUST NOT interrupt execution in another.

---

### 4.4 Configuration Isolation

Each Workspace SHALL maintain its own:

- environment variables
- plugin settings
- execution configuration
- AI configuration
- runtime options

Configuration changes SHALL NOT affect other Workspaces.

---

### 4.5 Credential Isolation

Credentials SHALL belong to a Workspace unless explicitly managed as organization-level secrets.

Credentials MUST NOT be shared implicitly.

---

### 4.6 Plugin Isolation

Plugins are platform capabilities.

Plugin instances MAY be configured differently for each Workspace.

Example:

```text
Workspace A
    ↓
Playwright Plugin
    └── Chromium

Workspace B
    ↓
Playwright Plugin
    └── Firefox
```

The Core Platform SHALL manage plugin lifecycles independently for each Workspace.

---

### 4.7 Artifact Isolation

Generated artifacts SHALL remain inside their originating Workspace.

Examples include:

- screenshots
- videos
- traces
- reports
- generated tests
- logs

Artifacts SHALL include metadata identifying the originating Workspace.

---

### 4.8 Session Isolation

Discovery, execution, and learning sessions SHALL operate within a Workspace context.

Temporary session data MUST NOT leak across Workspaces.

---

### 4.9 Controlled Sharing

Shared resources SHALL be explicitly defined.

Examples include:

- global ontology
- engineering specifications
- reusable templates
- platform plugins

Project-specific resources SHALL NOT become shared automatically.

---

### 4.10 Workspace Lifecycle

A Workspace SHALL support a managed lifecycle.

Minimum lifecycle:

```text
Create
    ↓
Initialize
    ↓
Ready
    ↓
Active
    ↓
Suspended
    ↓
Archived
    ↓
Deleted
```

Workspace deletion SHALL follow governance policies and retention requirements.

---

## 5. Rationale

### 5.1 Security

Isolation reduces the risk of accidental data leakage across projects or organizations.

---

### 5.2 Reliability

Independent Workspaces prevent failures from propagating across projects.

---

### 5.3 Scalability

Multiple projects can execute concurrently without interfering with one another.

---

### 5.4 Maintainability

Each Workspace can evolve independently while sharing the same Core Platform.

---

### 5.5 Governance

Isolation enables organization-specific policies, credentials, and compliance requirements.

---

## 6. Alternatives Considered

### 6.1 Shared Runtime

All projects execute within a single shared context.

Rejected because it increases coupling and risk of data leakage.

---

### 6.2 Separate Platform per Project

Each project runs its own complete platform instance.

Rejected because it duplicates infrastructure and reduces knowledge reuse.

---

### 6.3 Workspace Isolation

Accepted.

Provides strong separation while allowing controlled sharing of platform capabilities.

---

## 7. Consequences

### Positive

- stronger security
- project independence
- safer concurrent execution
- easier governance
- simpler configuration management
- reusable platform services

### Negative

- additional workspace management
- lifecycle orchestration
- storage overhead
- explicit sharing mechanisms required

---

## 8. Risks and Mitigations

### Risk

Workspace resource growth.

Mitigations:

- quotas
- lifecycle management
- archival policies
- cleanup strategies

---

### Risk

Incorrect resource sharing.

Mitigations:

- scoped permissions
- access control
- audit logging
- governance validation

---

### Risk

Workspace corruption.

Mitigations:

- backups
- versioning
- integrity validation
- recovery procedures

---

## 9. AI Guidance

### AI Coding Agents MUST

- execute project logic within a Workspace
- respect knowledge scopes
- isolate configuration and credentials
- preserve Workspace metadata on generated artifacts

### AI Coding Agents MUST NOT

- access another Workspace directly
- share project resources implicitly
- persist project artifacts outside the Workspace boundary

### AI Runtime Agents MUST

- resolve the active Workspace before execution
- retrieve Workspace-specific configuration
- store generated artifacts in the correct Workspace
- enforce Workspace isolation throughout the execution lifecycle

---

## 10. Compliance

An implementation complies with this ADR when:

- every project executes within a Workspace
- project resources remain isolated
- shared resources require explicit governance
- Workspace lifecycles are managed
- concurrent Workspaces operate independently

Non-compliant architecture:

```text
Project A
      ↓
Shared Runtime
      ↑
Project B
```

Compliant architecture:

```text
Core Platform
      │
      ├── Workspace A
      ├── Workspace B
      └── Workspace C
```

---

## 11. Related Decisions

- ADR-001 defines the Knowledge Store.
- ADR-002 defines Rule Engine precedence.
- ADR-003 defines Semantic UI.
- ADR-004 defines the UI Knowledge Graph.
- ADR-005 defines the Knowledge Candidate lifecycle.
- ADR-006 defines Discovery Before Asking.
- ADR-007 defines Plugin as Adapter.
- ADR-009 will define Playwright as the default execution engine.

---

## 12. Implementation Notes

Future specifications should define:

- Workspace schema
- Workspace manifest
- directory structure
- lifecycle management
- access control
- storage model
- session management
- resource quotas
- backup and recovery
- artifact retention

This ADR establishes the Workspace as the execution boundary for project-specific resources while enabling safe multi-project operation on a shared Core Platform.
