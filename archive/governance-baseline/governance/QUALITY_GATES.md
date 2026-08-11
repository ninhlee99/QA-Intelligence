---
id: GOV-009
title: Quality Gates
version: 1.0.0
status: accepted
accountable_owner: Engineering Governance
owner:
  - Engineering Governance
  - Quality Engineering
approvers:
  - Architecture
  - Product Governance
consulted:
  - AI Governance
  - Knowledge Governance
  - Security
  - Platform Engineering
  - Operations
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
  - GOV-008
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

# Quality Gates

## 1. Purpose

This document defines the canonical quality-gate system for the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- convert governance obligations into enforceable acceptance decisions
- prevent incomplete, unsafe, or untraceable changes from progressing
- establish consistent entry and exit criteria for every lifecycle stage
- define evidence required to prove quality
- distinguish advisory checks from blocking controls
- route failures to accountable owners
- support human, automated, and AI-assisted evaluation
- preserve Workspace isolation, security, and architectural boundaries
- make exceptions explicit, temporary, owned, and auditable
- enable progressive quality maturity without weakening mandatory controls

This document applies to:

- repository artifacts
- specifications and ADRs
- ontology, schemas, rules, and knowledge
- product requirements and risks
- components, interfaces, and plugins
- source code and configuration
- tests and automation assets
- data and migrations
- AI prompts, models, evaluations, and generated artifacts
- runtime executions and evidence
- releases, deployments, and operations

A quality gate is a decision control.

It SHALL answer:

- what is being evaluated
- which policy authorizes the evaluation
- which checks are required
- which evidence was inspected
- which threshold applies
- who owns the result
- whether progression is allowed
- what must happen when the gate fails

Passing a gate without retained evidence is not a valid pass.

---

# 2. Quality Gate Philosophy

Quality SHALL be established progressively from intent to operation.

The canonical sequence is:

```text
Authoritative Intent

↓

Governed Design

↓

Traceable Implementation

↓

Verified Behavior

↓

Controlled Release

↓

Observed Operation

↓

Evidence-Based Learning
```

Each transition requires an explicit gate.

A downstream pass SHALL NOT compensate for an upstream failure.

Examples:

- passing tests do not authorize an unapproved requirement
- successful deployment does not excuse a breaking schema change
- high model confidence does not replace source evidence
- reviewer approval does not override a critical security failure
- runtime success does not validate cross-Workspace data access

Quality gates protect both correctness and legitimacy.

---

# 3. Normative Language

The terms SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are normative.

- SHALL indicates a mandatory requirement
- SHALL NOT indicates a prohibited condition
- SHOULD indicates a recommended default requiring justification when omitted
- SHOULD NOT indicates a discouraged practice requiring justification when used
- MAY indicates a permitted option

Automated enforcement SHALL preserve the meaning of these terms.

---

# 4. Gate Principles

## 4.1 Authority Before Implementation

Every implementation gate SHALL verify that authoritative intent exists and is accepted at the required maturity level.

## 4.2 Evidence Before Acceptance

Every pass SHALL reference reproducible or independently reviewable evidence.

## 4.3 Meaning Before Syntax

Semantic correctness SHALL be evaluated before structural validity.

A valid schema can still encode an invalid concept.

## 4.4 Rules Before Probabilistic Judgment

Deterministic rules SHALL be evaluated before LLM-assisted judgment where deterministic evaluation is possible.

## 4.5 Risk-Proportional Rigor

Higher-risk changes SHALL require stronger evidence, broader review, and stricter approval.

## 4.6 No Silent Bypass

No mandatory gate may be disabled, ignored, or converted to advisory without an approved exception.

## 4.7 Independent Critical Controls

Critical security, Workspace isolation, data integrity, and governance controls SHALL fail independently.

Aggregate scores SHALL NOT hide a critical failure.

## 4.8 Reproducibility

Gate inputs, policy versions, tools, configurations, and results SHALL be identifiable.

## 4.9 Ownership

Every gate SHALL have one accountable owner, even when multiple systems or reviewers contribute checks.

## 4.10 Explainability

Every failure SHALL identify the violated requirement, affected artifact, evidence, severity, and remediation path.

---

# 5. Gate Model

The canonical gate model contains:

| Field | Requirement |
|---|---|
| Gate ID | Stable unique identifier |
| Name | Human-readable purpose |
| Stage | Lifecycle transition protected |
| Scope | Artifacts and changes evaluated |
| Authority | Governing specifications, ADRs, or policies |
| Owner | Accountable decision owner |
| Checks | Required evaluations |
| Inputs | Artifacts, metadata, and context |
| Thresholds | Explicit pass conditions |
| Evidence | Retained proof of evaluation |
| Severity | Consequence of failure |
| Outcome | Pass, conditional pass, fail, blocked, or not applicable |
| Remediation | Required corrective action |
| Exception Policy | Whether and how exception is permitted |
| Validity | Time or artifact version for which the result remains valid |

Gate definitions SHALL be versioned.

Changing a gate definition SHALL trigger impact analysis under GOV-007.

---

# 6. Gate Outcomes

## 6.1 Pass

All mandatory checks pass and all required evidence is retained.

Progression is allowed.

