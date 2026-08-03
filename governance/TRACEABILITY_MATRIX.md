---
id: GOV-006
title: Traceability Matrix
version: 1.1.0
status: accepted
owner:
  - Engineering Governance
accountable_owner: Engineering Governance
approvers:
  - Architecture
  - Product Governance
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

# Traceability Matrix

## 1. Purpose

This document defines the canonical traceability model for the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- connect product intent to runtime evidence
- make every engineering artifact explainable
- establish bidirectional relationships between artifacts
- detect missing or orphaned lifecycle links
- support impact analysis
- support auditability and compliance
- ensure generated tests are grounded in evidence
- preserve provenance across AI-assisted workflows
- support controlled learning
- enable machine-readable repository navigation
- prevent implementation from becoming disconnected from governing intent

This document answers the following questions:

- Why does this artifact exist?
- Which requirement authorizes this behavior?
- Which business rule governs this decision?
- Which test validates this requirement?
- Which automation asset implements this test?
- Which execution produced this result?
- Which evidence supports this conclusion?
- Which bug indicates a failed expectation?
- Which knowledge was learned from the outcome?
- Which owner is accountable for every relationship?

Traceability is a mandatory architectural property.

An artifact that cannot be traced to authoritative intent or justified platform infrastructure SHALL be considered incomplete.

---

# 2. Traceability Philosophy

QA Intelligence SHALL preserve a continuous evidence chain from intent to learning.

The canonical lifecycle is:

```text
Vision

↓

Product Principle

↓

Engineering Law

↓

Architecture Decision

↓

Specification

↓

Requirement

↓

Business Rule

↓

Risk

↓

Test Strategy

↓

Test Case

↓

Automation Asset

↓

Execution

↓

Evidence

↓

Result

↓

Bug or Report

↓

Knowledge Candidate

↓

Validated Knowledge
```

For Agent and Skill delivery, the mandatory specialized chain is:

```text
Accepted QA Requirement or Risk
↓
Agent or Skill Definition and exact version
↓
Prompt, Rule, Knowledge, Tool, Policy, and Environment versions
↓
Evaluation Suite and Case
↓
Evaluation Run and isolated Trials
↓
Step, Tool, Oracle or Judge, and Policy Evidence
↓
Evaluation Result and Release Recommendation
↓
Authorized Release Decision and deployed version
↓
Operational Observation
↓
Knowledge Candidate when reusable learning is proposed
```

The chain SHALL remain complete across baseline comparison and rollback. A score without exact subject and evaluator conditions is not traceable evidence.

Not every workflow uses every node.

Every node SHALL, however, be traceable to its valid upstream authority and downstream validation where applicable.

The system SHALL support both:

```text
Forward Traceability
```

and:

```text
Backward Traceability
```

Forward traceability asks:

> What was created, implemented, tested, executed, or learned because of this artifact?

Backward traceability asks:

> Which authoritative intent, decision, evidence, or source justifies this artifact?

---

# 3. Traceability Principles

## 3.1 Every Authoritative Artifact Has an Origin

Every authoritative artifact SHALL identify one or more valid sources.

Valid origins include:

- Foundation Specification
- accepted ADR
- approved requirement
- approved business rule
- approved Knowledge Object
- authorized external standard
- verified discovery evidence
- explicit user decision
- approved change request
- validated runtime observation

Implementation convenience is not an authoritative origin.

---

## 3.2 Every Implementation Has Governing Intent

Every production implementation unit SHALL trace to at least one of:

- Component Specification
- Interface Specification
- Runtime Specification
- approved defect
- approved technical requirement
- accepted ADR
- governed maintenance task

Source code without governing intent is architectural drift.

---

## 3.3 Every Requirement Has Validation

Every approved requirement SHALL trace to at least one validation mechanism unless explicitly classified as non-testable with approved justification.

Validation mechanisms include:

- deterministic rule
- schema validation
- test case
- contract test
- architecture test
- security test
- manual review
- operational metric
- audit control

---

## 3.4 Every Test Has a Reason

Every Test Case SHALL trace backward to one or more of:

- requirement
- business rule
- validation rule
- risk
- known issue
- regulatory obligation
- architecture invariant
- interface contract
- historical defect
- approved exploratory objective

A Test Case SHALL NOT exist only because an LLM generated it.

---

## 3.5 Every Result Has Evidence

Every execution result SHALL trace to:

- execution identifier
- executable asset version
- environment
- configuration
- input data
- timestamps
- engine and adapter version
- evidence artifacts
- normalized outcome
- applicable expectations

A pass or failure without retained evidence SHALL be treated according to the evidence-quality policy.

---

## 3.6 Every Learned Fact Has Provenance

Every Knowledge Candidate and accepted Knowledge Object SHALL preserve:

- source
- evidence
- observation time
- producing capability
- scope
- confidence
- validator
- lifecycle history
- related artifacts
- conflict status

Learned knowledge without provenance SHALL NOT become authoritative.

---

## 3.7 Traceability Is Bidirectional

A relationship SHALL be queryable from both directions.

Example:

```text
Requirement REQ-001
        ↓ validated_by
Test Case TC-014
```

The system SHALL also support:

```text
Test Case TC-014
        ↑ validates
Requirement REQ-001
```

Reverse relationships MAY be stored directly or derived from an authoritative relationship record.

---

## 3.8 Traceability Is Typed

Relationships SHALL use controlled relationship types.

Generic links such as:

```text
related_to
```

SHOULD be avoided when a more precise relationship exists.

Preferred examples:

```text
implements

validates

derived_from

constrained_by

produced_by

executed_by

failed_by

supersedes

evidenced_by
```

---

## 3.9 Traceability Does Not Imply Authority

A link to an artifact does not automatically make that artifact authoritative.

For example:

```text
Knowledge Candidate
    → derived_from
Observation
```

does not make the Observation an approved Knowledge Object.

Relationship semantics SHALL preserve lifecycle and authority distinctions.

---

## 3.10 Traceability Must Survive Change

When an artifact is:

- versioned
- moved
- renamed
- superseded
- deprecated
- migrated
- split
- merged
- archived

its traceability history SHALL be preserved.

Stable identifiers SHALL be used instead of file paths or display names as primary identity.

---

# 4. Traceability Dimensions

QA Intelligence SHALL maintain traceability across the following dimensions.

## 4.1 Intent Traceability

Connects:

```text
Vision

↓

Product Principles

↓

Product Goals

↓

Capabilities

↓

Requirements
```

---

## 4.2 Decision Traceability

Connects:

```text
Problem

↓

ADR

↓

Specification

↓

Implementation Constraint
```

---

## 4.3 Semantic Traceability

Connects:

```text
Glossary Term

↓

Ontology Entity

↓

Schema Definition

↓

Knowledge Object
```

---

## 4.4 Behavioral Traceability

Connects:

```text
Requirement

↓

Business Rule

↓

Expected Behavior

↓

Test Case
```

---

## 4.5 Risk Traceability

Connects:

```text
Requirement or Change

↓

Risk

↓

Mitigation

↓

Test Strategy

↓

Validation Evidence
```

---

## 4.6 Implementation Traceability

Connects:

```text
Specification

↓

Component

↓

Interface

↓

Source Module

↓

Commit or Release
```

---

## 4.7 Execution Traceability

Connects:

```text
Test Case

↓

Automation Asset

↓

Execution Plan

↓

Execution Run

↓

Evidence

↓

Result
```

---

## 4.8 Defect Traceability

Connects:

```text
Failed Expectation

↓

Execution Evidence

↓

Bug

↓

Root Cause

↓

Fix

↓

Regression Test

↓

Verification Run
```

---

## 4.9 Learning Traceability

Connects:

```text
Observation

↓

Knowledge Candidate

↓

Validation Decision

↓

Knowledge Object

↓

Future Decision
```

---

## 4.10 Governance Traceability

Connects:

```text
Change

↓

Owner

↓

Reviewer

↓

Approval

↓

Quality Gate

↓

Release
```

---

# 5. Canonical Traceability Layers

The canonical layers are:

| Layer | Purpose | Example Artifacts |
|---|---|---|
| Foundation | Defines immutable direction | Vision, Principles, Engineering Laws |
| Decision | Records architectural choices | ADRs |
| Governance | Defines control and policy | Governance documents, quality gates |
| Semantic | Defines meaning | Glossary, Ontology |
| Structural | Defines machine structure | Schemas |
| Knowledge | Defines reusable contextual truth | Knowledge Objects |
| Product | Defines capabilities and outcomes | Product Specifications |
| Requirement | Defines expected behavior | Requirements, acceptance criteria |
| Rule | Defines deterministic decisions | Business Rules, Validation Rules |
| Risk | Defines uncertainty and impact | Risk records |
| Strategy | Defines validation approach | Test Strategy |
| Test Design | Defines validation cases | Test Cases, test data |
| Automation | Defines executable validation | Automation assets |
| Execution | Defines runtime activity | Execution plans and runs |
| Evidence | Supports observations and results | Screenshots, logs, traces, responses |
| Defect | Represents unmet expectation | Bugs and root causes |
| Reporting | Communicates state and conclusions | Reports and dashboards |
| Learning | Converts observations into governed knowledge | Candidates and Knowledge Objects |

---

# 6. Master Traceability Matrix

| Source Artifact | Required Upstream Trace | Expected Downstream Trace |
|---|---|---|
| Vision | None; repository root authority | Product Principles, Product Goals |
| Product Principle | Vision | Engineering Laws, specifications, decisions |
| Engineering Law | Vision and Product Principles | ADRs, governance, architecture tests |
| AI Governance Policy | Engineering Laws | AI components, prompts, evaluations, runtime controls |
| ADR | Foundation and decision context | Specifications, interfaces, implementation |
| Governance Document | Foundation and related ADRs | reviews, quality gates, repository automation |
| Glossary Term | Foundation or domain authority | Ontology entities and specifications |
| Ontology Entity | Glossary or semantic authority | schemas, rules, Knowledge Objects |
| Schema | Ontology and specification | APIs, persistence, validation, artifacts |
| Knowledge Object | Evidence, provenance, ontology, schema | requirements, rules, reasoning, tests |
| Product Specification | Vision, Product Principles, Knowledge | requirements, architecture, acceptance criteria |
| Requirement | Product Specification or approved source | rules, risks, tests, implementation |
| Business Rule | Requirement or Domain Authority | Rule Engine, tests, decisions |
| Validation Rule | Requirement, schema, or policy | validation component and tests |
| Risk | requirement, change, evidence, or known issue | mitigation, strategy, test cases |
| Test Strategy | requirements, rules, risks | test design, execution policy |
| Test Case | requirement, rule, risk, defect, or contract | automation, execution, evidence |
| Test Data | test case and data policy | execution run and evidence |
| Automation Asset | test case and execution interface | execution run |
| Execution Plan | selected tests, environment, configuration | execution runs |
| Execution Run | plan, asset versions, environment | evidence and results |
| Evidence | execution or observation source | result, bug, report, candidate |
| Execution Result | expectation and evidence | bug, report, learning |
| Bug | failed expectation and evidence | root cause, fix, regression test |
| Fix | bug and governing specification | verification run and release |
| Report | results, risks, bugs, evidence | decisions and stakeholder actions |
| Knowledge Candidate | observation, evidence, provenance | validation decision |
| Knowledge Object Revision | approved candidate or governed change | future reasoning and behavior |
| Release | approved changes and quality gates | deployed version and operational evidence |

---

# 7. Foundation Traceability

Foundation artifacts SHALL be traceable through explicit governance relationships.

## 7.1 Vision

`SPEC-001 Vision` is the highest product-intent authority.

It SHALL trace downstream to:

- Product Principles
- Product capability families
- roadmap themes
- success criteria
- major architecture decisions

Foundation artifacts do not require a lower-level implementation relationship for every individual statement.

However, platform-wide capabilities SHOULD be explainable in terms of Vision.

---

## 7.2 Product Principles

Every Product Principle SHOULD trace to:

- Vision statement
- affected specifications
- governance controls
- architecture patterns
- quality criteria

Example:

```text
SPEC-002: Discover Before Asking

↓

ADR-006: Discovery Before Asking

↓

Discovery Specification

↓

Discovery Orchestrator

↓

User-question suppression tests
```

---

## 7.3 Engineering Laws

Every Engineering Law SHALL have at least one enforcement mechanism.

Enforcement may include:

- architecture review
- static analysis
- automated test
- schema validation
- quality gate
- runtime policy
- audit

Example:

```text
Knowledge Never Lives in Prompts

↓

ADR-001 Knowledge Store

↓

Prompt governance rule

↓

Prompt scanning test

↓

Quality Gate
```

---

## 7.4 AI Governance

Every AI governance rule SHALL trace to:

- affected AI capability
- validation mechanism
- autonomy enforcement
- audit evidence
- escalation behavior

Example:

```text
Autonomy Level 2 — Generation

↓

AI Task Policy

↓

Generated Artifact Status = Draft

↓

Human Approval

↓

Accepted Artifact
```

---

# 8. ADR Traceability

Every ADR SHALL identify:

```yaml
related_specs:
related_adrs:
supersedes:
superseded_by:
affected_components:
affected_interfaces:
implementation_evidence:
```

