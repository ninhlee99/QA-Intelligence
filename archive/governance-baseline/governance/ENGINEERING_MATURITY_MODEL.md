---
id: GOV-010
title: Engineering Maturity Model
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
  - GOV-009
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

# Engineering Maturity Model

## 1. Purpose

This document defines the canonical engineering maturity model for the QA Intelligence Engineering Knowledge Base and runtime platform.

Its objectives are to:

- establish a shared definition of engineering maturity
- assess capabilities using observable evidence
- identify the next safe and valuable improvement
- prevent maturity claims based on tooling or aspiration alone
- align product, architecture, knowledge, quality, security, AI, and operations
- make maturity gaps visible and owned
- support planning without turning maturity into a vanity score
- preserve foundational laws while capabilities evolve
- distinguish local excellence from system-wide maturity
- guide controlled adoption of automation and AI

This document answers:

- What does maturity mean for QA Intelligence?
- Which capabilities must exist at each level?
- What evidence proves a level?
- How are maturity claims assessed and approved?
- How do dependencies constrain advancement?
- How are regressions detected?
- Which controls are mandatory at every level?
- How should improvement work be prioritized?

Maturity is the demonstrated ability to produce trustworthy outcomes repeatedly under governed conditions.

Maturity is not:

- the number of tools deployed
- the volume of documentation
- the number of automated tests
- the use of an LLM
- a self-declared score
- a one-time successful release
- an average that hides a critical weakness

---

# 2. Maturity Philosophy

QA Intelligence SHALL mature through the following progression:

```text
Intentional

↓

Repeatable

↓

Governed

↓

Integrated

↓

Adaptive
```

The progression moves from individual knowledge toward institutional capability.

At low maturity, outcomes depend heavily on memory and local effort.

At high maturity, outcomes depend on explicit authority, well-defined interfaces, traceable evidence, enforced controls, and governed learning.

Higher maturity SHALL reduce hidden assumptions, uncontrolled variation, and irreversible risk.

It SHALL NOT remove human accountability.

---

# 3. Normative Language

The terms SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are normative.

- SHALL indicates a mandatory requirement
- SHALL NOT indicates a prohibited condition
- SHOULD indicates a recommended default requiring justification when omitted
- SHOULD NOT indicates a discouraged practice requiring justification when used
- MAY indicates an allowed option

Maturity assessments SHALL interpret these terms consistently with the foundation specifications and governance documents.

---

# 4. Core Maturity Principles

## 4.1 Evidence Over Assertion

Every maturity claim SHALL be supported by current, reviewable evidence.

## 4.2 Capability Over Tooling

Tools MAY enable maturity but SHALL NOT define it.

## 4.3 Outcomes Over Activity

The existence of a process does not prove that the process produces trustworthy outcomes.

## 4.4 System Over Local Optimization

A mature component inside an immature lifecycle does not make the platform mature.

## 4.5 Weakest Critical Control

Critical maturity SHALL be limited by the weakest applicable critical control.

## 4.6 Stable Foundations

Progress SHALL preserve authoritative intent, dependency direction, Workspace isolation, traceability, and evidence integrity.

## 4.7 Progressive Automation

Automation SHALL follow understood, governed behavior.

Undefined behavior SHALL NOT be made mature merely by automating it.

## 4.8 Controlled Learning

Learning SHALL improve candidates, recommendations, and controls without automatically creating authority.

## 4.9 Reversibility

Higher maturity SHOULD increase the ability to detect, contain, roll back, and learn from failure.

## 4.10 Continuous Revalidation

Maturity can regress and SHALL be revalidated when material context changes.

---

# 5. Maturity Scope

An assessment SHALL declare its scope.

Permitted scopes include:

- platform-wide
- value stream
- product capability
- component
- interface
- Workspace class
- lifecycle process
- team-owned domain

The scope SHALL identify:

- included capabilities
- exclusions
- owners
- environments
- Workspaces or consumers
- assessment period
- applicable policies
- known dependencies

A narrow assessment SHALL NOT be presented as platform-wide maturity.

---

# 6. Maturity Levels

The canonical model contains six levels.

| Level | Name | Defining Characteristic |
|---|---|---|
| 0 | Uncontrolled | Outcomes depend on undocumented individual behavior |
| 1 | Intentional | Purpose and ownership are recognized |
| 2 | Repeatable | Defined practices produce repeatable results |
| 3 | Governed | Authority, traceability, review, and gates are enforced |
| 4 | Integrated | Capabilities operate as a connected evidence-driven system |
| 5 | Adaptive | Governed feedback improves the system safely |

