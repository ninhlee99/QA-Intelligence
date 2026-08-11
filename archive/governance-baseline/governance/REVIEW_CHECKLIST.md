---
id: GOV-008
title: Review Checklist
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
  - GOV-007
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

# Review Checklist

## 1. Purpose

This document defines the canonical review process and review checklist for the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- make reviews consistent
- ensure authoritative sources are changed before implementations
- validate ownership and approval authority
- enforce dependency direction
- preserve traceability
- identify breaking changes
- protect Workspace isolation
- govern AI-assisted contributions
- validate knowledge and rule lifecycle
- ensure adequate testing and evidence
- prevent incomplete or misleading acceptance
- support human and automated quality gates

This document applies to reviews of:

- specifications
- ADRs
- governance documents
- ontology
- schemas
- rules
- Knowledge Objects
- Knowledge Candidates
- Product requirements
- architecture
- components
- interfaces
- plugins
- runtime behavior
- tests
- automation
- migrations
- releases
- AI-generated artifacts

A review is not a formatting exercise.

A review determines whether a change is:

- correctly classified
- owned
- authorized
- architecturally valid
- semantically correct
- traceable
- testable
- secure
- compatible
- operationally ready

---

# 2. Review Philosophy

The canonical review sequence is:

```text
Understand Intent

↓

Identify Authority

↓

Identify Owner

↓

Classify Change

↓

Inspect Dependencies

↓

Inspect Traceability

↓

Assess Impact

↓

Assess Risk

↓

Assess Compatibility

↓

Validate Implementation

↓

Validate Evidence

↓

Approve or Reject
```

Reviewers SHALL review from authority to implementation.

The preferred order is:

```text
Foundation

↓

ADR

↓

Specification

↓

Ontology

↓

Schema

↓

Rule

↓

Knowledge

↓

Interface

↓

Component

↓

Implementation

↓

Tests

↓

Runtime Evidence
```

Reviewing code before understanding the governing artifact risks approving incorrect behavior implemented correctly.

---

# 3. Review Principles

## 3.1 Review Against Authority

A reviewer SHALL identify the authoritative source before evaluating correctness.

The question is not only:

> Does this implementation work?

The reviewer SHALL also ask:

> Does this implementation conform to approved intent?

---

## 3.2 Review Meaning Before Structure

Semantic correctness SHALL be reviewed before:

- schema shape
- code structure
- serialization
- UI representation
- persistence details

A structurally valid artifact may still express incorrect meaning.

---

## 3.3 Review Rules Before Prompts

Deterministic behavior SHALL be reviewed in:

- specifications
- rules
- schemas
- knowledge

It SHALL NOT be accepted merely because prompt wording appears to produce the desired result.

---

## 3.4 Review Evidence, Not Confidence Alone

A confidence score SHALL NOT replace:

- source evidence
- provenance
- test results
- reviewer authority
- validation records

High confidence without adequate evidence remains insufficient.

---

## 3.5 Review Both Direct and Transitive Effects

A reviewer SHALL inspect:

- changed artifact
- direct consumers
- transitive consumers
- derived artifacts
- historical compatibility
- operational impact

---

## 3.6 Reject Hidden Scope Expansion

A project-scoped change SHALL NOT silently become:

- organization-scoped
- global
- cross-Workspace
- platform-wide

Scope expansion requires explicit review.

---

## 3.7 Distinguish Draft from Authority

AI output, discovery observations, and user answers SHALL remain:

- draft
- evidence
- proposal
- candidate

until the applicable governance process approves them.

---

## 3.8 Reject Unsupported Claims

Statements such as the following require evidence:

- no breaking change
- no security impact
- no data migration
- no affected consumers
- fully covered
- backward compatible
- safe to release
- knowledge conflict resolved

---

## 3.9 Reviewers Must Declare Uncertainty

A reviewer who cannot verify a material claim SHALL record:

- unknown
- assumption
- missing evidence
- required specialist review
- blocking question

Uncertainty SHALL NOT be hidden behind approval.

---

## 3.10 Approval Means Accountability

Approval confirms that the reviewer:

- reviewed the required scope
- had appropriate authority
- considered known risks
- accepted remaining risk within authority
- relied on identified evidence

Approval SHALL be recorded.

---

# 4. Review Outcomes

A review SHALL result in one of the following outcomes.

## 4.1 Approved

The change satisfies all applicable blocking requirements.

Non-blocking follow-up items MAY remain if explicitly recorded.

---

## 4.2 Approved with Conditions

The change may proceed only when named conditions are satisfied.

Conditions SHALL be:

- specific
- owned
- verifiable
- time-bounded where applicable

---

## 4.3 Changes Required

The change is directionally valid but incomplete or non-conformant.

The reviewer SHALL identify blocking corrections.

---

## 4.4 Rejected

The change conflicts with:

- Foundation
- accepted ADRs
- governance
- ownership
- security
- architecture
- authoritative Product intent
- knowledge policy

A rejection SHALL explain the governing reason.

---

## 4.5 Escalated

The reviewer lacks authority or a conflict exists between authoritative artifacts.

The review SHALL be routed according to the escalation rules.

---

# 5. Review Roles

## 5.1 Author

The author is responsible for:

- accurate classification
- complete change description
- impact analysis
- required metadata
- tests
- evidence
- known risks
- unresolved questions

The author SHALL NOT be the sole approver where segregation of duties is required.

---

## 5.2 Accountable Owner

The accountable owner validates:

- intent
- scope
- lifecycle
- semantic correctness
- compatibility obligations
- final acceptance within authority

---

## 5.3 Technical Reviewer

The technical reviewer validates:

- architecture conformance
- implementation quality
- dependency direction
- interfaces
- reliability
- performance
- maintainability

---

## 5.4 Domain Reviewer

The Domain Reviewer validates:

- business meaning
- business rules
- terminology
- regulatory interpretation
- expected outcomes

---

## 5.5 Security Reviewer

The Security Reviewer validates:

- trust boundaries
- authorization
- credentials
- sensitive data
- destructive actions
- auditability
- external-content risk

---

## 5.6 AI Governance Reviewer

The AI Governance Reviewer validates:

- autonomy
- confidence routing
- model behavior
- prompt governance
- validation
- controlled learning
- AI auditability

---

## 5.7 Quality Reviewer

Quality Engineering validates:

- testability
- coverage
- risk-based validation
- evidence quality
- regression scope
- release readiness

---

## 5.8 Operations Reviewer

Platform Operations validates:

- deployment
- monitoring
- recovery
- rollback
- capacity
- runtime support
- operational access

---

# 6. Review Entry Criteria

A change SHOULD NOT enter formal review until:

```text
□ The change has a stable identifier.

□ The change type is classified.

□ The accountable owner is identified.

□ The changed artifacts are listed.

□ The reason and expected outcome are stated.

□ Impact analysis is complete to the required level.

□ Known risks and unknowns are recorded.

□ Required tests have been executed or explicitly scheduled.

□ Required metadata is present.

□ Draft status is clear.

□ Generated artifacts are identified.

□ Breaking status is declared.

□ Migration needs are declared.

□ Security and AI impact are assessed.
```

Incomplete changes MAY receive early feedback.

They SHALL NOT be represented as approval-ready.

---

# 7. Universal Review Checklist

## 7.1 Identity

```text
□ The artifact has a stable identifier.

□ The identifier follows repository naming conventions.

□ The title accurately reflects responsibility.

□ The version is present where required.

□ The lifecycle status is valid.

□ The file path matches repository governance.

□ Identity is not based only on a mutable label or path.
```

---

## 7.2 Classification

```text
□ The artifact type is correct.

□ The change type is correctly classified.

□ Architectural decisions are represented by ADRs.

□ Stable behavior is represented by specifications.

□ Semantic meaning is represented by ontology.

□ Machine structure is represented by schemas.

□ Deterministic logic is represented by rules.

□ Reusable truth is represented by knowledge.

□ Implementation details remain in implementation artifacts.
```

---

## 7.3 Authority

```text
□ The authoritative upstream artifact is identified.

□ The change does not contradict Foundation.

□ Applicable ADRs are identified.

□ Applicable governance documents are identified.

□ The implementation does not redefine higher-level intent.

□ User instructions are not treated as persistent authority without governance.

□ Conversation history is not used as authoritative knowledge.
```

---

## 7.4 Ownership

```text
□ Exactly one accountable owner is identified.

□ The owner is authorized for the artifact type.

□ The owner is authorized for the scope.

□ Required approvers are identified.

□ Required consulted roles are included.

□ Runtime operation ownership is identified where applicable.

□ Validation authority is identified.

□ AI is not assigned as implicit accountable owner.
```

---

## 7.5 Scope

```text
□ Scope is explicitly declared.

□ Parent scope is identifiable.

□ Inheritance is defined.

□ Override behavior is defined.

□ Scope expansion is intentional.

□ Cross-Workspace relationships are authorized.

□ Session context is not persisted as broader knowledge.
```

---

## 7.6 Dependencies

```text
□ Dependencies are explicit.

□ Dependency direction follows governance.

□ No prohibited direct dependency exists.

□ No prohibited transitive dependency exists.

□ Cross-owner dependencies use contracts.

□ Vendor SDKs remain inside adapters.

□ Core does not depend on plugin implementations.

□ Circular dependencies are absent or explicitly governed.
```

---

## 7.7 Traceability

```text
□ Upstream authority is traceable.

□ Downstream consumers are identifiable.

□ Required relationship types are present.

□ Relationships use stable IDs.

□ Versions are traceable.

□ Historical relationships remain interpretable.

□ No governed artifact becomes orphaned.

□ Reverse traceability is available or derivable.
```

---

## 7.8 Change Impact

```text
□ Direct impacts are identified.

□ Indirect impacts are identified.

□ Affected owners are identified.

□ Affected consumers are identified.

□ Data and migration impact are assessed.

□ Security impact is assessed.

□ AI impact is assessed.

□ Test and release impact are assessed.

□ Unknown impact is recorded as risk.
```

---

## 7.9 Compatibility

```text
□ Backward compatibility is assessed.

□ Forward compatibility is assessed.

□ Data compatibility is assessed.

□ Behavioral compatibility is assessed.

□ Operational compatibility is assessed.

□ Historical records remain interpretable.

□ Breaking changes are explicitly declared.

□ Compatibility assumptions are tested.
```

---

## 7.10 Lifecycle

```text
□ Allowed states are defined.

□ State transitions are valid.

□ Approval requirements are defined.

□ Deprecation has a replacement or rationale.

□ Archival preserves identity and history.

□ Deletion preserves required tombstones.

□ Expiration and effective dates are handled.
```

---

## 7.11 Security

```text
□ Authentication impact is assessed.

□ Authorization follows least privilege.

□ Credential values are not exposed.

□ Sensitive data is classified.

□ Logs and evidence avoid unnecessary sensitive data.

□ External content is treated as untrusted.

□ Destructive actions require authorization.

□ Audit evidence is sufficient.

□ Workspace isolation is preserved.
```

---

## 7.12 AI Governance

```text
□ AI use is necessary and justified.

□ Deterministic behavior is handled before LLM reasoning.

□ AI access uses a governed provider interface.

□ Provider-specific types do not leak.

□ Prompt templates do not own business rules.

□ AI output is validated.

□ Confidence routing follows policy.

□ Autonomy level is authorized.

□ High-risk actions require human or policy approval.

□ Controlled learning preserves candidate lifecycle.

□ Private chain-of-thought storage is not required.
```

---

## 7.13 Knowledge

```text
□ Observation is distinguished from knowledge.

□ Knowledge provenance exists.

□ Scope is valid.

□ Ontology type is valid.

□ Schema validation passes.

□ Conflicts are detected.

□ Deduplication is applied.

□ Approval authority is valid.

□ Previous versions remain traceable.

□ Knowledge Candidates are not consumed as authoritative truth.
```

---

## 7.14 Rules

```text
□ Rule source is authoritative.

□ Semantic owner is identified.

□ Inputs are schema-valid.

□ Outputs are deterministic.

□ Precedence is explicit.

□ Scope resolution is defined.

□ Effective dates are defined where required.

□ Boundary cases are tested.

□ The Rule Engine does not invoke an LLM to invent decisions.

□ Explanation output identifies applied rules.
```