## 6.2 Conditional Pass

A conditional pass MAY be used only when:

- no critical or high-severity requirement is violated
- remaining conditions are explicit and time-bounded
- an accountable owner accepts the condition
- follow-up work is traceable
- the next stage does not make remediation impractical

## 6.3 Fail

One or more blocking checks fail.

Progression is prohibited until remediation and re-evaluation.

## 6.4 Blocked

The gate cannot reach a trustworthy decision because required inputs, environments, owners, or evidence are unavailable.

Blocked SHALL NOT be reported as pass.

## 6.5 Not Applicable

Not applicable requires a recorded scope reason and approving authority.

Absence of a check result SHALL NOT imply not applicable.

---

# 7. Gate Classes

## 7.1 Preventive Gates

Prevent invalid work from entering a lifecycle stage.

Examples:

- design readiness
- implementation readiness
- release readiness

## 7.2 Detective Gates

Detect defects or violations after work exists but before irreversible progression.

Examples:

- static analysis
- test execution
- traceability validation

## 7.3 Runtime Gates

Evaluate live or staged behavior.

Examples:

- health checks
- policy enforcement
- deployment verification

## 7.4 Learning Gates

Control whether observed outcomes may become governed knowledge or rules.

Examples:

- Knowledge Candidate promotion
- rule calibration approval
- model evaluation acceptance

---

# 8. Lifecycle Gate Map

| Gate ID | Gate | Protected Transition | Accountable Owner |
|---|---|---|---|
| QG-01 | Intake Readiness | Idea → Governed work | Product Governance |
| QG-02 | Design Readiness | Governed work → Design | Architecture |
| QG-03 | Implementation Readiness | Design → Implementation | Engineering Governance |
| QG-04 | Change Acceptance | Implementation → Merge/acceptance | Quality Engineering |
| QG-05 | Release Readiness | Accepted change → Release | Release Owner |
| QG-06 | Deployment Readiness | Release → Environment | Platform Engineering |
| QG-07 | Operational Acceptance | Deployment → Service | Operations |
| QG-08 | Knowledge Promotion | Candidate → Governed knowledge | Knowledge Governance |
| QG-09 | AI Change Acceptance | AI change → Approved use | AI Governance |
| QG-10 | Retirement Readiness | Active artifact → Retired | Artifact Owner |

All applicable gates SHALL pass in dependency order.

---

# 9. QG-01 Intake Readiness

QG-01 verifies that proposed work is legitimate, owned, and sufficiently understood.

Required checks:

- problem or opportunity is stated
- affected capability is identified
- accountable owner is assigned
- authoritative source is identified or planned
- initial scope and exclusions are documented
- risk hypothesis exists
- affected Workspaces and consumers are considered
- security, privacy, AI, and data relevance are classified
- duplicate or superseded work has been checked
- success criteria are measurable

Required evidence:

- intake record
- owner assignment
- scope statement
- initial traceability links
- risk classification

QG-01 SHALL fail when work has no accountable owner or cannot identify its governing intent.

---

# 10. QG-02 Design Readiness

QG-02 verifies that design is authorized and architecture is coherent.

Required checks:

- relevant foundation specifications were reviewed
- ADR requirements are satisfied
- new architectural decisions have an ADR when required
- dependency direction is valid
- component and interface ownership are clear
- ontology and terminology use canonical definitions
- alternative designs and consequences are recorded
- security and threat considerations are addressed
- Workspace isolation is preserved
- failure modes and operational responsibilities are defined
- compatibility and migration needs are known
- validation strategy exists

Required evidence:

- accepted design artifact
- ADR links
- dependency and impact analysis
- reviewer decisions
- risk and validation plan

QG-02 SHALL fail when implementation would establish an undocumented architectural decision.

---

# 11. QG-03 Implementation Readiness

QG-03 verifies that approved design can be implemented without guessing governing behavior.

Required checks:

- requirements are testable
- acceptance criteria are unambiguous
- traceability from requirement to design exists
- schemas and interfaces are defined or versioned
- business rules are explicit
- data ownership and classification are known
- migration and rollback plans exist where applicable
- test strategy covers functional and non-functional risks
- observability requirements are defined
- feature rollout and compatibility strategy are defined
- prohibited implementation shortcuts are identified
- required reviewers are assigned

Required evidence:

- approved requirements
- test strategy
- interface or schema contracts
- change-impact record
- implementation plan

QG-03 SHALL fail when developers or AI agents must invent business rules to proceed.

---

# 12. QG-04 Change Acceptance

QG-04 verifies that a completed change is correct, compliant, tested, and reviewable.

Required checks:

- implementation matches accepted intent
- change scope matches declared scope
- mandatory review under GOV-008 is complete
- traceability is bidirectional
- static and structural checks pass
- required tests pass in representative environments
- negative and failure-path tests exist where risk requires
- security and Workspace isolation checks pass
- schemas and interfaces satisfy compatibility policy
- migrations are validated
- AI-specific checks pass where applicable
- documentation and operational artifacts are updated
- no unresolved blocking review findings remain
- retained evidence identifies the evaluated revision

Required evidence:

- review record
- test results
- analysis results
- coverage relevant to changed risk
- migration evidence
- traceability report
- artifact identity or revision