Levels are cumulative.

Evidence for a higher level SHALL include continued satisfaction of lower-level requirements.

---

# 7. Level 0 — Uncontrolled

Level 0 represents absent, inconsistent, or untrustworthy capability.

Typical characteristics:

- behavior depends on individual memory
- ownership is missing or ambiguous
- sources of authority are unclear
- artifacts are created without canonical structure
- tests are reactive or absent
- changes bypass impact analysis
- runtime evidence is incomplete
- AI output is accepted based on plausibility
- incidents produce local fixes without systemic learning

Level 0 is not automatically negligence.

It may describe a new capability before governance exists.

However, a critical production capability SHALL NOT remain at Level 0.

Exit evidence:

- accountable owner assigned
- purpose and scope documented
- primary risks identified
- immediate unsafe behavior contained
- roadmap to Level 1 accepted

---

# 8. Level 1 — Intentional

Level 1 establishes explicit intent and ownership.

Required characteristics:

- capability purpose is documented
- accountable owner exists
- users and consumers are identified
- major inputs and outputs are known
- initial terminology is aligned with the canonical glossary
- material risks are recorded
- basic success criteria exist
- work is visible and reviewable

The key question is:

```text
Do we know what this capability is for and who is accountable?
```

Level 1 does not require complete automation or comprehensive governance.

Exit evidence:

- accepted scope statement
- ownership record
- risk inventory
- initial requirements
- named source of authority
- initial validation approach

---

# 9. Level 2 — Repeatable

Level 2 establishes consistent execution.

Required characteristics:

- process or behavior is documented
- inputs, outputs, and expected results are defined
- similar cases follow the same workflow
- artifacts use stable identities and lifecycle states
- basic versioning exists
- testing is repeatable
- evidence is retained consistently
- failures are classified and routed
- changes receive peer review
- operational responsibility is known

The key question is:

```text
Can different qualified people or systems obtain consistent results?
```

Exit evidence:

- repeatable workflow records
- representative test results
- versioned artifacts
- review history
- failure and remediation records
- evidence from more than one execution cycle

---

# 10. Level 3 — Governed

Level 3 establishes institutional control.

Required characteristics:

- authoritative sources govern behavior
- ownership and approval authority are enforced
- dependencies follow the canonical direction
- traceability is bidirectional
- change impact is assessed
- quality gates block invalid progression
- exception handling is explicit and time-bounded
- Workspace isolation and security controls are enforced
- AI-assisted behavior follows SPEC-004
- schemas, rules, and interfaces are versioned
- audit evidence supports decisions

The key question is:

```text
Can the organization prove that the outcome was authorized, reviewed, and controlled?
```

Exit evidence:

- accepted governing artifacts
- traceability reports
- gate results under GOV-009
- review records under GOV-008
- change-impact records under GOV-007
- current exception register
- specialist approvals where required

---

# 11. Level 4 — Integrated

Level 4 connects capabilities into an end-to-end evidence system.

Required characteristics:

- lifecycle artifacts are linked across domains
- impact analysis traverses machine-readable relationships
- quality gates consume consistent evidence
- product intent, risks, tests, automation, executions, and defects are connected
- interfaces isolate providers and implementations
- runtime telemetry maps to governed capabilities
- releases identify exact accepted artifacts
- operational feedback reaches accountable owners
- metrics reveal flow and quality across the lifecycle
- redundant manual reconciliation is reduced

The key question is:

```text
Does the system operate coherently across organizational and technical boundaries?
```

Exit evidence:

- end-to-end traceability samples
- automated gate and evidence flows
- cross-component contract validation
- release-to-runtime provenance
- integrated operational dashboards
- measured reduction in unknown impact and manual handoff loss

---

# 12. Level 5 — Adaptive

Level 5 uses governed feedback to improve outcomes safely.

Required characteristics:

- incidents, executions, and user outcomes create traceable feedback
- Knowledge Candidates are derived with preserved provenance
- improvement hypotheses are evaluated against representative evidence
- rules and controls are calibrated through governed changes
- drift and new failure patterns are detected
- AI assists discovery and analysis without becoming authority
- ineffective gates are revised through controlled governance
- improvement impact is measured after adoption
- learning is Workspace-safe and privacy-preserving
- adaptation is reversible and monitored

The key question is:

```text
Can the system learn from evidence without losing control, provenance, or accountability?
```