---

## 7.15 Testing

```text
□ Validation targets are identified.

□ Test Cases trace to requirements, rules, risks, defects, or contracts.

□ Test scope is proportional to risk.

□ Positive, negative, boundary, and failure cases are considered.

□ Regression scope is identified.

□ Contract tests exist for shared interfaces.

□ Architecture tests cover dependency boundaries.

□ Security tests are included where applicable.

□ Test evidence is retained.

□ Passing status is supported by execution evidence.
```

---

## 7.16 Operations

```text
□ Deployment impact is assessed.

□ Runtime configuration is validated.

□ Monitoring is adequate.

□ Alerts are updated.

□ Recovery behavior is defined.

□ Rollback is feasible or irreversibility is approved.

□ Resource impact is assessed.

□ Operational ownership is assigned.

□ Runbooks are updated.
```

---

## 7.17 Documentation

```text
□ Normative documentation is updated.

□ Informative documentation follows authoritative sources.

□ Examples remain valid.

□ Templates remain compatible.

□ Playbooks reflect actual process.

□ Generated documents are regenerated.

□ Stale links and references are corrected.

□ Changelog impact is addressed.
```

---

# 8. Foundation Specification Review

Reviewers of Foundation Specifications SHALL verify:

```text
□ The document defines platform-wide direction rather than implementation detail.

□ The scope is broad enough to justify Foundation status.

□ The content does not depend on downstream implementation.

□ Principles are internally consistent.

□ Conflicts with existing Foundation artifacts are resolved.

□ Downstream governance and ADR impact is identified.

□ Enforcement expectations are defined.

□ AI agents can interpret the rule deterministically.

□ Exceptions are either prohibited or explicitly governed.
```

Foundation changes normally require:

- Engineering Governance approval
- Architecture approval
- Product Governance consultation
- AI Governance consultation where applicable

---

# 9. ADR Review

Every ADR review SHALL verify:

## Context

```text
□ The problem is clearly stated.

□ Relevant forces and constraints are identified.

□ Existing decisions are referenced.

□ The decision is architectural rather than merely local implementation.
```

## Decision

```text
□ The decision is explicit.

□ The scope is defined.

□ Ownership boundaries are clear.

□ Dependency direction is clear.

□ The decision can be tested for conformance.
```

## Alternatives

```text
□ Meaningful alternatives are considered.

□ Rejected alternatives include rationale.

□ Vendor lock-in and replaceability are considered.

□ Deterministic alternatives are considered before probabilistic approaches.
```

## Consequences

```text
□ Positive consequences are stated.

□ Negative consequences are stated.

□ Migration impact is stated.

□ Operational impact is stated.

□ Security and AI impact are stated.
```

## Traceability

```text
□ Related Foundation artifacts are listed.

□ Related ADRs are listed.

□ Affected specifications are listed.

□ Affected components and interfaces are identified.

□ Supersession relationships are valid.
```

An ADR SHALL NOT be approved when the decision remains ambiguous.

---

# 10. Governance Document Review

Governance reviewers SHALL verify:

```text
□ The policy owner is identified.

□ The policy does not redefine Product or domain behavior.

□ Enforcement level is declared.

□ Required roles and approvals are defined.

□ Exceptions are governed.

□ Violation severity is defined.

□ Machine-readable validation is considered.

□ AI agent instructions are included where relevant.

□ Quality-gate integration is defined.

□ The policy aligns with existing governance documents.
```

---

# 11. Ontology Review

Ontology review SHALL verify:

```text
□ The concept has an authoritative semantic source.

□ The entity name is canonical.

□ Synonyms and aliases are handled.

□ The definition is unambiguous.

□ Entity boundaries are clear.

□ Relationships have controlled types.

□ Relationship direction is correct.

□ Cardinality is defined where necessary.

□ Lifecycle semantics are defined.

□ No persistence or vendor detail leaks into semantics.

□ Existing Knowledge Objects can be classified or migrated.

□ Schema implications are identified.
```

The Ontology Steward and relevant Domain Owner SHALL review semantic changes.

---

# 12. Schema Review

Schema review SHALL verify:

## Semantic Alignment

```text
□ Every field has semantic or technical justification.

□ Fields map to ontology or contract concepts.

□ The schema does not invent business meaning.

□ Names are canonical and consistent.
```

## Structure

```text
□ Required and optional fields are intentional.

□ Null behavior is explicit.

□ Defaults are safe.

□ Enumerations are governed.

□ Constraints are appropriate.

□ Recursive structures are intentional.

□ Error structures are normalized.
```

## Versioning

```text
□ Compatibility is declared.

□ Breaking changes are identified.

□ Previous versions remain resolvable.

□ Migration requirements are defined.

□ Producers and consumers are identified.
```

## Security

```text
□ Sensitive fields are classified.

□ Secrets are not included unnecessarily.

□ Redaction behavior is defined.

□ Access implications are reviewed.
```

## Validation

```text
□ Valid examples exist.

□ Invalid examples exist.

□ Boundary cases are tested.

□ Contract tests are updated.

□ Historical records remain interpretable.
```

---

# 13. Rule Review

Rule review SHALL verify:

## Authority

```text
□ The rule has an authoritative source.

□ The semantic owner is identified.

□ The rule is appropriate for deterministic execution.

□ The rule is not hidden prompt logic.
```

## Inputs and Outputs

```text
□ Inputs are schema-defined.

□ Required knowledge is approved.

□ Output states are explicit.

□ Unresolved behavior is explicit.

□ Error behavior is explicit.
```

## Logic

```text
□ Logic is deterministic.

□ Precedence is defined.

□ Scope resolution is defined.

□ Boundary conditions are defined.

□ Effective dates are handled.

□ Conflicts are handled.

□ No LLM call is required to determine the rule result.
```

## Explainability

```text
□ Applied rule identifiers are available.

□ Input values can be recorded safely.

□ Resolution path is explainable.

□ Overrides are traceable.
```

## Validation