QG-04 SHALL fail on any critical violation regardless of aggregate quality score.

---

# 13. QG-05 Release Readiness

QG-05 verifies that accepted changes form a coherent, deployable, and supportable release.

Required checks:

- release scope is frozen and identified
- every included change passed QG-04
- known risks and limitations are documented
- compatibility is verified across supported consumers
- deployment, migration, and rollback plans are executable
- release-level regression passes
- security and compliance approval is current
- operational dashboards and alerts are ready
- support and incident ownership are assigned
- release notes describe user-visible and breaking changes
- staged rollout criteria are defined
- rollback triggers are measurable

Required evidence:

- release manifest
- release test report
- approval record
- deployment and rollback plan
- release notes
- risk acceptance records

QG-05 SHALL fail when any included artifact has an expired or invalidated gate result.

---

# 14. QG-06 Deployment Readiness

QG-06 verifies that a release can safely enter a target environment.

Required checks:

- target environment is identified
- configuration is validated without exposing secrets
- infrastructure and dependencies are ready
- deployment permissions satisfy separation of duties
- backups or recovery points exist where required
- migrations are ordered and reversible where feasible
- capacity and quotas are sufficient
- feature flags and rollout controls are configured
- pre-deployment health is known
- environment-specific compliance requirements pass
- abort and rollback procedures are available

Required evidence:

- deployment plan
- configuration validation
- environment readiness report
- authorization record
- recovery evidence

QG-06 is environment-specific and SHALL NOT be reused across materially different environments without re-evaluation.

---

# 15. QG-07 Operational Acceptance

QG-07 verifies that deployment produced an acceptable service state.

Required checks:

- deployment completed as intended
- health and readiness checks pass
- critical user journeys pass smoke validation
- data integrity is preserved
- Workspace isolation is verified
- telemetry is flowing
- alerts are active and correctly routed
- error rates, latency, and resource use are within limits
- no critical security signal is present
- rollout criteria are satisfied
- rollback window and decision owner remain active

Required evidence:

- deployment record
- health and smoke-test results
- telemetry snapshot
- migration verification
- operational owner acceptance

QG-07 SHALL fail when observability is unavailable for a change that requires runtime verification.

---

# 16. QG-08 Knowledge Promotion

QG-08 controls promotion of a Knowledge Candidate into authoritative knowledge.

Required checks:

- candidate provenance is preserved
- supporting evidence is sufficient and accessible
- source authority is classified
- claim scope and applicability are explicit
- conflicting knowledge was evaluated
- confidence is calibrated and not treated as authority
- Workspace boundaries are preserved
- sensitive information is excluded or governed
- owner and review date are assigned
- expiration or revalidation policy exists
- downstream impact is analyzed
- promotion is approved by Knowledge Governance

Required evidence:

- candidate record
- source references
- validation results
- conflict analysis
- approval record

Runtime observation SHALL NOT become authoritative knowledge automatically.

---

# 17. QG-09 AI Change Acceptance

QG-09 applies to changes involving prompts, models, providers, retrieval, tools, agent autonomy, evaluation data, or AI-generated decisions.

Required checks:

- AI use is necessary and proportionate
- deterministic alternatives were considered
- provider-specific behavior is isolated behind governed interfaces
- inputs, context, tools, and output contracts are defined
- prompt and model versions are identifiable
- evaluation set represents intended and adverse scenarios
- hallucination and unsupported-claim behavior is evaluated
- sensitive data handling is approved
- prompt injection and tool misuse risks are tested
- human oversight matches consequence level
- fallback and degraded modes exist
- output provenance and uncertainty are preserved
- cost, latency, and availability limits are acceptable
- monitoring detects material performance drift

Required evidence:

- AI impact assessment
- evaluation report
- safety and security test results
- model and prompt identity
- approval from AI Governance

An AI-generated artifact SHALL satisfy the same domain gates as a human-generated artifact.

---

# 18. QG-10 Retirement Readiness

QG-10 verifies that retirement does not create orphaned consumers, evidence, or obligations.

Required checks:

- replacement or end-of-life rationale is accepted
- incoming and outgoing traceability links are analyzed
- consumers and owners are notified
- data retention obligations are satisfied
- historical evidence remains interpretable
- migration is complete
- runtime usage is absent or explicitly accepted
- rollback or restoration period is defined
- documentation and indexes are updated
- identifiers are not improperly reused

Required evidence:

- deprecation record
- consumer migration report
- final impact analysis
- owner approval
- archival or disposal evidence

Retired artifacts SHALL remain traceable when historical decisions or executions depend on them.

---

# 19. Universal Mandatory Checks

Every gate SHALL evaluate the applicable subset of these controls:

## 19.1 Identity

- stable artifact identity exists
- version or revision is known
- lifecycle status is explicit
- evaluated content is immutable or content-addressed for the decision period

## 19.2 Authority

- governing source is identified
- authority is accepted and current
- no lower-level artifact overrides higher-level intent

## 19.3 Ownership

- accountable owner exists
- required approvers have authority
- separation of duties is preserved where required

## 19.4 Scope

- included and excluded behavior is explicit
- undeclared scope expansion is absent
- Workspace and consumer scope are known