Level 5 SHALL NOT mean autonomous policy change.

Exit evidence is continuous rather than final:

- controlled learning records
- candidate-to-knowledge promotion evidence
- drift detection results
- policy effectiveness reviews
- before-and-after outcome measures
- human approvals for authoritative changes

---

# 13. Maturity Dimensions

Every assessment SHALL consider the applicable dimensions:

1. governance and authority
2. product and requirements
3. architecture and design
4. knowledge and semantics
5. rules and decisioning
6. data and Workspace isolation
7. security and privacy
8. AI governance
9. quality engineering
10. automation and execution
11. interfaces and plugins
12. delivery and release
13. operations and resilience
14. observability and evidence
15. learning and improvement

No single dimension represents total maturity.

---

# 14. Governance and Authority Maturity

## Level 0

- decisions are implicit
- ownership is unclear
- authority is inferred from implementation

## Level 1

- owners and decision forums are named
- major governing documents are identified

## Level 2

- decision and review practices are repeatable
- artifact status and versioning are consistent

## Level 3

- canonical governance is enforced
- exceptions and approvals are auditable

## Level 4

- policy drives machine-readable checks and routing
- impact and ownership graphs support decisions

## Level 5

- governance effectiveness is measured
- evidence drives controlled policy improvement

---

# 15. Product and Requirements Maturity

## Level 0

- features begin from solutions or requests without explicit problems

## Level 1

- problem, user, owner, and success criteria are identified

## Level 2

- requirements and acceptance criteria are consistently structured
- risks and exclusions are recorded

## Level 3

- requirements trace to authority, architecture, tests, and releases
- requirement changes pass impact analysis

## Level 4

- requirement coverage and outcome evidence are integrated
- downstream effects are discoverable

## Level 5

- product outcomes generate governed improvement hypotheses
- obsolete requirements are detected and retired safely

---

# 16. Architecture and Design Maturity

## Level 0

- architecture is inferred from code
- boundaries depend on individuals

## Level 1

- system context and major responsibilities are described

## Level 2

- components, interfaces, and dependency rules are repeatable
- significant decisions are recorded

## Level 3

- ADRs and architecture gates control implementation
- dependency violations block acceptance

## Level 4

- architecture relationships support automated impact analysis
- runtime composition matches declared design

## Level 5

- architectural fitness is measured
- evidence informs governed evolution of seams and interfaces

---

# 17. Knowledge and Semantics Maturity

## Level 0

- terms conflict across artifacts
- knowledge lives in conversations or prompts

## Level 1

- canonical terminology and knowledge ownership begin

## Level 2

- Knowledge Objects use stable identities, provenance, and lifecycle states

## Level 3

- ontology, schemas, and promotion controls are governed
- candidates cannot silently become authority

## Level 4

- semantic relationships connect product, testing, execution, and evidence
- discovery precedes unnecessary questions

## Level 5

- feedback produces governed Knowledge Candidates
- stale or conflicting knowledge is detected and revalidated

---

# 18. Rules and Decisioning Maturity

## Level 0

- decisions are embedded in code, prompts, or personal judgment

## Level 1

- important decisions and owners are identified

## Level 2

- rules have structured inputs, outputs, and tests

## Level 3

- deterministic rules precede LLM judgment
- rule authority, priority, conflicts, and versions are governed

## Level 4

- decision explanations and evidence are integrated across executions

## Level 5

- rule effectiveness and drift are measured
- proposed recalibration follows controlled learning

---

# 19. Data and Workspace Isolation Maturity

## Level 0

- Workspace context is implicit or inconsistently enforced

## Level 1

- data owners, classifications, and Workspace boundaries are identified

## Level 2

- storage, queries, jobs, and evidence consistently preserve Workspace identity

## Level 3

- isolation is an independent critical gate
- cross-Workspace negative testing is mandatory

## Level 4

- isolation is verified end to end across caches, retrieval, AI context, and telemetry

## Level 5

- new leakage patterns are detected proactively
- learning remains privacy-preserving and Workspace-safe

Any confirmed ungoverned cross-Workspace access caps this dimension at Level 0 until contained and reassessed.

---

# 20. Security and Privacy Maturity

## Level 0

- security response is reactive
- critical assets and threats are unknown

## Level 1

- owners, assets, classifications, and major threats are identified

## Level 2

- repeatable secure design, scanning, review, and incident practices exist

## Level 3