```text
□ Positive cases exist.

□ Negative cases exist.

□ Boundary cases exist.

□ Conflict cases exist.

□ Precedence cases exist.

□ Regression cases exist.
```

---

# 14. Knowledge Object Review

An approved Knowledge Object review SHALL verify:

```text
□ Stable Knowledge Object ID exists.

□ Knowledge category is valid.

□ Ontology type is valid.

□ Schema validation passes.

□ Scope is explicit.

□ Owner is authorized for the scope.

□ Provenance is present.

□ Evidence is present and accessible.

□ Confidence is appropriate if inferred.

□ Conflict detection has run.

□ Deduplication has run.

□ Existing knowledge has been compared.

□ Effective dates are valid.

□ Approval authority is valid.

□ Sensitive content is classified.

□ Historical versions remain preserved.
```

Business-rule knowledge SHALL require Domain validation.

Technical knowledge MAY use policy-based auto-approval only when explicitly allowed.

---

# 15. Knowledge Candidate Review

A Knowledge Candidate review SHALL verify:

```text
□ The candidate is derived from an Observation or approved source.

□ The candidate producer is recorded.

□ Evidence is preserved.

□ Proposed category is valid.

□ Proposed scope is appropriate.

□ Normalization is complete.

□ Conflicts are listed.

□ Confidence does not exceed evidence quality.

□ The candidate is not already authoritative.

□ The validator has authority.

□ Approval, rejection, merge, supersession, or deferral is justified.
```

The reviewer SHALL reject direct promotion when evidence or authority is insufficient.

---

# 16. Product Specification Review

Product review SHALL verify:

## Intent

```text
□ The capability supports Product Vision.

□ User or business outcome is explicit.

□ Scope and non-scope are clear.

□ Success criteria are measurable.
```

## Requirements

```text
□ Functional requirements are complete.

□ Non-functional requirements are considered.

□ Acceptance criteria are testable.

□ Business rules are separated from narrative text.

□ Dependencies on knowledge are explicit.
```

## Architecture Alignment

```text
□ The specification does not prescribe unnecessary technology.

□ Architecture boundaries are respected.

□ New interfaces are identified.

□ Plugin needs are expressed as capabilities, not vendors.
```

## Risk and Quality

```text
□ Risks are identified.

□ Test Strategy implications are identified.

□ Evidence expectations are defined.

□ Release and operational implications are considered.
```

---

# 17. Requirement Review

Every requirement review SHALL verify:

```text
□ The requirement has a stable ID.

□ The source is authoritative.

□ The owner is identified.

□ The statement is clear and singular.

□ Scope is explicit.

□ Priority is justified.

□ Acceptance criteria are objective.

□ Business rules are referenced.

□ Risks are identified.

□ Validation method exists.

□ Dependencies are explicit.

□ Conflicts with other requirements are resolved.

□ The requirement is not an implementation instruction unless technical by type.
```

A requirement SHALL not be approved when its expected behavior cannot be determined.

---

# 18. Risk Review

Risk review SHALL verify:

```text
□ The risk has a cause, event, and consequence.

□ Likelihood is justified.

□ Impact is justified.

□ Severity is determined by an approved rule.

□ The owner is identified.

□ Mitigation is actionable.

□ Residual risk is recorded.

□ Validation evidence is defined.

□ Acceptance authority is identified.

□ Expiration or review date exists where applicable.
```

---

# 19. Test Strategy Review

Test Strategy review SHALL verify:

```text
□ Scope matches Product and release scope.

□ Requirements are represented.

□ Business Rules are represented.

□ Risks drive prioritization.

□ Test levels are appropriate.

□ Test types are appropriate.

□ Environments are identified.

□ Test data strategy is defined.

□ Automation strategy is defined.

□ Manual validation is justified where retained.

□ Entry and exit criteria are defined.

□ Evidence and reporting expectations are defined.

□ Limitations and accepted gaps are explicit.
```

---

# 20. Test Case Review

Every Test Case review SHALL verify:

## Traceability

```text
□ The Test Case traces to a valid objective.

□ Coverage scope is explicit.

□ Related requirements, rules, risks, or Bugs are listed.
```

## Design

```text
□ Preconditions are necessary and sufficient.

□ Steps are clear.

□ Test data is defined.

□ Expected results are objective.

□ Each assertion maps to governing intent.

□ Positive, negative, and boundary cases are considered.

□ The Test Case is independent where practical.
```

## Maintainability

```text
□ Business meaning is not encoded only in selectors.

□ Reusable setup is identified.

□ Environment assumptions are explicit.

□ Flakiness risks are considered.

□ Automation feasibility is assessed.
```

A Test Case SHALL NOT be approved merely because it is executable.

---

# 21. Automation Asset Review

Automation review SHALL verify:

```text
□ The asset implements an approved Test Case or technical control.

□ Execution Engine abstractions are used.

□ Framework-specific code remains inside adapters where required.

□ Semantic UI or API contracts are used instead of raw implementation assumptions.

□ Locators are traceable.

□ Assertions match expected behavior.

□ Test data is controlled.

□ Secrets are not hardcoded.

□ Retries do not hide failures.

□ Evidence collection is adequate.

□ Errors are normalized.

□ Cleanup is safe.

□ Parallel execution is considered.

□ Workspace scope is explicit.

□ Maintenance ownership is assigned.
```

---

# 22. Interface Review

Interface review SHALL verify:

## Contract

```text
□ The interface has one owner.

□ The capability boundary is clear.

□ Requests and responses are schema-defined.

□ Errors are normalized.

□ Lifecycle behavior is explicit.

□ Security requirements are explicit.

□ Idempotency is defined where relevant.

□ Timeouts and cancellation are defined where relevant.
```

## Independence

```text
□ Vendor SDK types do not leak.

□ Database entities do not leak.

□ Framework-specific objects do not leak.

□ Consumers can implement against the contract independently.
```

## Compatibility

```text
□ Versioning is defined.

□ Breaking changes are declared.

□ Providers are identified.

□ Consumers are identified.

□ Migration and deprecation are defined.

□ Contract tests exist.
```

---

# 23. Component Review

Component review SHALL verify:

```text
□ The component has one primary responsibility.

□ The component has an accountable owner.

□ Its governing specification is identified.

□ Owned data is identified.

□ Exposed interfaces are identified.

□ Consumed interfaces are identified.

□ Internal implementation does not leak.

□ Dependencies follow the Dependency Matrix.

□ Cross-component state mutation is absent.

□ Workspace boundaries are respected.

□ Failure behavior is defined.

□ Observability is adequate.

□ Tests cover component responsibility.

□ Operational ownership is defined.
```

---

# 24. Plugin Review

Plugin review SHALL verify:

```text
□ The plugin implements an approved platform interface.

□ Capability declarations are accurate.

□ The plugin contains no Product business logic.

□ The plugin does not depend on another plugin.

□ Vendor SDK usage is isolated.

□ Vendor types are normalized.

□ Authentication and credentials follow Security policy.

□ Required permission scopes are minimal.

□ Rate limits are handled.

□ Vendor errors are translated.

□ Configuration is schema-valid.

□ Workspace enablement is explicit.

□ Contract and integration tests exist.

□ Supported vendor versions are declared.

□ Upgrade and deprecation policies exist.
```

---

# 25. Runtime Review

Runtime review SHALL verify:

```text
□ Runtime behavior implements approved intent.

□ Runtime does not create new business rules.

□ Dependencies are injected through contracts.

□ Workspace context is explicit.

□ Authorization occurs before protected action.

□ Timeouts are appropriate.

□ Retries are safe and idempotent where required.

□ Concurrency is safe.

□ Cancellation is handled.

□ Failure recovery is defined.

□ Evidence is collected.

□ Telemetry is adequate.

□ Resource limits are defined.

□ Operational ownership is assigned.

□ Rollback is possible or irreversibility is approved.
```

---

# 26. Execution Review

Execution review SHALL verify:

```text
□ Execution has a unique identifier.

□ The plan is traceable.

□ Asset versions are recorded.

□ Engine and adapter versions are recorded.

□ Workspace and environment are recorded.

□ Test data is traceable.

□ Knowledge snapshot is recorded where relevant.

□ Rule versions are recorded.

□ Authorization is valid.

□ Evidence is attached.

□ Result classification is normalized.

□ Failures distinguish Product, automation, environment, and dependency causes.

□ Sensitive data is redacted.
```

---

# 27. Bug Review

Bug review SHALL verify:

```text
□ The unmet expectation is identified.

□ Supporting evidence exists.

□ Affected requirement or rule is identified where applicable.

□ Environment and version are recorded.

□ Severity and priority are justified.

□ Ownership is assigned.

□ Root cause is distinguished from symptom.

□ Fix traces to the Bug.

□ Regression coverage is defined.

□ Closure requires verification evidence.

□ Alternate dispositions are authorized.
```

---

# 28. Migration Review

Every migration review SHALL verify:

```text
□ Source and target versions are defined.

□ Affected data or consumers are identified.

□ Preconditions are defined.

□ Transformation is deterministic.

□ Validation is defined.

□ Partial failure behavior is defined.

□ Idempotency is considered.

□ Rollback is defined.

□ Irreversible steps are explicit.

□ Backup requirements are defined.

□ Execution order is defined.

□ Ownership is assigned.

□ Progress is observable.

□ Completion evidence is retained.
```

---

# 29. Release Review

Release review SHALL verify:

## Scope

```text
□ Included changes are identified.

□ Artifact versions are identified.

□ Source revision is identified.

□ Breaking changes are declared.

□ Migrations are included.
```

## Quality

```text
□ Required tests passed.

□ Known failures are documented.

□ Coverage gaps are documented.

□ Security review is complete.

□ Quality Gates passed.
```

## Operations

```text
□ Deployment plan exists.

□ Rollback plan exists.

□ Monitoring is ready.

□ Runbooks are current.

□ On-call or support ownership is defined.
```

## Communication

```text
□ Consumer impact is communicated.

□ Migration guidance is available.

□ Changelog is updated.

□ Deprecations are announced.
```

## Approval

```text
□ Release Owner is identified.

□ Required approvers have approved.

□ Residual risks are accepted by authorized owners.

□ Release evidence is retained.
```

---

# 30. Security Review Checklist

A focused Security review SHALL verify:

```text
□ Threat model exists or remains valid.

□ Assets are identified.

□ Trust boundaries are identified.

□ Authentication is appropriate.

□ Authorization is least privilege.

□ Cross-Workspace access is prohibited or authorized.

□ Credentials use approved providers.

□ Secrets are not logged.

□ Sensitive data is minimized.

□ Encryption requirements are met.

□ External inputs are validated.

□ External content is treated as untrusted.

□ Prompt-injection risks are addressed.

□ Destructive actions require explicit authorization.

□ Audit records are immutable enough for risk.

□ Incident response implications are covered.

□ Security testing is complete.
```

---

# 31. AI Review Checklist

A focused AI review SHALL verify:

## Necessity

```text
□ The task benefits from probabilistic reasoning.

□ Deterministic alternatives were considered.

□ The LLM is not replacing an existing rule.
```

## Inputs

```text
□ Inputs are structured.

□ Raw HTML is not provided.

□ Knowledge context is scoped.

□ Sources are authoritative or clearly labeled.

□ Sensitive content is minimized.
```

## Outputs

```text
□ Output schema is defined.

□ Validation is mandatory.

□ Failure modes are defined.

□ Confidence is interpreted according to governance.

□ Unsupported claims are rejected or escalated.
```

## Autonomy

```text
□ Autonomy level is declared.

□ The action is permitted at that level.

□ High-risk actions require approval.

□ Destructive actions are separately authorized.

□ Learning actions follow candidate governance.
```

## Provider Independence

```text
□ AI is accessed through a provider interface.

□ Model-specific behavior is isolated.

□ Fallback behavior is defined.

□ Provider errors are normalized.
```

## Evaluation

```text
□ Evaluation cases exist.

□ Structured-output compliance is tested.

□ Hallucination risk is tested.

□ Prompt-injection resilience is tested.

□ Regression results are available.

□ Cost and latency are measured where relevant.
```