## 19.5 Dependencies

- direct dependencies are declared
- transitive impact is evaluated
- prohibited dependency direction is absent

## 19.6 Traceability

- upstream and downstream links exist
- relationship types are meaningful
- no required artifact is orphaned

## 19.7 Evidence

- evidence is relevant, attributable, and retained
- evidence identifies time, artifact, environment, and evaluator
- evidence integrity is protected

## 19.8 Risk

- risk level is current
- controls match risk
- residual risk has an accountable acceptor

---

# 20. Artifact-Specific Gates

## 20.1 Specification Gate

A specification SHALL pass when:

- purpose, scope, and normative requirements are clear
- terminology is canonical
- ownership and dependencies are declared
- requirements are testable
- conflicts with foundation specifications are absent
- acceptance and change obligations are defined

## 20.2 ADR Gate

An ADR SHALL pass when:

- context and decision drivers are clear
- decision is explicit
- alternatives were considered
- consequences and reversibility are documented
- downstream obligations are traceable
- status accurately reflects authority

## 20.3 Ontology Gate

An ontology change SHALL pass when:

- concepts have stable meaning
- relationships and cardinality are justified
- naming is canonical
- ambiguity and duplication are resolved
- migrations preserve semantic history

## 20.4 Schema Gate

A schema SHALL pass when:

- it implements accepted semantics
- validation constraints are explicit
- versioning and compatibility are defined
- sensitive fields are classified
- examples and negative cases validate correctly

## 20.5 Rule Gate

A rule SHALL pass when:

- authority and owner are known
- inputs, outputs, priority, and scope are explicit
- logic is deterministic where required
- conflicts and precedence are resolved
- explainable outcomes are produced
- tests cover boundaries and exceptions

## 20.6 Interface Gate

An interface SHALL pass when:

- contract is complete and provider-independent where required
- errors and failure behavior are defined
- authentication and authorization are enforced
- compatibility and versioning are explicit
- consumers and ownership are traceable

## 20.7 Component Gate

A component SHALL pass when:

- responsibility is cohesive
- public interface is smaller than hidden complexity
- dependencies follow architecture
- operational and failure ownership are clear
- tests validate contracts rather than implementation accidents

## 20.8 Plugin Gate

A plugin SHALL pass when:

- it acts as an adapter rather than a policy owner
- provider-specific details do not leak into core semantics
- capabilities and permissions are least-privileged
- failure isolation and compatibility are tested
- discovery and registration are governed

## 20.9 Test Asset Gate

A test asset SHALL pass when:

- requirement and risk traceability exist
- preconditions, data, action, and expected result are explicit
- assertions validate meaningful outcomes
- independence and repeatability are sufficient
- flakiness is within policy
- evidence is captured without leaking protected data

## 20.10 Migration Gate

A migration SHALL pass when:

- source and target states are defined
- compatibility window is explicit
- representative data was tested
- integrity checks exist
- interruption and partial failure are handled
- rollback or forward-recovery is proven

---

# 21. Security Gate

Security checks SHALL include, as applicable:

- threat model currency
- authentication and authorization
- least privilege
- secret management
- encryption and transport protection
- input validation and output encoding
- dependency and supply-chain integrity
- audit logging
- data classification and retention
- vulnerability assessment
- abuse and denial-of-service resistance
- incident detection and response readiness

Critical exploitable vulnerabilities SHALL block progression.

Security exceptions require Security approval and SHALL NOT be granted solely by the delivery owner.

---

# 22. Workspace Isolation Gate

Workspace isolation is a critical independent gate.

Required checks include:

- every scoped operation has an explicit Workspace context
- authorization is evaluated against that Workspace
- storage keys and queries enforce Workspace boundaries
- caches cannot mix Workspace data
- background jobs preserve Workspace identity
- logs, evidence, and telemetry prevent cross-Workspace disclosure
- AI retrieval and context assembly are Workspace-scoped
- administrative operations are explicit and audited
- tests attempt unauthorized cross-Workspace access

Any confirmed cross-Workspace data access SHALL be critical and SHALL block release or operation.

---

# 23. Data Quality Gate

Data quality SHALL be evaluated across:

- validity
- completeness
- consistency
- uniqueness
- timeliness
- lineage
- integrity
- confidentiality

Thresholds SHALL be defined per data product or artifact class.

Data quality aggregates SHALL NOT conceal integrity or confidentiality failures.

---

# 24. Traceability Gate

The traceability gate SHALL verify:

- requirements trace to authoritative intent
- risks trace to controls and tests
- tests trace to requirements and risks
- automation traces to test definitions
- executions trace to exact assets and environments
- evidence traces to executions
- defects trace to failed expectations
- knowledge traces to sources and validation
- releases trace to accepted changes

Missing mandatory links SHALL fail the gate.

Optional relationship completeness MAY be reported as advisory.

---

# 25. Compatibility Gate

Compatibility evaluation SHALL consider:

- behavioral compatibility
- interface compatibility
- schema and data compatibility
- configuration compatibility
- consumer compatibility
- operational compatibility
- security compatibility
- historical evidence compatibility

A breaking change SHALL require:

- explicit classification
- affected-consumer inventory
- versioning or migration strategy
- communication plan
- approval from accountable owners
- validation of both transition and target state

Unannounced breaking changes SHALL fail.

---

# 26. Test Gate

The test gate SHALL select validation based on changed behavior and risk rather than file type alone.

Required dimensions MAY include:

- unit validation
- contract validation
- integration validation
- end-to-end journeys
- regression coverage
- negative and boundary behavior
- security testing
- isolation testing
- migration testing
- recovery testing
- performance and capacity testing
- accessibility and usability validation
- AI evaluation

Skipped tests SHALL have recorded reasons.

Retries SHALL NOT convert nondeterministic failure into an unexplained pass.

---

# 27. Coverage Gate

Coverage SHALL be interpreted as evidence of exercised obligations, not merely lines executed.

Preferred coverage dimensions are:

- requirement coverage
- risk coverage
- rule coverage
- interface coverage
- state-transition coverage
- failure-mode coverage
- Workspace isolation coverage
- supported-provider coverage
- migration-path coverage

Numeric code coverage MAY support the decision but SHALL NOT be the sole acceptance criterion.

---

# 28. Static Quality Gate

Static checks MAY include:

- formatting
- syntax
- type safety
- linting
- dependency policy
- secret scanning
- vulnerability scanning
- license policy
- schema validation
- documentation link validation
- forbidden pattern detection

Static tools SHALL be pinned or version-identifiable.

Suppressions SHALL include owner, reason, scope, and expiration where risk persists.

---

# 29. Runtime Quality Gate

Runtime quality thresholds SHALL be defined for relevant service characteristics:

- availability
- correctness
- latency
- throughput
- error rate
- resource saturation
- recovery time
- data freshness
- execution reliability
- evidence completeness

Thresholds SHALL identify measurement windows and environments.

Production acceptance SHALL use production-relevant indicators.

---

# 30. Observability Gate

Observability SHALL be sufficient to determine:

- what operation occurred
- which Workspace and actor scope applied
- which component and version executed
- what decision was made
- whether the operation succeeded
- why it failed
- what evidence supports the conclusion

Sensitive data SHALL NOT be added to telemetry merely to improve diagnosis.

Changes that introduce unobservable critical failure modes SHALL fail.

---

# 31. Documentation Gate

Documentation SHALL be updated when a change affects:

- authoritative behavior
- interfaces or schemas
- operational procedures
- deployment or migration
- security responsibilities
- user-visible behavior
- known limitations
- ownership or support routing

Documentation SHALL describe the accepted system, not an intended future state presented as current.

---

# 32. Evidence Requirements

Valid gate evidence SHALL be:

- attributable to an evaluator or trusted system
- tied to exact artifact versions
- time-stamped
- environment-aware
- complete enough to reproduce or review
- protected against unauthorized modification
- retained according to policy
- scoped to the gate decision

Evidence MAY include:

- structured check results
- test reports
- review approvals
- signed manifests
- logs and traces
- screenshots or recordings where appropriate
- migration verification
- evaluation datasets and summaries
- policy-engine decisions

Narrative assurance without supporting evidence SHALL NOT satisfy a mandatory gate.

---

# 33. Evidence Validity and Invalidation

A gate result SHALL be invalidated when:

- evaluated content changes
- a relevant dependency changes
- the gate policy changes materially
- the target environment changes materially
- retained evidence is corrupted or unavailable
- an approved exception expires
- a new critical vulnerability affects the artifact
- a previously unknown consumer or impact is discovered
- a model, prompt, retrieval source, or tool changes beyond the evaluated scope

Invalidated gates SHALL be re-evaluated before progression.

---

# 34. Severity Model

## Critical

Conditions that may cause:

- cross-Workspace disclosure
- unauthorized access
- irreversible material data loss
- execution contrary to authoritative governance
- uncontained security compromise
- fabricated or corrupted authoritative evidence

Critical failures are always blocking.

## High

Conditions that may cause major functional, compatibility, security, or operational failure.

High failures are blocking unless the governing policy explicitly permits an exception and the accountable specialist approves it.

## Medium

Conditions that materially reduce quality but have bounded consequences and viable remediation.

Medium failures are blocking when thresholds or aggregate risk require.

## Low

Conditions with limited consequence, commonly handled as scheduled improvement.

Low failures MAY be advisory.

---

# 35. Risk-Based Gate Profiles

## Profile A — Critical

Requires:

- all applicable gates
- independent specialist review
- complete evidence retention
- representative pre-production validation
- explicit rollout and rollback controls
- post-deployment observation

## Profile B — High

Requires:

- all core gates
- domain and risk-specialist review
- regression and failure-path evidence
- controlled deployment

## Profile C — Standard

Requires:

- applicable core gates
- peer review
- targeted tests
- traceability and operational evidence

## Profile D — Low

May use streamlined evaluation when:

- scope is narrow
- no critical boundary is touched
- compatibility risk is negligible
- automated evidence is reliable

Risk profile SHALL be determined from impact, not change size alone.

---

# 36. Gate Aggregation

An aggregate gate SHALL use these rules:

```text
Any Critical Failure  → Fail

Any Blocking Failure  → Fail

Required Input Missing → Blocked

All Mandatory Checks Pass → Pass

Only Approved Conditions Remain → Conditional Pass
```