An ADR SHALL trace backward to:

- problem context
- Foundation principles
- conflicting forces
- prior decisions where applicable

An ADR SHALL trace forward to:

- governing specifications
- interfaces
- components
- implementation constraints
- conformance tests

A decision with no affected downstream artifact SHOULD be reviewed for relevance.

A downstream architectural pattern with no ADR SHOULD be reviewed for undocumented architecture.

---

## 8.1 ADR Status Traceability

ADR status transitions SHALL preserve:

```text
Proposed

↓

Accepted or Rejected

↓

Superseded or Deprecated
```

A superseded ADR SHALL reference its replacement.

Consumers SHALL be able to determine which decision version governed an implementation at a specific time.

---

# 9. Governance Traceability

Governance artifacts SHALL trace to:

- Foundation laws
- applicable ADRs
- governed repository artifacts
- review activities
- quality gates
- automated conformance checks

Example:

```text
DEPENDENCY_MATRIX.md

↓

Architecture dependency rules

↓

Static dependency checks

↓

Pull request quality gate

↓

Conformance evidence
```

A governance rule without enforcement SHALL be marked as:

- advisory
- planned
- manually enforced
- automatically enforced

Governance documentation SHALL NOT imply automated enforcement where none exists.

---

# 10. Ontology Traceability

Every ontology entity SHALL trace to:

- glossary term or domain authority
- owning domain
- related entity types
- permitted relationship types
- schemas using the entity
- Knowledge Objects instantiating the entity
- rules evaluating the entity

Recommended metadata:

```yaml
entity_id:
name:
defined_by:
semantic_owner:
related_terms:
used_by_schemas:
used_by_rules:
used_by_specs:
```

Ontology traceability SHALL distinguish between:

- semantic inheritance
- composition
- reference
- association
- lifecycle transition

---

# 11. Schema Traceability

Every schema SHALL trace backward to:

- ontology entities
- governing specification
- interface contract where applicable
- lifecycle policy
- security classification

Every schema SHALL trace forward to:

- artifacts validated
- APIs using the schema
- persistence adapters
- events
- tests
- migrations

Recommended schema metadata:

```yaml
schema_id:
version:
governing_spec:
ontology_entities:
consumers:
producers:
supersedes:
compatibility:
security_classification:
```

A schema field SHALL NOT exist without one of:

- semantic definition
- technical contract requirement
- lifecycle requirement
- security requirement
- compatibility requirement

---

# 12. Requirement Traceability

Every approved requirement SHALL include:

```yaml
id:
source:
owner:
scope:
status:
priority:
related_capability:
related_rules:
related_risks:
validated_by:
implemented_by:
evidence:
```

A requirement SHALL trace backward to one or more of:

- Product Specification
- stakeholder decision
- business process
- approved Knowledge Object
- regulatory source
- defect
- validated discovery evidence

A requirement SHALL trace forward to:

- acceptance criteria
- rules
- risks
- test strategy
- test cases
- implementation
- execution evidence
- defects

---

## 12.1 Requirement Types

Traceability SHALL distinguish:

- business requirement
- user requirement
- functional requirement
- non-functional requirement
- technical requirement
- security requirement
- compliance requirement
- data requirement
- operational requirement

Different requirement types MAY use different validation mechanisms.

---

## 12.2 Requirement Status

The lifecycle SHOULD support:

```text
Draft

↓

Pending Review

↓

Approved

↓

Implemented

↓

Verified

↓

Deprecated
```

A requirement SHALL NOT become `Verified` solely because implementation exists.

Verification requires qualifying evidence.

---

# 13. Business Rule Traceability

Every Business Rule SHALL trace backward to:

- requirement
- approved business policy
- Domain Expert decision
- authoritative Knowledge Object
- external regulation
- validated workflow behavior

Every Business Rule SHALL trace forward to:

- deterministic rule representation
- Rule Engine version
- test cases
- Product decisions
- generated explanations
- runtime decision evidence

Recommended metadata:

```yaml
rule_id:
semantic_owner:
source:
governing_requirement:
knowledge_dependencies:
rule_version:
implemented_by:
validated_by:
effective_from:
effective_to:
```

An LLM-generated Rule Candidate SHALL remain traceable to its evidence and validation decision.

---

# 14. Risk Traceability

Every risk SHALL trace backward to the artifact, observation, or change that introduced it.

Every risk SHALL trace forward to:

- severity
- likelihood
- impact
- mitigation
- owner
- test strategy
- validation evidence
- acceptance or closure decision

Recommended lifecycle:

```text
Identified

↓

Analyzed

↓

Mitigated, Accepted, Transferred, or Avoided

↓

Validated

↓

Closed
```

A risk SHALL NOT be closed without evidence or an explicit authorized acceptance decision.

---

# 15. Test Strategy Traceability

Every Test Strategy SHALL trace to:

- product scope
- requirements
- business rules
- risks
- architecture
- environments
- quality criteria
- release policy

It SHALL trace forward to:

- test levels
- test types
- coverage objectives
- test cases
- test data
- automation targets
- execution schedule
- reporting criteria

A Test Strategy SHALL explain why a validation approach was selected.

---

# 16. Test Case Traceability

Every Test Case SHALL include:

```yaml
id:
title:
source_requirements:
source_rules:
source_risks:
source_bugs:
preconditions:
test_data:
expected_results:
automation_status:
automation_assets:
execution_history:
owner:
status:
```

A Test Case MAY validate multiple requirements.

A requirement MAY be validated by multiple Test Cases.

The relationship SHALL preserve validation scope.

Example:

```yaml
relationship:
  source: TC-014
  type: validates
  target: REQ-021
  coverage:
    - acceptance_criterion_2
    - boundary_condition_maximum
```

A binary relationship without coverage detail MAY be insufficient for complex requirements.

---

# 17. Coverage Traceability

Coverage SHALL be measured against authoritative targets.

Possible coverage dimensions include:

- requirement coverage
- acceptance-criteria coverage
- business-rule coverage
- risk coverage
- interface-contract coverage
- browser or platform coverage
- data-partition coverage
- state-transition coverage
- workflow coverage
- defect-regression coverage
- architecture-invariant coverage

Coverage SHALL NOT be represented solely as the number of Test Cases.

Coverage quality depends on:

- relevance
- completeness
- independence
- boundary representation
- evidence quality
- execution recency
- environment relevance

---

## 17.1 Requirement Coverage States

A requirement MAY be classified as:

```text
Not Covered

Partially Covered

Covered

Executed

Passed

Failed

Blocked

Not Testable

Accepted Without Test
```

`Covered` does not mean `Passed`.