---

# 32. Discovery Review Checklist

Discovery review SHALL verify:

```text
□ Authorized sources are searched before asking the user.

□ Source priority is defined.

□ Scope and permissions are respected.

□ Collected evidence preserves provenance.

□ Raw DOM remains evidence.

□ Semantic UI is the canonical UI representation.

□ Incomplete evidence is not presented as confirmed fact.

□ Observations do not become Knowledge Objects directly.

□ User questions are asked only when evidence remains insufficient.

□ Discovery failures are observable.

□ Sensitive sources are handled according to policy.
```

---

# 33. Semantic UI Review Checklist

```text
□ Raw DOM is cleaned before semantic analysis.

□ Semantic entities have stable identities.

□ Meaning is separated from selectors.

□ Screens, regions, elements, actions, and states are represented.

□ Evidence links to DOM snapshots exist.

□ Confidence is recorded for inferred semantics.

□ Locator knowledge remains separate from business rules.

□ The UI Knowledge Graph uses controlled relationships.

□ LLM reasoning uses Semantic UI rather than raw DOM.

□ Historical semantic versions remain traceable.
```

---

# 34. Workspace Isolation Review Checklist

```text
□ Every project-scoped operation receives Workspace context.

□ Data access is Workspace-filtered.

□ Cache keys include Workspace scope.

□ Events include Workspace identity.

□ Logs and evidence include Workspace identity safely.

□ Credentials are Workspace-scoped where required.

□ Plugin configuration is Workspace-scoped.

□ Runtime state is isolated.

□ Cross-Workspace references require authorization.

□ Tests cover isolation failures.

□ Deletion and retention are Workspace-aware.
```

---

# 35. Data Review Checklist

```text
□ Semantic owner is identified.

□ Storage owner is identified.

□ Access-policy owner is identified.

□ Retention owner is identified.

□ Schema is versioned.

□ Migration is defined.

□ Data classification is defined.

□ Historical interpretation is preserved.

□ Deletion behavior is defined.

□ Backups and recovery are considered.

□ Data exposure to AI providers is reviewed.

□ Cross-scope movement is authorized.
```

---

# 36. Observability Review Checklist

```text
□ Critical decisions are observable.

□ Failures have normalized error categories.

□ Correlation identifiers exist.

□ Workspace identity is recorded safely.

□ Rule decisions can be explained.

□ Knowledge versions can be identified.

□ AI provider and model metadata are recorded.

□ Sensitive values are redacted.

□ Metrics have owners and definitions.

□ Alerts have actions and owners.

□ Retention is appropriate.

□ Telemetry cost is considered.
```

---

# 37. Documentation Review Checklist

```text
□ The document type is clear.

□ Normative statements use consistent language.

□ Terms follow the Canonical Glossary.

□ Stable IDs are used.

□ Ownership metadata is present.

□ Dependencies are declared.

□ Related artifacts are referenced.

□ Examples do not contradict normative behavior.

□ Diagrams match text.

□ Status and version are current.

□ Deprecated guidance is marked.

□ AI agents can identify authoritative sections.
```

Normative language SHOULD use:

- SHALL
- SHALL NOT
- SHOULD
- SHOULD NOT
- MAY

---

# 38. Review Comment Classification

Review comments SHOULD be classified as:

## Blocking

Must be resolved before approval.

Examples:

- authority conflict
- security violation
- breaking change not declared
- missing migration
- invalid ownership
- missing evidence
- prohibited dependency

---

## Required

Must be corrected, but the reviewer may permit conditional approval when risk is bounded.

---

## Recommendation

Improves quality but is not required for acceptance.

---

## Question

Requests clarification.

A question becomes blocking when the answer is necessary to determine correctness or safety.

---

## Note

Provides context without requesting change.

---

# 39. Review Evidence

A completed review SHOULD preserve:

```yaml
review_id:
artifact:
artifact_version:
change_id:
reviewer:
reviewer_role:
scope_reviewed:
outcome:
blocking_findings:
conditions:
evidence_reviewed:
risks_accepted:
reviewed_at:
```

For high-risk changes, review evidence SHALL identify the specific areas reviewed.

A generic approval without scope may be insufficient.

---

# 40. Review Coverage

A change is review-complete only when all required domains are covered.

Possible review domains:

```text
Product

Architecture

Governance

Ontology

Schema

Knowledge

Rules

Interfaces

Implementation

Security

AI

Quality

Operations

Migration

Release
```

One reviewer MAY cover multiple domains only when authorized and qualified.

---

# 41. Review Routing Matrix

| Change Type | Minimum Required Review |
|---|---|
| Editorial | Artifact Owner |
| Metadata | Artifact Owner and Repository Maintainer where indexed |
| Foundation | Engineering Governance and Architecture |
| ADR | Architecture |
| Governance | Engineering Governance |
| Ontology | Ontology Steward and Domain Owner |
| Schema | Schema Steward and affected Interface Owners |
| Business Rule | Domain Owner and Rule Governance |
| Knowledge Lifecycle | Knowledge Governance |
| Product Behavior | Product Capability Owner and Quality Engineering |
| Architecture Boundary | Architecture |
| Interface | Interface Owner and affected providers and consumers |
| Component | Component Owner |
| Plugin | Plugin Owner, Interface Owner, Security |
| Execution Safety | Execution Platform Owner and Security |
| Workspace Isolation | Architecture and Security |
| AI Autonomy | AI Governance and Security |
| Prompt | AI Capability Owner and AI Governance where high risk |
| Data Migration | Data Owner and Platform Operations |
| Release | Release Owner and required gate owners |

---

# 42. Review Escalation Rules

Escalation is required when:

- authoritative artifacts conflict
- ownership is disputed
- reviewer authority is insufficient
- security and Product goals conflict
- Architecture and implementation constraints conflict
- a change requires an exception
- unknown impact remains material
- a high-risk residual risk lacks acceptance authority

Escalation path:

```text
Artifact Owner

↓

Domain Governance

↓

Architecture or Product Governance

↓

Engineering Governance

↓

Executive or Organizational Authority
```

Security concerns SHALL be escalated to Security regardless of other routing.