- risk-based security gates and separation of duties are enforced
- exceptions are governed

## Level 4

- security evidence spans design, supply chain, runtime, and response

## Level 5

- threat and control effectiveness adapt through governed evidence
- detection and containment improve measurably

---

# 21. AI Governance Maturity

## Level 0

- model output is accepted because it appears plausible
- prompts carry hidden policy

## Level 1

- AI use cases, owners, risks, and intended oversight are identified

## Level 2

- prompts, models, sources, tools, and evaluations are versioned and repeatable

## Level 3

- SPEC-004 and QG-09 are enforced
- deterministic controls, provenance, and human accountability are present

## Level 4

- AI evaluation integrates requirements, risks, runtime evidence, and provider-independent interfaces

## Level 5

- drift and new failure modes produce governed improvement candidates
- AI assists learning without authorizing itself

---

# 22. Quality Engineering Maturity

## Level 0

- testing occurs late or inconsistently
- passing tests are equated with correctness

## Level 1

- quality ownership, critical journeys, and initial risks are identified

## Level 2

- test design and execution are repeatable
- evidence and defect routing are consistent

## Level 3

- requirement, risk, test, automation, and execution traceability is enforced
- quality gates block invalid changes

## Level 4

- coverage is measured across requirements, risks, rules, states, and interfaces
- validation scope follows change impact

## Level 5

- escape patterns and test effectiveness drive governed improvement
- generated tests remain evidence-grounded

---

# 23. Automation and Execution Maturity

## Level 0

- execution is manual, opaque, or irreproducible

## Level 1

- important execution paths and owners are known

## Level 2

- assets, environments, results, and retries are consistently recorded

## Level 3

- execution uses governed interfaces and retained evidence
- failure, flakiness, and infrastructure errors are distinct

## Level 4

- engines are abstracted behind provider-independent contracts
- orchestration, evidence, and observability are integrated

## Level 5

- execution outcomes reveal drift and improvement candidates
- optimization remains reversible and policy-controlled

---

# 24. Interfaces and Plugins Maturity

## Level 0

- provider behavior leaks into core logic
- integrations are point-to-point

## Level 1

- integration owners and boundaries are identified

## Level 2

- contracts, versions, errors, and permissions are repeatable

## Level 3

- plugins act as adapters and cannot own core policy
- compatibility and security gates are enforced

## Level 4

- discovery, capability negotiation, and contract evidence are integrated

## Level 5

- compatibility and provider performance inform governed adapter evolution

---

# 25. Delivery and Release Maturity

## Level 0

- release content and readiness are uncertain

## Level 1

- release ownership and basic scope are visible

## Level 2

- repeatable build, review, deployment, and rollback practices exist

## Level 3

- QG-04 through QG-07 enforce acceptance
- release manifests and approvals identify exact artifacts

## Level 4

- release-to-runtime provenance and progressive delivery are integrated

## Level 5

- outcome evidence improves release controls and rollout strategies

---

# 26. Operations and Resilience Maturity

## Level 0

- failures are discovered by users
- recovery depends on individual knowledge

## Level 1

- service owners, critical dependencies, and escalation paths are identified

## Level 2

- monitoring, incident response, backup, and recovery are repeatable

## Level 3

- operational acceptance, service thresholds, and evidence are governed

## Level 4

- runtime health connects to releases, components, Workspaces, and business journeys

## Level 5

- resilience exercises and incidents generate governed improvements
- recovery capability is measured continuously

---

# 27. Observability and Evidence Maturity

## Level 0

- outcomes cannot be explained reliably
- evidence is incomplete or mutable

## Level 1

- critical events and evidence owners are identified

## Level 2

- logs, metrics, traces, and execution evidence are collected consistently

## Level 3

- evidence is attributable, version-aware, Workspace-safe, and retained by policy

## Level 4

- evidence links intent, changes, releases, runtime decisions, and outcomes

## Level 5

- evidence quality and signal effectiveness improve through governed feedback

---

# 28. Learning and Improvement Maturity

## Level 0

- lessons remain informal
- repeated failures recur without systemic action

## Level 1

- improvement owners and feedback sources are identified

## Level 2

- retrospectives, candidates, and actions are recorded consistently

## Level 3

- candidate validation and promotion follow ADR-005 and ADR-010

## Level 4

- feedback is connected to sources, risks, tests, rules, and outcomes

## Level 5

- learning effectiveness is measured
- validated improvement changes the system without bypassing authority

---

# 29. Foundational Controls