Weighted averages SHALL NOT override independent blocking controls.

The aggregate decision SHALL retain every contributing result.

---

# 37. Gate Ordering

Gates SHALL execute in the least-cost order that preserves correctness:

```text
Identity and Scope

↓

Authority and Ownership

↓

Structure and Static Policy

↓

Traceability and Impact

↓

Focused Validation

↓

Broad Regression

↓

Release and Runtime Validation
```

Early failure MAY stop expensive downstream checks.

Stopped checks SHALL be reported as not executed, not passed.

---

# 38. Gate Automation

Automated gates SHALL:

- evaluate deterministic policies consistently
- use versioned definitions
- produce machine-readable results
- preserve raw and summarized evidence
- avoid modifying evaluated artifacts during evaluation
- fail safely when the evaluator is unavailable
- distinguish product failure from infrastructure failure
- support local reproduction where practical

Automation SHOULD prioritize:

- metadata validation
- dependency and traceability validation
- schema validation
- policy-as-code
- test orchestration
- evidence collection
- expiration and exception checks

Human judgment remains required when authority, semantics, risk acceptance, or ambiguous evidence cannot be determined mechanically.

---

# 39. AI-Assisted Gate Evaluation

AI MAY assist with:

- identifying potentially missing impacts
- classifying review findings
- mapping evidence to requirements
- detecting semantic inconsistencies
- summarizing gate evidence
- recommending validation scope

AI SHALL NOT independently:

- approve critical security risk
- authorize cross-Workspace access
- accept its own generated change without independent controls
- promote knowledge without governed review
- invent missing evidence
- convert uncertainty into a pass
- bypass deterministic policy

AI-assisted decisions SHALL record:

- model and prompt identity
- context sources
- tool results
- uncertainty
- human reviewer where required

---

# 40. Manual Gates

Manual gates SHALL use structured checklists and explicit outcomes.

The reviewer SHALL record:

- identity and authority
- artifacts inspected
- checks performed
- findings and severity
- evidence references
- outcome and conditions
- decision time

Informal conversation MAY support a decision but SHALL NOT replace the gate record.

---

# 41. Exception Management

An exception is a governed, temporary deviation from a gate requirement.

Every exception SHALL include:

- unique identifier
- violated requirement
- business justification
- affected scope
- risk assessment
- compensating controls
- accountable owner
- approving authority
- start and expiration time
- remediation commitment
- monitoring requirements
- revocation conditions

Exceptions SHALL NOT:

- redefine a failure as a pass
- be permanent by default
- apply beyond declared scope
- conceal critical risk from downstream decision makers
- be approved solely by the change author

Expired exceptions cause the affected gate to fail or become blocked until resolved.

---

# 42. Non-Exceptionable Controls

The following are non-exceptionable unless superseded by higher authoritative governance:

- absence of accountable ownership
- deliberate falsification of evidence
- unbounded cross-Workspace access
- unknown identity of a production artifact
- inability to determine whether critical authorization is enforced
- silent bypass of a mandatory gate
- automatic promotion of unvalidated runtime observations to authority

Work SHALL stop until the condition is corrected or escalated to the governing authority.

---

# 43. Failure Handling

When a gate fails:

1. progression SHALL stop
2. failure SHALL be recorded
3. violated authority SHALL be identified
4. affected owner SHALL be notified through the governed workflow
5. remediation SHALL be assigned
6. downstream invalidation SHALL be evaluated
7. corrected scope SHALL be re-evaluated

A re-run SHALL preserve prior failed results for auditability.

---

# 44. Flaky and Nondeterministic Checks

A check is flaky when identical governed inputs can produce inconsistent results without an intended probabilistic contract.

Flaky checks SHALL:

- be identified explicitly
- retain every attempt
- be assigned an owner
- have impact assessed
- be quarantined only through approved policy
- have remediation and expiration

Automatic retry MAY gather diagnostic evidence.

Automatic retry SHALL NOT erase the original failure or silently declare success.

---

# 45. Infrastructure Failure

Evaluator or environment failure SHALL be distinguished from a product failure.

An infrastructure failure normally produces Blocked, not Pass.

The record SHALL identify:

- unavailable dependency
- affected checks
- diagnostic evidence
- retry policy
- responsible owner

Repeated infrastructure instability SHALL itself become a quality finding.

---

# 46. Gate Ownership and Routing

| Gate Concern | Primary Owner | Required Consultation |
|---|---|---|
| Foundation and governance | Engineering Governance | Architecture, Product Governance |
| Architecture | Architecture | Component owners |
| Product intent | Product Governance | Quality Engineering |
| Knowledge | Knowledge Governance | Domain owners |
| AI | AI Governance | Security, Quality Engineering |
| Security | Security | Platform and artifact owners |
| Workspace isolation | Security | Architecture, Platform Engineering |
| Testing | Quality Engineering | Artifact owners |
| Release | Release Owner | Quality, Security, Operations |
| Deployment | Platform Engineering | Operations |
| Runtime acceptance | Operations | Release and service owners |

Routing SHALL follow impact and authority rather than repository location alone.

---