`Passed` SHALL require qualifying execution evidence.

---

# 18. Automation Traceability

Every Automation Asset SHALL trace backward to:

- Test Case
- automation rule
- execution interface
- locator or API knowledge
- required test data
- environment assumptions

It SHALL trace forward to:

- versioned execution runs
- evidence
- results
- failures
- maintenance history

Recommended metadata:

```yaml
automation_id:
implements_test_cases:
framework_interface:
adapter:
source_version:
knowledge_dependencies:
data_dependencies:
environment_requirements:
executions:
owner:
status:
```

Automation source code SHALL NOT be the only repository of Test Case intent.

---

# 19. Locator Traceability

Every locator used for UI automation SHOULD trace to:

- Semantic UI entity
- screen
- feature
- discovery evidence
- locator strategy
- confidence
- validation history
- fallback strategies
- automation assets consuming it

Preferred chain:

```text
Semantic UI Element

↓

Locator Knowledge Object

↓

Automation Step

↓

Execution Evidence
```

Invalid primary chain:

```text
CSS Selector

↓

Business Requirement
```

Selectors are implementation evidence, not business meaning.

---

# 20. Execution Traceability

Every Execution Run SHALL include:

```yaml
execution_id:
execution_plan:
workspace:
environment:
started_at:
completed_at:
trigger:
executed_by:
engine:
engine_version:
adapter:
adapter_version:
source_revision:
configuration_version:
test_assets:
test_data:
knowledge_snapshot:
rule_versions:
evidence:
results:
```

The platform SHALL be able to reconstruct:

- what was executed
- why it was executed
- which versions were used
- where it was executed
- which knowledge and rules influenced execution
- what evidence was collected
- how the outcome was determined

---

## 20.1 Knowledge Snapshot Traceability

When execution depends on mutable knowledge, the execution SHALL record:

- Knowledge Object identifiers
- versions
- effective scope
- resolution outcome
- conflict state
- retrieval timestamp

This prevents future knowledge changes from altering the interpretation of historical runs.

---

## 20.2 Rule Version Traceability

Every deterministic decision affecting execution or evaluation SHALL preserve:

- rule identifier
- rule version
- input
- output
- resolution path
- applicable overrides
- evaluation timestamp

---

# 21. Evidence Traceability

Evidence SHALL trace to its producer and the claim it supports.

Evidence types include:

- DOM snapshot
- Semantic UI snapshot
- screenshot
- video
- trace
- console log
- network log
- API request
- API response
- database observation through an authorized interface
- source-code revision
- environment metadata
- user confirmation
- external document
- execution log
- generated explanation

Every evidence artifact SHOULD include:

```yaml
evidence_id:
type:
produced_by:
produced_at:
workspace:
environment:
source:
supports:
integrity:
retention:
security_classification:
```

Evidence SHALL NOT be treated as knowledge automatically.

---

## 21.1 Evidence Integrity

Where risk justifies it, evidence SHOULD preserve:

- checksum
- immutable storage reference
- creation timestamp
- collector version
- access history
- redaction status
- chain of custody

---

## 21.2 Evidence Quality

Evidence quality MAY consider:

- directness
- recency
- completeness
- reliability
- independence
- reproducibility
- authenticity
- scope relevance

Confidence SHALL NOT replace evidence quality.

---

# 22. Result Traceability

An Execution Result SHALL trace to:

- expected behavior
- actual observation
- evidence
- comparison method
- result classifier
- rule version
- execution run
- environment
- Test Case

The normalized result lifecycle may include:

```text
Passed

Failed

Blocked

Skipped

Inconclusive

Error

Cancelled
```

A result of `Failed` SHALL distinguish:

- product failure
- automation failure
- environment failure
- test-data failure
- dependency failure
- unresolved classification

---

# 23. Bug Traceability

Every Bug SHALL trace backward to:

- failed requirement, rule, expectation, or quality criterion
- execution result
- evidence
- affected environment
- affected version
- discovery source

Every Bug SHALL trace forward to:

- triage decision
- severity and priority
- root cause
- affected components
- fix
- source-code change
- regression Test Case
- verification execution
- release

Recommended metadata:

```yaml
bug_id:
reported_from:
failed_expectations:
evidence:
affected_requirements:
affected_rules:
affected_components:
root_cause:
fixed_by:
regression_tests:
verified_by:
status:
owner:
```

A Bug SHALL NOT be closed only because a code change was merged.

Closure requires verification evidence or an explicitly authorized alternate disposition.

---

# 24. Root-Cause Traceability

Root-cause analysis SHALL distinguish:

- symptom
- immediate cause
- contributing factors
- systemic cause
- missing control
- escaped validation
- affected knowledge
- affected process

A root-cause record SHOULD trace to:

- incident or Bug
- evidence
- component
- requirement
- missing or failed test
- corrective action
- preventive action
- governance improvement where applicable

---

# 25. Fix and Regression Traceability

Every fix SHALL trace to:

- defect or approved change
- affected specification
- affected component
- source revision
- test updates
- migration where applicable

Every regression Test Case SHALL trace to the defect it prevents.

Preferred chain:

```text
BUG-041

↓

Fix Commit or Change Set

↓

TC-212 Regression Test

↓

Execution Run

↓

Verification Evidence

↓

Bug Closed
```

---

# 26. Reporting Traceability

Every report SHALL identify its source data and generation period.

Reports SHOULD trace to:

- execution runs
- results
- defects
- risks
- coverage records
- release
- Workspace
- query or aggregation version

Generated metrics SHALL preserve:

- formula or rule
- source records
- filtering
- timeframe
- exclusions
- aggregation method
- generation timestamp

A report SHALL NOT present an inferred conclusion as directly observed fact without labeling the inference.

---

# 27. Learning Traceability

The controlled learning chain is:

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

Confidence Assessment

↓

Validation

↓

Approval

↓

Knowledge Object

↓

Future Retrieval

↓