---

# 43. Review of AI-Generated Contributions

AI-generated contributions SHALL be reviewed as generated drafts.

Reviewers SHALL verify:

```text
□ Generation provenance is recorded.

□ Sources actually support the content.

□ No fabricated artifact IDs exist.

□ No fabricated evidence exists.

□ Existing repository artifacts were searched.

□ Duplicate definitions were not created.

□ Architecture is not hidden in code.

□ Business rules are not hidden in prompts.

□ Ownership is not invented.

□ Scope is not inferred incorrectly.

□ Normative language is intentional.

□ Citations and references are valid.

□ Generated tests trace to valid objectives.

□ Generated knowledge remains a candidate until approval.
```

AI-generated volume SHALL NOT reduce required review depth.

---

# 44. Review of Automated Changes

Automated changes include:

- generated indexes
- schema-generated code
- dependency updates
- formatting
- migrations
- repository graph updates

Reviewers SHALL verify:

```text
□ The generator is identified.

□ The source artifacts are authoritative.

□ Generated output is reproducible.

□ Manual edits will not be overwritten unexpectedly.

□ Diff size is explainable.

□ Semantic changes are isolated from mechanical changes.

□ Generated artifacts are validated.

□ Dependency or security updates include impact assessment.
```

---

# 45. Review of Refactoring

A refactor review SHALL verify:

```text
□ Behavior is intended to remain unchanged.

□ Governing interfaces remain unchanged or are reviewed separately.

□ Tests demonstrate behavior equivalence.

□ Dependencies improve or remain valid.

□ Ownership remains clear.

□ No business rules move into inappropriate layers.

□ No hidden vendor coupling is introduced.

□ Observability is preserved.

□ Performance regressions are assessed.

□ Migration is unnecessary or explicitly defined.
```

A refactor that changes behavior SHALL be reclassified.

---

# 46. Review of Breaking Changes

Every breaking-change review SHALL verify:

```text
□ The breaking change is explicitly declared.

□ Affected consumers are identified.

□ The Change Owner is identified.

□ The new version is defined.

□ Compatibility strategy is defined.

□ Migration steps are defined.

□ Migration ownership is assigned.

□ Rollout order is defined.

□ Rollback is defined.

□ Consumer communication is prepared.

□ Contract and migration tests exist.

□ Old behavior removal criteria are defined.
```

---

# 47. Review of Exceptions

Every exception review SHALL verify:

```text
□ The normal rule is identified.

□ The reason is valid.

□ Scope is bounded.

□ Risk is documented.

□ Mitigation exists.

□ Owner is assigned.

□ Approval authority is valid.

□ Expiration date exists.

□ Removal or resolution plan exists.

□ Monitoring is defined where necessary.
```

Exceptions SHALL NOT be approved merely to avoid necessary work.

---

# 48. Review Anti-Patterns

## 48.1 Code-Only Review

Approving implementation without reviewing governing intent.

---

## 48.2 Style-Only Review

Focusing on formatting while missing semantic or architectural errors.

---

## 48.3 Approval by Familiarity

Approving because the author or component is trusted rather than because evidence is sufficient.

---

## 48.4 Diff-Only Review

Reviewing only changed lines without inspecting affected relationships and consumers.

---

## 48.5 Prompt-Output Review Without Sources

Accepting AI-generated content because it sounds correct.

---

## 48.6 Reviewer Ownership Assumption

Assuming the reviewer owns the decision merely because they were requested.

---

## 48.7 Test-Pass Equals Correctness

Treating passing tests as proof that requirements are correct and complete.

---

## 48.8 No Comment Equals Approval

Silence SHALL NOT be interpreted as formal approval.

---

## 48.9 Hidden Conditional Approval

Approval SHALL not depend on unrecorded verbal conditions.

---

## 48.10 Rubber-Stamp Review

A review that does not examine applicable governance is invalid.

---

# 49. Review Automation

The repository SHOULD automate review preparation.

Automation SHOULD provide:

- changed artifact classification
- owner resolution
- required reviewer resolution
- dependency validation
- traceability validation
- impact traversal
- breaking-change detection
- schema compatibility checks
- orphan detection
- generated-artifact staleness
- exception expiry
- required test selection
- quality-gate status

Suggested locations:

```text
tests/governance/test_review_metadata.*

tests/governance/test_required_reviewers.*

tests/governance/test_review_authority.*

tests/governance/test_breaking_change_review.*

tests/governance/test_review_evidence.*

tests/governance/test_exception_review.*
```

---

# 50. Machine-Readable Review Model

The repository MAY maintain:

```text
meta/REVIEW_POLICY.yaml
```

Recommended structure:

```yaml
artifact_types:
  specification:
    required_reviews:
      - owner
      - architecture_when_cross_domain
    required_checks:
      - traceability
      - dependencies
      - ownership
      - quality

change_types:
  breaking_interface:
    required_roles:
      - interface_owner
      - architecture
      - affected_consumers
    required_evidence:
      - consumer_inventory
      - migration_plan
      - contract_tests
```

A review record MAY be stored as:

```yaml
review_id:
change_id:
artifact_id:
artifact_version:
reviewers:
checks:
findings:
outcome:
conditions:
approvals:
evidence:
```

---

# 51. AI Agent Review Instructions

When acting as a review assistant, an AI agent SHALL:

1. read Foundation artifacts first
2. identify applicable ADRs
3. identify artifact type and owner
4. classify the change
5. retrieve dependency rules
6. retrieve traceability relationships
7. retrieve change-impact information
8. check required reviewers
9. compare content against authoritative sources
10. identify unsupported claims
11. identify missing tests and evidence
12. identify security and AI concerns
13. classify findings by severity
14. distinguish facts from inferences
15. avoid issuing final human approval unless explicitly authorized by policy

An AI review assistant MUST NOT:

- fabricate repository state
- invent missing artifacts
- assume unverified compatibility
- approve its own high-risk contribution
- treat confidence as authority
- expose private chain-of-thought
- conceal uncertainty
- downgrade a violation to simplify acceptance
- modify authoritative artifacts during review without explicit change authority

---

# 52. Reviewer Self-Check