# 47. Separation of Duties

For high and critical risk:

- the author SHALL NOT be the sole approver
- risk acceptance SHALL come from the accountable risk owner
- security exceptions SHALL require Security
- AI exceptions SHALL require AI Governance
- production deployment authorization SHALL follow environment policy
- evidence-producing systems SHALL be protected from unauthorized alteration by evaluated code

Low-risk automated changes MAY use policy-approved automated approval when controls remain independent.

---

# 48. Machine-Readable Gate Record

The canonical conceptual record is:

```yaml
gate_result:
  gate_id: QG-04
  gate_definition_version: 1.0.0
  subject:
    artifact_id: ARTIFACT-ID
    revision: REVISION-ID
  scope:
    workspaces: []
    environments: []
  risk_profile: standard
  started_at: TIMESTAMP
  completed_at: TIMESTAMP
  evaluator:
    type: human | automation | ai_assisted
    identity: EVALUATOR-ID
  checks:
    - check_id: CHECK-ID
      authority: GOV-OR-SPEC-ID
      outcome: pass | conditional_pass | fail | blocked | not_applicable
      severity: critical | high | medium | low
      evidence: []
      explanation: TEXT
  exceptions: []
  aggregate_outcome: pass | conditional_pass | fail | blocked
  accountable_owner: OWNER-ID
  approvals: []
  valid_until: TIMESTAMP-OR-NULL
```

Implementations MAY extend this model but SHALL preserve its semantics.

---

# 49. Gate Policy Versioning

Gate policies SHALL use semantic versioning principles:

- patch: clarification without changed decision behavior
- minor: backward-compatible new checks or metadata
- major: changed acceptance behavior or incompatible result semantics

Policy upgrades SHALL define:

- effective date
- affected gates
- transition period
- historical-result treatment
- required re-evaluation scope

Historical decisions SHALL retain the policy version used at decision time.

---

# 50. Gate Metrics

Useful metrics include:

- first-pass rate
- failure rate by gate and severity
- blocked duration
- remediation lead time
- exception count and age
- expired exception count
- flaky-check rate
- escaped defect rate
- false-positive and false-negative rate
- evidence completeness
- gate execution duration
- invalidation frequency
- risk-profile distribution

Metrics SHALL be used to improve system quality, not to pressure reviewers into approving unsafe changes.

Targets SHALL NOT incentivize suppression of findings or artificial scope reduction.

---

# 51. Gate Effectiveness Review

Gate owners SHALL periodically evaluate whether gates:

- detect material defects before escape
- align with current architecture and risk
- produce actionable failures
- retain useful evidence
- avoid excessive false positives
- remain reproducible
- cover known incident patterns
- have appropriate thresholds
- route decisions correctly

Incidents and escaped defects SHALL trigger review of applicable gate definitions.

Adding a check is not the only response; authority, design, ownership, or evidence flows may require correction.

---

# 52. Quality Gate Anti-Patterns

## 52.1 Green Pipeline Equals Quality

Treating tool success as proof of semantic correctness.

## 52.2 Coverage Percentage as Sole Gate

Using code coverage without requirement or risk coverage.

## 52.3 Retry Until Green

Hiding nondeterminism through repeated execution.

## 52.4 Advisory Critical Controls

Reporting critical security or isolation checks without blocking.

## 52.5 Gate After Irreversible Action

Evaluating readiness only after deployment, migration, or publication.

## 52.6 Ownerless Exception

Allowing bypass without accountable risk ownership.

## 52.7 Permanent Temporary Waiver

Renewing exceptions without remediation or renewed impact analysis.

## 52.8 AI Confidence as Evidence

Accepting model confidence instead of authoritative sources and validation.

## 52.9 One Gate for Every Change

Ignoring artifact type, lifecycle stage, and risk profile.

## 52.10 Aggregate Score Masking Failure

Allowing strong low-risk scores to offset a critical control failure.

## 52.11 Stale Gate Reuse

Reusing results after the artifact, dependency, policy, or environment changed.

## 52.12 Missing Means Pass

Treating unavailable checks or evidence as successful.

---

# 53. AI Agent Instructions

An AI agent evaluating or preparing a gate SHALL:

1. identify the exact subject and revision
2. read governing foundation and governance artifacts first
3. determine applicable gate and risk profile
4. resolve ownership and required approvals
5. inspect direct and transitive traceability
6. execute deterministic checks before semantic inference
7. distinguish evidence from assumption
8. declare missing context and uncertainty
9. preserve Workspace scope
10. retain tool and source provenance
11. never invent a pass result
12. stop on critical failure
13. propose remediation tied to violated authority
14. require human approval where policy demands it

An AI agent SHALL report Blocked when it cannot obtain required evidence.

---

# 54. Gate Definition Checklist

Before accepting a new or changed gate, verify:

## Identity and Purpose

- [ ] Gate ID is stable and unique.
- [ ] Protected lifecycle transition is explicit.
- [ ] Accountable owner is assigned.
- [ ] Governing authority is referenced.

## Scope and Applicability

- [ ] Applicable artifacts and changes are defined.
- [ ] Risk profiles are defined.
- [ ] Not-applicable rules are explicit.
- [ ] Workspace and environment scope are addressed.