Future Decision
```

Every transition SHALL be traceable.

---

## 27.1 Observation Traceability

An Observation SHALL identify:

- source
- collector
- timestamp
- Workspace
- context
- evidence
- confidence if inferred
- related task or execution

An Observation is not authoritative knowledge.

---

## 27.2 Knowledge Candidate Traceability

A Knowledge Candidate SHALL trace to:

- one or more observations
- evidence
- candidate producer
- classification method
- proposed scope
- proposed ontology type
- normalization history
- detected conflicts

---

## 27.3 Validation Decision Traceability

A validation decision SHALL record:

```yaml
decision_id:
candidate_id:
decision:
validator:
authority:
reason:
evidence_reviewed:
policy_applied:
decided_at:
```

Possible decisions include:

- approve
- reject
- request clarification
- merge with existing
- supersede existing
- lower scope
- raise scope
- defer
- deprecate related knowledge

---

## 27.4 Knowledge Usage Traceability

When a Knowledge Object influences reasoning or execution, the system SHOULD record:

- Knowledge Object ID
- version
- scope
- retrieval rank
- relationship to task
- resolution decision
- whether it was applied or ignored
- reason

This enables explanations such as:

> This validation rule was applied because KO-145, version 3, was the highest-authority approved rule in the project scope.

---

# 28. AI Reasoning Traceability

AI-supported decisions SHALL preserve an explainable decision record without requiring private chain-of-thought storage.

The system SHOULD record:

- task
- authorized context sources
- retrieved Knowledge Objects
- applied deterministic rules
- model provider
- model identifier
- prompt-template version
- structured input version
- structured output
- confidence
- validation result
- governance action
- final decision
- evidence references

The system SHALL NOT require storage of unrestricted internal reasoning text.

Traceability SHALL focus on:

- inputs
- sources
- rules
- outputs
- validation
- decision outcomes

---

## 28.1 AI Artifact Traceability

Every AI-generated artifact SHALL record:

```yaml
generated_by:
model_provider:
model_id:
generation_time:
prompt_template:
input_artifacts:
knowledge_context:
rule_context:
validation_status:
approved_by:
```

After human or policy approval, the authoritative artifact owner becomes accountable for the accepted content.

Generation provenance SHALL remain preserved.

---

# 29. Prompt Traceability

Prompts are implementation assets, not sources of truth.

Every governed prompt template SHOULD trace to:

- capability
- input schema
- output schema
- evaluation suite
- AI governance policy
- owner
- version

Prompts SHALL NOT be the sole location of:

- business rules
- product requirements
- ontology
- security policy
- approval logic

When prompt behavior reflects a deterministic rule, the prompt SHALL reference the Rule Engine output rather than duplicate the rule text as hidden authority.

---

# 30. Interface Traceability

Every interface SHALL trace backward to:

- architecture boundary
- Product, Knowledge, or Runtime capability
- ontology and schemas
- security policy

It SHALL trace forward to:

- provider implementations
- consumers
- contract tests
- versions
- migrations
- runtime telemetry

Recommended metadata:

```yaml
interface_id:
owner:
governing_specs:
schemas:
providers:
consumers:
contract_tests:
versions:
deprecations:
```

---

# 31. Component Traceability

Every component SHALL trace backward to:

- Component Specification
- Architecture Specification
- governing ADR
- owned capability
- consumed interfaces

It SHALL trace forward to:

- source modules
- tests
- deployment units
- telemetry
- incidents
- releases

A component SHALL NOT exist merely because a source directory exists.

---

# 32. Plugin Traceability

Every plugin SHALL trace backward to:

- Plugin Interface
- capability declaration
- approved integration need
- security classification

It SHALL trace forward to:

- vendor SDK versions
- configuration schema
- contract tests
- integration tests
- runtime registrations
- execution evidence
- compatibility records

Recommended chain:

```text
Product Capability

↓

Platform Interface

↓

Plugin Contract

↓

Plugin Implementation

↓

External Technology

↓

Normalized Result
```

---

# 33. Workspace Traceability

Every project-scoped artifact SHALL identify its Workspace.

Workspace traceability SHALL apply to:

- requirements
- Knowledge Objects
- rules
- Semantic UI
- test assets
- automation
- executions
- evidence
- bugs
- reports
- credentials references
- configuration

A project-scoped artifact without Workspace identity SHALL be rejected unless explicitly defined as global or organization-scoped.

---

# 34. Scope Traceability

Every scoped artifact SHALL declare:

```yaml
scope_type:
scope_id:
parent_scope:
inheritance:
override_policy:
```

Traceability SHALL preserve scope resolution.

Example:

```text
Global Rule KO-001

↓

Organization Override KO-082

↓

Project Override KO-193

↓

Resolved Rule for Execution EXE-451
```

The resolution record SHALL explain:

- considered objects
- precedence
- conflicts
- selected object
- ignored objects
- policy applied

---

# 35. Version Traceability

Every versioned artifact SHALL preserve:

- artifact ID
- version
- previous version
- change reason
- author
- approver
- effective date
- affected dependents
- migration status
- release association

Historical executions SHALL continue to reference the versions used at execution time.

Version traceability SHALL not be reconstructed only from mutable current files.

---

# 36. Change Traceability

Every governed change SHOULD include:

```yaml
change_id:
requested_by:
reason:
affected_artifacts:
owners:
approvers:
risks:
breaking:
migration:
implementation:
tests:
release:
evidence:
```

The complete change chain is:

```text
Change Request

↓

Impact Analysis

↓

Decision

↓

Artifact Updates

↓

Implementation

↓

Validation

↓

Approval

↓

Release

↓

Operational Evidence
```

Emergency changes SHALL be backfilled into this chain after stabilization.

---

# 37. Release Traceability

Every release SHALL trace to:

- included changes
- artifact versions
- source revision
- migrations
- interface versions
- schema versions
- rule versions
- plugin versions
- tests
- security review
- quality gates
- approval
- deployment evidence

Recommended release record:

```yaml
release_id:
version:
changes:
artifacts:
source_revision:
schemas:
rules:
plugins:
migrations:
quality_gates:
approvals:
deployed_environments:
evidence:
```

---

# 38. External Source Traceability

When an artifact derives from an external source, record:

- source name
- source type
- source version
- retrieval date
- effective date
- authoritative status
- license or usage constraints where applicable
- retained evidence
- transformation
- validator

External sources include:

- regulations
- standards
- API documentation
- vendor documentation
- project repositories
- issue trackers
- design files
- user-provided documents
- discovered applications

A URL alone MAY be insufficient as durable provenance.

---

# 39. User Decision Traceability

When a user answers a question or makes a decision, the response SHALL initially be treated as evidence.

A user decision record SHOULD include:

```yaml
decision_id:
question:
answer:
user_or_role:
authority:
scope:
context:
recorded_at:
affected_artifacts:
persistence_decision:
```

A user answer SHALL become authoritative knowledge only after applying the relevant knowledge governance policy.

Temporary instructions SHALL remain session context.

---

# 40. Traceability Relationship Types

The canonical relationship vocabulary SHOULD include the following.

## 40.1 Authority Relationships

```text
governed_by
constrained_by
authorized_by
approved_by
owned_by
```

---

## 40.2 Derivation Relationships

```text
derived_from
generated_from
learned_from
normalized_from
inferred_from
```

---

## 40.3 Definition Relationships

```text
defines
defined_by
classifies
instantiates
represented_by
validated_by_schema
```

---

## 40.4 Implementation Relationships

```text
implements
implemented_by
exposes
provided_by
consumes
depends_on
```

---

## 40.5 Validation Relationships

```text
validates
validated_by
verifies
verified_by
covers
tested_by
```

---

## 40.6 Execution Relationships

```text
executes
executed_by
produces
produced_by
uses_data
uses_environment
```

---

## 40.7 Evidence Relationships

```text
evidenced_by
supports
contradicts
observed_in
captured_by
```

---

## 40.8 Defect Relationships

```text
fails
failed_by
caused_by
fixed_by
regressed_by
prevents_regression_of
```

---

## 40.9 Lifecycle Relationships

```text
supersedes
superseded_by
replaces
deprecated_by
merged_into
split_into
version_of
```

---

## 40.10 Scope Relationships

```text
belongs_to_workspace
scoped_to
inherits_from
overrides
resolved_from
```

---

# 41. Relationship Metadata

Every governed trace relationship SHOULD support:

```yaml
relationship_id:
type:
source:
target:
source_version:
target_version:
created_by:
created_at:
evidence:
confidence:
status:
scope:
valid_from:
valid_to:
```

`confidence` SHALL be used only where the relationship is inferred or provisional.

Approved deterministic relationships do not require probabilistic confidence.

---

# 42. Relationship Lifecycle

Trace relationships MAY have the following states:

```text
Proposed