The following controls apply regardless of claimed maturity:

- Workspace isolation
- accountable ownership
- authoritative source precedence
- evidence integrity
- security and privacy obligations
- explicit AI uncertainty
- prohibition on automatic authority promotion
- prohibition on fabricated traceability
- prohibition on silent gate bypass

Maturity models SHALL NOT be used to defer containment of a critical violation.

---

# 30. Dependency Rules

Maturity dimensions depend on one another.

Canonical dependencies include:

```text
Governance and Authority
        ↓
Product and Requirements
        ↓
Architecture and Semantics
        ↓
Rules, Data, and Interfaces
        ↓
Quality and Automation
        ↓
Delivery and Operations
        ↓
Learning and Adaptation
```

Examples:

- AI maturity depends on evidence, security, and knowledge maturity
- adaptive learning depends on governed knowledge promotion
- release maturity depends on change acceptance and traceability
- automation maturity depends on stable interfaces and explicit behavior
- operational maturity depends on observability and ownership

A dependent dimension SHALL NOT be rated above the level supported by its critical prerequisites.

---

# 31. Maturity Caps

A cap limits the maximum claim for a dimension or scope.

| Condition | Maximum Level |
|---|---|
| No accountable owner | 0 |
| No explicit purpose or scope | 0 |
| No repeatable evidence | 1 |
| No governed authority or traceability | 2 |
| Mandatory quality gates can be silently bypassed | 2 |
| No end-to-end integration evidence | 3 |
| Learning changes authority automatically | 3 |
| No measured improvement effectiveness | 4 |

Critical security or Workspace violations MAY reduce the cap further.

Caps SHALL be applied before aggregate scoring.

---

# 32. Assessment Outcomes

An assessment SHALL produce one of:

## Confirmed

Required evidence proves the claimed level.

## Confirmed with Conditions

The level is supported, but bounded, non-critical remediation is required within an approved period.

## Not Confirmed

Evidence does not support the claimed level.

## Blocked

Required evidence, access, environment, or ownership is unavailable.

## Not Applicable

The dimension does not apply to the declared scope, with recorded justification.

Missing evidence SHALL produce Not Confirmed or Blocked, never Confirmed.

---

# 33. Evidence Requirements

Maturity evidence SHALL be:

- current
- attributable
- tied to declared scope
- representative rather than exceptional
- reproducible or independently reviewable
- retained according to policy
- protected against unauthorized modification
- sufficient to demonstrate repeated behavior

Preferred evidence includes:

- accepted specifications and ADRs
- ownership records
- traceability and impact reports
- gate and review results
- test and execution evidence
- release manifests
- operational indicators
- incidents and remediation records
- exception registers
- knowledge promotion decisions
- effectiveness measures

Plans and roadmaps are evidence of intent, not achieved maturity.

---

# 34. Evidence Windows

Assessments SHALL define a representative evidence window.

The window SHOULD include:

- multiple change cycles
- at least one release or equivalent lifecycle completion
- normal and exceptional behavior
- applicable incidents or failures
- current policy and architecture versions

Shorter windows MAY be used for new capabilities but SHALL limit confidence and claim scope.

Historical excellence SHALL NOT override current regression.

---

# 35. Assessment Roles

## Assessment Sponsor

Defines purpose, scope, and expected use of the assessment.

## Accountable Owner

Owns the capability and remediation commitments.

## Assessor

Collects evidence and evaluates criteria independently.

## Domain Reviewer

Validates semantic and technical conclusions.

## Governance Reviewer

Ensures consistent application of the model.

## Specialist Reviewer

Validates Security, AI, Knowledge, Quality, Platform, or Operations dimensions when applicable.

The owner SHALL NOT be the sole assessor for high-risk or platform-wide claims.

---

# 36. Assessment Workflow

The canonical workflow is:

```text
Define Purpose

↓

Declare Scope

↓

Identify Dimensions and Dependencies

↓

Collect Evidence

↓

Apply Caps

↓

Evaluate Level Criteria

↓

Validate with Owners and Reviewers

↓

Record Gaps and Risks

↓

Approve Result

↓

Plan Improvements

↓

Reassess
```

The assessment SHALL distinguish observed fact, inference, and recommendation.

---

# 37. Level Determination

A dimension achieves level N only when:

- all mandatory criteria for level N are satisfied
- all lower-level mandatory criteria remain satisfied
- no applicable maturity cap is below N
- evidence is current and representative
- blocking contradictions are resolved
- required reviewers confirm the result