## Checks and Thresholds

- [ ] Mandatory checks are distinguishable from advisory checks.
- [ ] Pass and failure thresholds are measurable.
- [ ] Critical controls fail independently.
- [ ] Ordering and stop conditions are defined.

## Evidence and Operation

- [ ] Required evidence is specified.
- [ ] Result validity and invalidation are defined.
- [ ] Failure and remediation routing are defined.
- [ ] Automation failure behavior is safe.

## Governance

- [ ] Exception policy is explicit.
- [ ] Separation of duties is preserved.
- [ ] Versioning and transition rules exist.
- [ ] Effectiveness metrics are defined.

---

# 55. Change Acceptance Checklist

Before QG-04 passes, verify:

- [ ] Authoritative intent exists.
- [ ] Accountable owner approved applicable scope.
- [ ] Change-impact analysis is complete.
- [ ] Dependencies follow canonical direction.
- [ ] Traceability is complete for changed obligations.
- [ ] Implementation matches accepted design.
- [ ] Required reviews are complete.
- [ ] Applicable tests pass with retained evidence.
- [ ] Security checks pass.
- [ ] Workspace isolation checks pass.
- [ ] Compatibility is established or governed as breaking.
- [ ] Migration and rollback are validated where required.
- [ ] AI evaluation passes where applicable.
- [ ] Documentation and operations are updated.
- [ ] No blocking findings remain.
- [ ] Exceptions are approved and unexpired.
- [ ] Result identifies the exact evaluated revision.

---

# 56. Release Readiness Checklist

Before QG-05 passes, verify:

- [ ] Release manifest is complete.
- [ ] Every included change has a valid acceptance result.
- [ ] Release regression passes.
- [ ] Known risks and limitations are documented.
- [ ] Consumer compatibility is verified.
- [ ] Security and compliance approvals are current.
- [ ] Deployment and rollback plans are executable.
- [ ] Migrations are ordered and validated.
- [ ] Telemetry and alerts are ready.
- [ ] Support and incident ownership are assigned.
- [ ] Release notes are accurate.
- [ ] Rollout and rollback thresholds are measurable.
- [ ] Required approvals are retained.

---

# 57. Operational Acceptance Checklist

Before QG-07 passes, verify:

- [ ] Expected artifact version is running.
- [ ] Deployment completed without unexplained deviation.
- [ ] Health checks pass.
- [ ] Critical journeys pass.
- [ ] Workspace isolation remains intact.
- [ ] Data integrity checks pass.
- [ ] Telemetry is complete and correctly scoped.
- [ ] Alerts are active and routed.
- [ ] Service indicators are within thresholds.
- [ ] No critical security event is present.
- [ ] Rollout decision is recorded.
- [ ] Operational owner accepted service state.

---

# 58. Quality Gate Maturity Levels

## Level 0 — Informal

- acceptance is implicit
- evidence is inconsistent
- outcomes depend on individual memory

## Level 1 — Documented

- gates and checklists exist
- outcomes are recorded manually
- evidence requirements are partially standardized

## Level 2 — Repeatable

- gate applicability and ownership are consistent
- deterministic checks are automated
- exceptions are tracked

## Level 3 — Traceability-Aware

- gates traverse authoritative and downstream links
- validation scope is impact-driven
- evidence is tied to exact revisions

## Level 4 — Policy-Integrated

- machine-readable policy drives enforcement
- gate invalidation is automatic
- risk profiles and routing are integrated

## Level 5 — Adaptive and Governed

- effectiveness is measured against incidents and escapes
- AI assists impact and evidence analysis
- changes to gate policy remain human-governed and auditable
- learning improves controls without automatic authority promotion

Maturity improvement SHALL strengthen decision quality, not merely increase automation.

---

# 59. Definition of Done

The quality-gate system is correctly implemented when:

- all lifecycle transitions have defined gates
- gate definitions are versioned and owned
- applicability is determined consistently
- mandatory checks cannot be silently bypassed
- critical controls fail independently
- gate outcomes retain reviewable evidence
- failures route to accountable owners
- exceptions are scoped, approved, and time-bounded
- stale results are invalidated
- Workspace isolation is protected
- AI-assisted evaluation is governed and explainable
- releases contain only artifacts with valid acceptance
- operational acceptance verifies actual service state
- Knowledge Candidates cannot become authority without promotion gates
- gate effectiveness is measured and improved

---

# 60. Summary

QA Intelligence SHALL control quality through the following chain:

```text
Intent Gate

↓

Design Gate

↓

Implementation Gate

↓

Change Acceptance Gate

↓

Release Gate

↓

Deployment Gate

↓

Operational Gate

↓

Learning Gate
```

A gate is valid only when it has:

- authority
- scope
- ownership
- explicit checks
- explicit thresholds
- retained evidence
- an explainable outcome
- governed failure handling

Quality is not the absence of visible failure.

Quality is the presence of sufficient, trustworthy evidence that authorized intent was implemented safely and remains valid in operation.

No artifact SHALL progress merely because evaluation was inconvenient, unavailable, or ambiguous.

Unknown is not pass.

Confidence is not evidence.

Automation is not authority.

Acceptance is a governed decision.