Pending Validation

Approved

Rejected

Deprecated

Archived
```

Inferred relationships SHALL NOT silently become approved.

Relationship deletion SHOULD be avoided when historical audit requires retention.

Use lifecycle status and validity dates instead.

---

# 43. Traceability Cardinality

Common cardinalities include:

| Relationship | Typical Cardinality |
|---|---|
| Vision to Product Principles | One-to-many |
| ADR to Specifications | One-to-many or many-to-many |
| Requirement to Test Cases | Many-to-many |
| Business Rule to Requirements | Many-to-many |
| Test Case to Automation Assets | One-to-many or many-to-many |
| Automation Asset to Executions | One-to-many |
| Execution to Evidence | One-to-many |
| Failed Result to Bugs | One-to-many or many-to-many |
| Bug to Fixes | One-to-many |
| Observation to Knowledge Candidates | One-to-many |
| Knowledge Candidate to Knowledge Object | Many-to-one, one-to-one, or rejected |
| Knowledge Object to Future Decisions | One-to-many |

Cardinality SHALL be modeled explicitly where it affects lifecycle or deletion behavior.

---

# 44. Minimum Traceability Requirements by Artifact

| Artifact | Minimum Required Relationships |
|---|---|
| ADR | `constrained_by` Foundation; `governs` downstream artifact |
| Specification | `governed_by` Foundation or ADR; `owned_by` owner |
| Ontology Entity | `defined_by` source; `used_by` schema or specification |
| Schema | `represents` ontology; `governed_by` specification |
| Requirement | `derived_from` source; `owned_by`; `validated_by` |
| Business Rule | `derived_from`; `owned_by`; `implemented_by`; `tested_by` |
| Risk | `identified_from`; `owned_by`; `mitigated_by` |
| Test Case | `validates`; `owned_by` |
| Automation Asset | `implements` Test Case; `executed_by` engine |
| Execution | `executes` asset; `produces` evidence |
| Evidence | `produced_by`; `supports` claim or result |
| Bug | `failed_by` result; `evidenced_by`; `owned_by` |
| Knowledge Candidate | `derived_from` observation; `validated_by` decision |
| Knowledge Object | `approved_by`; `evidenced_by`; `scoped_to` |
| Release | `contains` changes; `approved_by`; `evidenced_by` deployment |

---

# 45. Traceability Completeness Rules

## 45.1 No Orphan Requirements

An approved requirement SHALL have:

- an authoritative source
- an owner
- a validation relationship

---

## 45.2 No Orphan Tests

A Test Case SHALL have at least one valid testing objective.

---

## 45.3 No Orphan Automation

An Automation Asset SHALL implement at least one Test Case or approved technical validation control.

---

## 45.4 No Orphan Bugs

A Bug SHALL identify an unmet expectation, evidence, or approved exploratory finding.

---

## 45.5 No Orphan Knowledge

An approved Knowledge Object SHALL have provenance, evidence, scope, and approval.

---

## 45.6 No Orphan Components

A production component SHALL have a specification or accepted architectural justification.

---

## 45.7 No Orphan Rules

An active deterministic rule SHALL have a semantic owner and authoritative source.

---

# 46. Traceability Quality Levels

Traceability quality MAY be assessed using the following levels.

## Level 0 — Absent

Relationships are not recorded.

---

## Level 1 — Manual References

Artifacts contain informal links or text references.

Relationships may be incomplete or stale.

---

## Level 2 — Structured References

Artifacts use stable IDs and controlled relationship types.

Validation remains mostly manual.

---

## Level 3 — Validated Graph

Relationships are machine-readable.

Broken links, invalid types, and orphan artifacts are detected automatically.

---

## Level 4 — Lifecycle Integrated

Traceability participates in:

- impact analysis
- reviews
- quality gates
- execution
- defect workflows
- learning governance

---

## Level 5 — Intelligent Traceability

The platform can:

- recommend missing relationships
- detect suspicious coverage gaps
- explain decision chains
- evaluate change impact
- identify stale evidence
- suggest regression scope
- identify knowledge conflicts

AI recommendations at this level remain governed and explainable.

---

# 47. Machine-Readable Traceability Model

The repository SHOULD maintain:

```text
meta/REPOSITORY_GRAPH.yaml
```

and MAY maintain:

```text
meta/TRACEABILITY_GRAPH.yaml
```

Recommended structure:

```yaml
version: 1.0.0

nodes:
  - id:
    type:
    version:
    path:
    status:
    owner:
    scope:

relationships:
  - id:
    type:
    source:
    target:
    source_version:
    target_version:
    status:
    evidence:
    created_at:
```

The machine-readable graph SHALL use stable artifact identifiers.

Paths SHALL remain metadata rather than identity.

---

# 48. Traceability Indexes

The following indexes SHOULD contribute to the repository graph:

```text
meta/SPEC_INDEX.yaml

meta/ADR_INDEX.yaml

meta/SCHEMA_INDEX.yaml

meta/RULE_INDEX.yaml

meta/ONTOLOGY_INDEX.yaml

meta/PLAYBOOK_INDEX.yaml

meta/OWNERSHIP_INDEX.yaml
```

Additional recommended indexes:

```text
meta/REQUIREMENT_INDEX.yaml

meta/KNOWLEDGE_INDEX.yaml