Partial satisfaction SHALL NOT be rounded upward.

The reported level is the highest fully supported level.

Progress toward the next level MAY be reported separately as percentage completion, but SHALL NOT change the confirmed level.

---

# 38. Aggregate Maturity

The platform-wide maturity level SHALL be the lowest level among applicable critical dimensions, subject to caps.

Supporting summaries MAY show:

- median dimension level
- distribution by level
- strengths
- bottlenecks
- confidence
- trend

An arithmetic average SHALL NOT be labeled as the platform maturity level.

Example:

```text
Governance: 3
Architecture: 3
Knowledge: 2
Quality: 3
Security: 3
Operations: 2

Confirmed system maturity: 2
```

The result exposes the constraint rather than hiding it.

---

# 39. Confidence

Assessment confidence SHALL be reported separately from maturity.

## High Confidence

- evidence is complete, current, and independently verified
- representative cycles and failure cases were observed

## Medium Confidence

- evidence is generally sufficient but has bounded gaps
- limited inference is required

## Low Confidence

- evidence is incomplete, narrow, self-reported, or outdated

High maturity with low confidence SHALL trigger additional evidence collection.

Confidence SHALL NOT increase the maturity level.

---

# 40. Gap Classification

Maturity gaps SHALL be classified as:

## Control Gap

A mandatory safeguard is absent or ineffective.

## Capability Gap

The required people, process, interface, or technology does not exist.

## Evidence Gap

The capability may exist but cannot be proven.

## Integration Gap

Local capabilities exist but do not operate coherently end to end.

## Adoption Gap

The capability exists but is not used consistently.

## Effectiveness Gap

The capability operates but does not improve intended outcomes.

Gap type SHALL guide remediation.

Adding automation does not resolve an authority or ownership gap.

---

# 41. Improvement Prioritization

Improvement work SHOULD be prioritized by:

1. critical risk containment
2. foundational ownership and authority
3. maturity caps and dependency bottlenecks
4. high-frequency failure and rework
5. evidence and observability gaps
6. integration gaps
7. efficiency improvements
8. adaptive optimization

The next maturity level SHOULD be achieved through the smallest coherent capability improvement.

Isolated activities that do not remove a cap or improve an outcome SHOULD have lower priority.

---

# 42. Improvement Plan

Every material maturity gap SHALL have:

- gap identifier
- affected scope and dimension
- current and target level
- risk and consequence
- accountable owner
- required capability change
- dependency prerequisites
- acceptance evidence
- quality gates
- target date or review date
- status

Improvement plans SHALL define evidence of achieved capability, not only completion of tasks.

---

# 43. Maturity Roadmaps

A maturity roadmap SHALL:

- advance one coherent level at a time
- address prerequisites before dependent capabilities
- preserve operational safety
- include adoption and evidence work
- avoid automating undefined behavior
- include revalidation after material change
- identify explicit non-goals

Example progression:

```text
Assign Ownership

↓

Define Canonical Workflow

↓

Version Artifacts and Evidence

↓

Enforce Traceability and Gates

↓

Integrate Lifecycle Evidence

↓

Enable Controlled Learning
```

---

# 44. Regression

Maturity SHALL be reduced when current evidence no longer supports the confirmed level.

Regression triggers include:

- loss of ownership
- expired or bypassed controls
- architecture divergence
- broken traceability
- repeated unexplained gate failures
- uncontrolled provider or model changes
- evidence integrity loss
- operational capability degradation
- unresolved critical incidents
- automatic promotion of unvalidated knowledge
- material policy changes without adoption

A previous assessment is not a permanent entitlement.

---

# 45. Reassessment Triggers

Reassessment SHALL occur when:

- a major release changes capability behavior
- architecture or governing policy changes materially
- ownership changes
- a critical incident occurs
- a new Workspace or consumer class is introduced
- a new AI model, provider, or autonomy level is adopted
- a major migration occurs
- evidence systems change
- an exception reveals systemic weakness
- the assessment validity period expires

High-risk dimensions SHOULD be reassessed more frequently.

---

# 46. Maturity and Quality Gates

GOV-009 quality gates prove individual lifecycle decisions.

This maturity model evaluates whether those decisions form a reliable institutional capability over time.

The relationship is:

```text
Gate Results

↓

Repeated Evidence

↓

Capability Assessment

↓

Confirmed Maturity
```

A single passed gate cannot prove repeatable maturity.