Before submitting a review, the reviewer SHALL ask:

```text
□ Did I identify the authoritative source?

□ Did I review the correct scope?

□ Do I have authority for this review?

□ Did I inspect direct and transitive impact?

□ Did I verify ownership?

□ Did I verify traceability?

□ Did I verify compatibility?

□ Did I inspect security and AI impact?

□ Did I inspect tests and evidence?

□ Did I record uncertainty?

□ Did I separate blocking issues from recommendations?

□ Does my outcome accurately reflect the evidence?
```

---

# 53. Approval Checklist

Approval SHALL require:

```text
□ All blocking findings are resolved.

□ Conditional requirements are explicit.

□ Required owners approved.

□ Required specialist reviewers approved.

□ Breaking status is correct.

□ Migration is ready where required.

□ Security requirements are satisfied.

□ AI Governance requirements are satisfied.

□ Required tests passed.

□ Evidence is attached.

□ Documentation and indexes are updated.

□ Residual risks are accepted by authorized owners.

□ Release implications are understood.
```

---

# 54. Rejection Checklist

A rejection SHOULD identify:

```text
□ The violated authority or policy.

□ The blocking defect.

□ The affected scope.

□ The required correction or alternate path.

□ The owner responsible for resolution.

□ Whether a new ADR, specification, rule, or migration is required.

□ Whether work must stop immediately.
```

Rejection language SHOULD be specific and actionable.

---

# 55. Review Completion Criteria

A review is complete when:

- outcome is recorded
- reviewer authority is identifiable
- reviewed scope is identifiable
- findings are classified
- blocking findings are resolved or the change is rejected
- evidence is referenced
- conditions are explicit
- required approvals are recorded
- traceability is updated
- review artifacts are retained according to policy

---

# 56. Review Metrics

Review effectiveness MAY be measured using:

- escaped governance violations
- escaped defects
- review turnaround
- blocking finding rate
- reopened changes
- missing-owner rate
- orphan-artifact rate
- breaking-change detection rate
- migration failure rate
- security finding rate
- AI-output correction rate
- stale-generated-artifact rate
- post-release rollback rate

Metrics SHALL NOT reward superficial speed over review quality.

---

# 57. Review Quality Levels

## Level 0 — Informal

Review depends on individual memory.

No consistent checklist exists.

---

## Level 1 — Documented

Standard checklists exist.

Application is mostly manual.

---

## Level 2 — Role-Aware

Review routing uses ownership and change type.

Required reviewers are explicit.

---

## Level 3 — Traceability-Aware

Reviews use machine-readable dependency and traceability graphs.

Impact analysis is integrated.

---

## Level 4 — Gate-Integrated

Blocking review requirements are enforced automatically in delivery workflows.

---

## Level 5 — Intelligent Review Assistance

The system can:

- recommend reviewers
- detect likely missing impacts
- identify suspicious claims
- select regression scope
- suggest missing traceability
- detect governance drift

AI remains advisory unless explicit policy grants bounded approval authority.

---

# 58. Review Violation Severity

## Critical

Examples:

- approval by an unauthorized party for a destructive action
- Security review bypassed
- cross-Workspace isolation not reviewed
- AI autonomy increased without authorization
- credentials exposed in review artifacts
- unvalidated knowledge approved as authoritative

Critical violations invalidate the review and block merge or release.

---

## High

Examples:

- breaking change approved without migration
- architecture change approved without Architecture
- business rule approved without Domain Owner
- release approved without required evidence
- interface change approved without consumer analysis
- Bug closed without verification

High violations invalidate approval.

---

## Medium

Examples:

- required consulted party omitted
- review scope not recorded
- non-critical evidence incomplete
- recommendation incorrectly marked as resolved
- metadata partially incomplete

Medium violations require correction.

---

## Low

Examples:

- optional context omitted
- minor formatting inconsistency
- non-authoritative note not updated

Low violations SHOULD be corrected during normal maintenance.

---

# 59. Review Exceptions

A review exception MAY be granted only when:

- normal review cannot be completed in time
- urgency is justified
- risk is bounded
- interim safeguards exist
- an authorized approver accepts the risk
- post-change review is scheduled
- expiration is explicit

Exception metadata:

```yaml
id:
change_id:
missing_review:
reason:
urgency:
risk:
scope:
interim_controls:
owner:
approved_by:
created_at:
expires_at:
post_review_plan:
```

An emergency review exception SHALL not permanently remove required review.

---

# 60. Definition of Done

This document is complete when:

- universal review principles are defined
- review roles and outcomes are defined
- entry and completion criteria are defined
- Foundation, ADR, governance, ontology, schema, rule, knowledge, Product, requirement, risk, test, automation, interface, component, plugin, runtime, execution, Bug, migration, release, security, and AI reviews are covered
- review routing and escalation are defined
- AI-generated and automated changes are covered
- breaking changes and exceptions are covered
- machine-readable review policy is defined
- violation severity is defined
- AI review-assistant instructions are defined

Review governance implementation is complete when:

- changes are automatically classified where practical
- required reviewers are resolved from ownership metadata
- dependency and traceability checks run automatically
- impact analysis is available to reviewers
- breaking changes require migration evidence
- high-risk changes require specialist approval
- review outcomes are recorded
- review evidence is retained
- critical and high review violations invalidate acceptance
- AI review assistance is explainable and governed

---

# 61. Summary

QA Intelligence SHALL review every governed change through the following chain:

```text
Authority

↓

Ownership

↓

Scope

↓

Dependencies

↓

Traceability

↓

Impact

↓

Compatibility

↓

Security and AI

↓

Validation

↓

Operations

↓

Approval
```

A correct implementation can still be the wrong change.

A passing test can still validate the wrong requirement.

A high-confidence AI output can still be unsupported.

A well-structured schema can still model the wrong meaning.

A successful deployment can still violate architecture.

Review therefore SHALL validate:

- why the change exists
- who owns it
- where it belongs
- what it affects
- how it is governed
- how it is tested
- what evidence supports it
- whether it is safe to accept

A review that cannot explain its authority, scope, findings, evidence, and outcome is not a complete review.