meta/INTERFACE_INDEX.yaml

meta/COMPONENT_INDEX.yaml

meta/PLUGIN_INDEX.yaml

meta/TEST_ASSET_INDEX.yaml
```

Indexes are derived.

The source artifact remains authoritative.

---

# 49. Traceability Validation

Automated validation SHOULD detect:

- broken artifact references
- unknown identifiers
- invalid relationship types
- invalid source or target type combinations
- missing required relationships
- version mismatches
- references to rejected artifacts
- references to expired knowledge
- orphan requirements
- orphan tests
- orphan automation
- orphan rules
- orphan components
- Bugs without evidence
- accepted Knowledge Objects without validation
- execution results without evidence
- releases without quality-gate evidence
- cross-Workspace relationships without authorization

Suggested test locations:

```text
tests/governance/test_traceability_links.*

tests/governance/test_relationship_types.*

tests/governance/test_orphan_artifacts.*

tests/governance/test_version_traceability.*

tests/governance/test_scope_traceability.*

tests/governance/test_release_traceability.*
```

---

# 50. Relationship Validation Rules

A relationship is valid only when:

1. the source exists
2. the target exists
3. both artifact versions are resolvable
4. the relationship type is permitted
5. the source is authorized to create the relationship
6. scope rules are satisfied
7. lifecycle states are compatible
8. evidence exists when required
9. no prohibited dependency is introduced
10. ownership is identifiable

---

# 51. Cross-Workspace Traceability

Cross-Workspace traceability is prohibited by default for private artifacts.

A cross-Workspace relationship requires:

- explicit authorization
- permitted relationship type
- security review where sensitive
- source and target Workspace identifiers
- reason
- visibility policy
- retention policy
- audit record

Global and organization-scoped artifacts MAY be referenced according to their access policy.

A reference to a broader-scope artifact SHALL NOT expose private evidence from another scope.

---

# 52. Security and Privacy Traceability

Traceability SHALL preserve enough information for audit without exposing unnecessary sensitive data.

Traceability records SHOULD use:

- credential references instead of values
- redacted evidence references
- security classifications
- access-controlled artifact locations
- pseudonymous identities where appropriate
- retention policies

Sensitive traceability relationships SHALL inherit appropriate access restrictions.

A trace graph SHALL NOT become an uncontrolled index of restricted information.

---

# 53. Retention and Archival

Traceability retention SHALL align with:

- artifact lifecycle
- evidence policy
- audit requirements
- security policy
- Workspace retention
- legal requirements
- release support policy

When an artifact is archived:

- its stable ID remains reserved
- historical relationships remain resolvable
- active consumers are migrated or flagged
- current indexes identify archival status
- evidence retention is handled according to policy

---

# 54. Traceability During Deletion

Hard deletion of traceable authoritative artifacts SHOULD be avoided.

Where deletion is required:

1. identify all incoming relationships
2. identify all outgoing relationships
3. assess retention obligations
4. preserve a tombstone record where permitted
5. update consumers
6. update indexes
7. record deletion authority
8. validate that no active artifact becomes silently orphaned

Recommended tombstone:

```yaml
id:
type:
status: deleted
deleted_at:
deleted_by:
authority:
reason:
replacement:
retained_relationships:
```

---

# 55. Traceability During Split and Merge

## 55.1 Artifact Split

When one artifact becomes multiple artifacts:

```text
Original Artifact

↓

Split Decision

↓

New Artifact A

New Artifact B
```

The original SHALL trace to all replacements.

Consumers SHALL be migrated to the appropriate replacement.

---

## 55.2 Artifact Merge

When multiple artifacts become one:

```text
Artifact A

Artifact B

↓

Merged Artifact
```

The merged artifact SHALL preserve the origins and histories of both sources.

---

# 56. Traceability and Impact Analysis

Traceability SHALL support impact analysis queries such as:

- Which requirements are affected by this business-rule change?
- Which Test Cases validate this requirement?
- Which automation assets use this locator?
- Which executions used this Knowledge Object version?
- Which interfaces depend on this schema?
- Which components implement this specification?
- Which Bugs are associated with this feature?
- Which reports include this metric?
- Which releases contain this component version?
- Which consumers depend on this deprecated interface?

The Change Impact Matrix SHALL use the trace graph as a primary source.

---

# 57. Traceability and Review

Reviewers SHALL verify:

- upstream authority
- downstream validation
- ownership
- version consistency
- scope consistency
- lifecycle compatibility
- evidence sufficiency
- dependency validity
- absence of orphan artifacts

A reviewer SHALL NOT approve an artifact only because its content appears reasonable.

The artifact must also fit the governed traceability chain.

---

# 58. Traceability and Quality Gates

Quality Gates SHOULD block acceptance when:

- an approved requirement lacks validation
- a Test Case lacks a source
- an Automation Asset lacks a Test Case
- a Bug lacks evidence
- a business rule lacks an owner
- an accepted Knowledge Object lacks provenance
- a breaking change lacks affected-consumer traceability
- a release lacks validation evidence
- an implementation component lacks governing specification
- a cross-Workspace relationship lacks authorization

Severity and exceptions SHALL be defined in `QUALITY_GATES.md`.

---

# 59. Traceability Exceptions

A traceability exception MAY be approved when:

- the relationship cannot yet be established
- the artifact is temporary
- a legacy migration is in progress
- the required source is unavailable
- immediate remediation would create disproportionate risk

An exception SHALL include:

```yaml
id:
artifact:
missing_relationship:
reason:
risk:
mitigation:
owner:
approved_by:
created_at:
expires_at:
resolution_plan:
```

An exception SHALL NOT be permanent by default.

Expired exceptions SHALL become active violations.

---

# 60. Traceability Violation Severity

## 60.1 Critical

Examples:

- execution cannot be associated with a Workspace
- destructive action lacks authorization trace
- Knowledge Object lacks source and approval
- credential exposure occurs through trace metadata
- security decision lacks accountable authority
- cross-Workspace evidence is exposed without authorization

Critical violations SHALL block merge, execution, or release as applicable.

---

## 60.2 High

Examples:

- business rule lacks authoritative source
- requirement lacks validation
- component lacks governing architecture
- Bug is closed without verification
- release lacks quality-gate evidence
- accepted AI-generated artifact lacks approval
- execution result lacks supporting evidence

High violations SHALL block acceptance.

---

## 60.3 Medium

Examples:

- relationship type is overly generic
- affected consumer is missing from a breaking change
- non-critical version relationship is incomplete
- archived references are not clearly marked
- evidence metadata is incomplete

Medium violations require correction or approved remediation.

---

## 60.4 Low

Examples:

- optional reverse relationship is missing
- documentation links use paths instead of stable IDs
- derived indexes are temporarily stale
- non-authoritative examples lack complete relationships

Low violations SHOULD be corrected during maintenance.

---

# 61. AI Agent Instructions

Before generating or modifying an artifact, an AI agent SHALL:

1. identify the artifact's authoritative source
2. identify its stable ID
3. identify its owner
4. identify required upstream relationships
5. identify expected downstream relationships
6. use controlled relationship types
7. preserve scope and version metadata
8. avoid treating inferred links as approved
9. report missing relationships
10. detect orphan risks
11. update traceability indexes when required
12. preserve generation provenance
13. avoid storing unrestricted private chain-of-thought
14. connect generated tests to requirements, rules, risks, or defects
15. connect learned knowledge to evidence and validation

An AI agent MUST NOT:

- invent authoritative sources
- fabricate evidence
- assign false coverage
- mark a requirement verified without evidence
- close a Bug without verification
- make an inferred relationship authoritative silently
- remove historical traceability
- link private artifacts across Workspaces without authorization
- use conversation history as authoritative provenance
- hide missing links with generic `related_to` relationships

---

# 62. Traceability Review Checklist

## Identity

```text
□ Every artifact has a stable identifier.