Repeated unexplained gate bypasses prevent Level 3 or higher.

Maturity improvement MAY add or revise gates through governed change impact and review.

---

# 47. Maturity and Metrics

Metrics SHALL support questions about capability and outcomes.

Useful measures include:

- requirement-to-evidence completeness
- change failure and recovery rates
- gate first-pass and bypass rates
- exception count and age
- unknown-impact frequency
- escaped defect severity
- Workspace isolation violations
- review and remediation lead time
- evidence completeness
- flaky execution rate
- incident recurrence
- knowledge staleness
- candidate promotion quality
- AI evaluation drift
- rollback success

Metrics SHALL NOT become targets that incentivize suppressed findings, fragmented scope, or superficial compliance.

---

# 48. Maturity and AI

AI MAY assist with:

- locating evidence
- identifying possible gaps
- mapping controls to artifacts
- comparing assessment periods
- detecting inconsistency
- drafting improvement hypotheses

AI SHALL NOT:

- award its own maturity level
- invent missing evidence
- treat confidence as authority
- conceal uncertainty
- approve critical exceptions
- promote its output to governed knowledge automatically
- use data across Workspace boundaries

AI-assisted assessments SHALL retain model, prompt, context, tool, and reviewer provenance.

---

# 49. Machine-Readable Assessment Model

The canonical conceptual model is:

```yaml
maturity_assessment:
  assessment_id: ASSESSMENT-ID
  model_version: 1.0.0
  scope:
    type: platform | value_stream | capability | component | process
    identifiers: []
    exclusions: []
    workspaces: []
    environments: []
  assessment_period:
    start: TIMESTAMP
    end: TIMESTAMP
  sponsor: OWNER-ID
  accountable_owner: OWNER-ID
  assessors: []
  dimensions:
    - dimension_id: DIMENSION-ID
      claimed_level: 0
      confirmed_level: 0
      maturity_cap: 5
      confidence: high | medium | low
      evidence: []
      gaps: []
      outcome: confirmed | confirmed_with_conditions | not_confirmed | blocked | not_applicable
  aggregate:
    confirmed_level: 0
    confidence: high | medium | low
    limiting_dimensions: []
  approvals: []
  improvement_plan: []
  valid_until: TIMESTAMP
```

Implementations MAY extend the model but SHALL preserve its semantics.

---

# 50. Assessment Record

The human-readable assessment record SHALL include:

- purpose
- scope and exclusions
- assessment period
- participants and roles
- applicable dimensions
- evidence inventory
- level findings
- maturity caps
- confidence
- gaps and risks
- aggregate result
- improvement priorities
- approvals
- validity and reassessment date

All conclusions SHALL link to evidence.

---

# 51. Assessment Checklist

## Preparation

- [ ] Purpose and audience are defined.
- [ ] Scope and exclusions are explicit.
- [ ] Accountable owner is assigned.
- [ ] Assessors have appropriate independence.
- [ ] Applicable dimensions and policies are identified.
- [ ] Evidence window is representative.

## Evidence

- [ ] Evidence is current and attributable.
- [ ] Evidence covers repeated execution.
- [ ] Failure and exceptional cases are included.
- [ ] Evidence identifies artifact and policy versions.
- [ ] Workspace and environment scope are preserved.
- [ ] Plans are not misclassified as achieved capability.

## Evaluation

- [ ] Lower-level criteria remain satisfied.
- [ ] Maturity caps are applied first.
- [ ] Critical dimensions are identified.
- [ ] Partial satisfaction is not rounded upward.
- [ ] Confidence is separate from maturity.
- [ ] Contradictory evidence is resolved or declared.

## Outcome

- [ ] Limiting dimensions are visible.
- [ ] Gaps are classified.
- [ ] Risks and owners are recorded.
- [ ] Improvement work has acceptance evidence.
- [ ] Required reviewers approve the result.
- [ ] Validity and reassessment triggers are defined.

---

# 52. Platform-Level Acceptance Criteria

A platform-wide maturity claim SHALL require:

- coverage of every critical dimension
- evidence across representative Workspaces and environments
- end-to-end lifecycle samples
- current security and isolation evidence
- release-to-runtime provenance
- current exception and incident review
- independent governance validation
- identification of the lowest critical dimension
- no concealed scope exclusions

Platform maturity SHALL NOT be extrapolated from a pilot alone.

---

# 53. Team and Component Use

Teams and component owners MAY use this model for local improvement.

Local assessments SHALL:

- declare boundaries
- identify external dependencies
- avoid scoring capabilities outside their control
- escalate systemic gaps
- link local evidence to platform governance
- distinguish local level from platform level

A team SHOULD NOT be penalized for a systemic gap it cannot own, but the aggregate platform assessment SHALL still expose that gap.

---

# 54. Supplier and Plugin Assessment

External providers and plugins SHALL be assessed within the capability they affect.

Assessment SHALL consider:

- contract clarity
- security and privacy
- versioning and compatibility
- failure isolation
- observability
- data handling
- Workspace boundaries
- operational support
- exit and replacement strategy
- evidence accessibility

Provider maturity claims SHALL NOT replace QA Intelligence validation.

A mature adapter SHALL preserve core policy independence from the provider.

---

# 55. Exceptions

An assessment exception MAY address missing evidence or temporary criteria only when:

- no non-exceptionable critical control is violated
- scope and duration are explicit
- residual risk is accepted by the correct owner
- compensating evidence or controls exist
- remediation is planned

An exception SHALL NOT raise a confirmed maturity level.

It MAY allow a Confirmed with Conditions outcome at the otherwise supported level.

---

# 56. Anti-Patterns

## 56.1 Tool Inventory Scoring

Counting tools as maturity without proving capability or outcomes.

## 56.2 Average Hides the Weakest Link

Using arithmetic averages to conceal critical immaturity.

## 56.3 Documentation Equals Adoption

Claiming maturity because a process is written but not consistently used.

## 56.4 Pilot Equals Platform

Generalizing from a narrow successful pilot.

## 56.5 One-Time Success

Using a single release or test run as proof of repeatability.

## 56.6 Self-Assessment Without Evidence

Accepting owner opinion as sufficient proof.

## 56.7 Automate Before Understand

Automating inconsistent or unauthorized behavior.

## 56.8 AI Equals Adaptive

Claiming Level 5 merely because an LLM is used.

## 56.9 Roadmap as Current State

Treating intended future capability as achieved maturity.

## 56.10 Permanent Level

Failing to reassess after change, incident, or evidence expiration.

## 56.11 Compliance Theater

Producing artifacts that do not influence decisions or outcomes.

## 56.12 Improvement by Score

Optimizing the assessment result instead of reducing risk and improving capability.

---

# 57. AI Agent Instructions

An AI agent supporting a maturity assessment SHALL:

1. read foundation specifications and governance in canonical order
2. declare the exact assessment scope
3. identify accountable owners and dependencies
4. collect evidence before proposing a level
5. distinguish fact, inference, and recommendation
6. apply maturity caps before aggregation
7. verify all lower-level criteria
8. expose the weakest critical dimension
9. report missing evidence as a gap or blocker
10. preserve Workspace boundaries and sensitive-data policy
11. avoid turning tool presence into capability proof
12. retain source and tool provenance
13. require human validation for authoritative conclusions
14. never promote its own assessment to authority

An AI agent SHALL prefer a lower defensible level over a higher speculative level.

---

# 58. Definition of Done

The engineering maturity model is correctly adopted when:

- scopes and dimensions are consistently defined
- maturity claims use current representative evidence
- levels are cumulative
- caps and dependencies prevent unsupported advancement
- critical weaknesses are not hidden by averages
- confidence is reported separately
- gaps have owners and evidence-based acceptance criteria
- improvement plans address causes rather than scores
- quality-gate results support repeatability claims
- regressions cause reassessment
- Workspace isolation, security, and evidence integrity remain mandatory
- AI assistance is governed and explainable
- Level 5 learning remains controlled and does not create authority automatically
- assessments improve engineering decisions and outcomes

---

# 59. Summary

QA Intelligence SHALL mature through this chain:

```text
Level 0 — Uncontrolled

↓

Level 1 — Intentional

↓

Level 2 — Repeatable

↓

Level 3 — Governed

↓

Level 4 — Integrated

↓

Level 5 — Adaptive
```

The maturity model evaluates whether QA Intelligence can:

- explain why a capability exists
- identify who owns it
- repeat its intended behavior
- prove that behavior is governed
- connect evidence across the lifecycle
- learn from outcomes without losing control

Maturity SHALL be earned through evidence.

Automation is not maturity without understood behavior.

Documentation is not maturity without adoption.

AI is not maturity without governance.

Learning is not maturity without provenance and approval.

The highest maturity is not maximum autonomy.

It is maximum trustworthy adaptability under explicit human accountability.