□ Versions are identifiable.

□ Paths are not used as primary identity.

□ Superseded and archived artifacts remain resolvable.
```

## Authority

```text
□ The upstream authoritative source is identified.

□ The artifact owner is identified.

□ Approval is traceable.

□ Inferred content is distinguished from approved content.
```

## Requirements and Rules

```text
□ Requirements trace to approved sources.

□ Requirements have validation relationships.

□ Business Rules have semantic owners.

□ Rule versions are traceable to runtime decisions.
```

## Tests and Automation

```text
□ Every Test Case has a valid objective.

□ Coverage identifies the target and scope.

□ Automation assets implement Test Cases or approved controls.

□ Executions identify exact asset versions.
```

## Evidence and Results

```text
□ Results trace to expectations and evidence.

□ Evidence identifies its producer.

□ Evidence quality is appropriate.

□ Historical runs preserve knowledge and rule versions.
```

## Defects

```text
□ Bugs trace to failed expectations or exploratory findings.

□ Fixes trace to Bugs.

□ Regression tests trace to fixed defects.

□ Closure is supported by verification evidence.
```

## Learning

```text
□ Observations remain distinct from knowledge.

□ Candidates preserve provenance.

□ Validation decisions are recorded.

□ Knowledge usage is explainable.
```

## Scope and Security

```text
□ Workspace scope is explicit.

□ Cross-Workspace relationships are authorized.

□ Sensitive evidence is access-controlled.

□ Credentials are referenced, not exposed.
```

## Change and Release

```text
□ Breaking changes identify affected consumers.

□ Migrations are traceable.

□ Releases identify included artifact versions.

□ Required quality-gate evidence exists.
```

---

# 63. Definition of Done

## 63.1 Draft Baseline Traceability Registry

| Authority | Primary realization | Evidence path |
|---|---|---|
| ADR-001 | SPEC-102, SPEC-103, SPEC-401, SPEC-501 | knowledge version → retrieval → consumer evidence |
| ADR-002 | SPEC-104, SPEC-203, SPEC-301, SPEC-308, SPEC-502 | fact → rule trace → bounded AI if unresolved |
| ADR-003 | SPEC-201, SPEC-207, SPEC-302, SPEC-303, SPEC-407 | capture → sanitized evidence → semantic UI → test binding |
| ADR-004 | SPEC-101, SPEC-303, SPEC-307, SPEC-408 | entity/relationship → graph projection → impact path |
| ADR-005 | SPEC-102, SPEC-105, SPEC-403 | observation → candidate → review → Knowledge Object |
| ADR-006 | SPEC-201, SPEC-301, SPEC-308, SPEC-409 | task → retrieval → discovery → minimal question |
| ADR-007 | SPEC-209, SPEC-305, SPEC-405, SPEC-407, SPEC-409, SPEC-503 | core contract → adapter → provider evidence |
| ADR-008 | SPEC-306, SPEC-406, SPEC-506, SPEC-601–605 | actor → Workspace context → scoped operation/evidence |
| ADR-009 | SPEC-210, SPEC-404, SPEC-504, SPEC-601–605 | TestCase → asset → engine → attempt → result |
| ADR-010 | SPEC-105, SPEC-211, SPEC-308, SPEC-605 | outcome → observation → proposal → governed validation |

The product evidence chain is Discovery Evidence → Requirement → Business Rule and Risk → Test Strategy → Test Case and Test Data → Automation Asset → Execution and Evidence → Defect or Report → Knowledge Candidate.

Every relationship SHALL be machine-readable in `meta/REPOSITORY_GRAPH.yaml` before the affected specification can leave `draft`.

---

This document is complete when:

- canonical traceability principles are defined
- forward and backward traceability are defined
- all major artifact layers are covered
- relationship types are controlled
- minimum relationship requirements are established
- requirement, rule, risk, Test Case, automation, execution, evidence, Bug, and learning traceability are defined
- scope and Workspace traceability are defined
- version and lifecycle traceability are defined
- AI reasoning and generation provenance are defined
- machine-readable traceability expectations are defined
- validation and violation handling are defined
- review and quality-gate integration are defined

Traceability implementation is complete when:

- stable IDs exist for all governed artifacts
- machine-readable relationships are maintained
- forward and backward queries are supported
- orphan artifacts are detected
- broken references are detected
- invalid relationship types are rejected
- execution snapshots preserve versions
- accepted knowledge preserves provenance
- Bugs preserve verification history
- releases preserve change and validation evidence
- traceability violations block acceptance according to severity

---

# 64. Summary

QA Intelligence SHALL preserve the following continuous traceability chain:

```text
Why

↓

Decision

↓

Meaning

↓

Requirement

↓

Rule

↓

Risk

↓

Strategy

↓

Test

↓

Automation

↓

Execution

↓

Evidence

↓

Result

↓

Defect or Report

↓

Learning

↓

Future Decision
```

Every artifact SHALL explain:

- where it came from
- who owns it
- what it affects
- how it is validated
- which version applies
- which scope applies
- which evidence supports it
- what happened after it changed

Foundation gives intent.

ADRs give rationale.

Specifications give contracts.

Ontology gives meaning.

Schemas give structure.

Knowledge gives reusable truth.

Rules give deterministic decisions.

Requirements give expectations.

Tests give validation.

Execution gives observation.

Evidence gives support.

Bugs give failure records.

Reports give communication.

Learning gives controlled improvement.

Traceability that cannot be queried, validated, and explained is not complete traceability.
