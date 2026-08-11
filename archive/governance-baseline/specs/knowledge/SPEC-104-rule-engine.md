---
id: SPEC-104
title: Rule Engine
version: 1.0.0
status: accepted
owner:
  - Rule Governance
depends_on:
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - GOV-006
  - GOV-009
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-104: Rule Engine

## 1. Purpose

This specification defines deterministic rule representation, evaluation, explanation, lifecycle, and governance.

The Rule Engine SHALL evaluate known policy and domain logic before probabilistic AI reasoning.

## 2. Goals

- make business and governance rules explicit
- produce repeatable decisions
- preserve rule authority and versions
- explain every result
- support Workspace-specific applicability safely
- detect conflicts and missing inputs
- keep rule semantics independent of execution technology

## 3. Non-Goals

The Rule Engine does not:

- replace ontology or Knowledge Objects
- resolve ambiguous policy through hidden heuristics
- use LLM output as deterministic fact
- own orchestration or product UI
- silently learn or modify rules

## 4. Rule Contract

Every rule SHALL contain:

```yaml
id: RULE-ID
version: SEMANTIC-VERSION
status: draft | in_review | accepted | deprecated | superseded | archived
title: TEXT
authority: []
owner: OWNER-ID
workspace_scope: GLOBAL-OR-WORKSPACE
applies_when: EXPRESSION
inputs: []
decision: EXPRESSION
outputs: []
priority: INTEGER
effective_from: TIMESTAMP
effective_until: TIMESTAMP-OR-NULL
explanation_template: TEXT
tests: []
```

## 5. Rule Types

- validation rules
- classification rules
- eligibility rules
- precedence rules
- transformation rules
- routing rules
- quality-gate rules
- policy constraints
- scoring rules with deterministic formulas

Probabilistic model judgments SHALL be represented as inputs with provenance, not hidden inside deterministic rule logic.

## 6. Evaluation Context

Every evaluation SHALL identify:

- evaluation ID
- rule set and exact versions
- Workspace
- actor and authorization context
- input facts and provenance
- evaluation time
- policy effective time
- requested output

Missing mandatory context SHALL fail closed or return `indeterminate` according to the rule contract.

## 7. Outcomes

Canonical outcomes are:

- `satisfied`
- `not_satisfied`
- `indeterminate`
- `not_applicable`
- `error`

`indeterminate` SHALL NOT be converted to `satisfied`.

## 8. Execution Order

The canonical decision chain is:

```text
Validate Context
↓
Resolve Applicable Rule Set
↓
Load Authoritative Facts
↓
Evaluate Preconditions
↓
Apply Priority and Conflict Policy
↓
Evaluate Decision
↓
Produce Explanation and Evidence
```

## 9. Precedence and Conflicts

Precedence SHALL be explicit by:

- authority class
- specificity
- Workspace applicability
- version and effective period
- declared priority

Conflicting rules with equal precedence SHALL produce `indeterminate` and a conflict record unless a governed resolution rule exists.

## 10. Explanation

Every decision SHALL expose:

- evaluated rules and versions
- applicable and non-applicable rules
- relevant inputs
- matched conditions
- output and reason
- conflict or missing-input details
- supporting authority

Explanations SHALL be generated from the deterministic evaluation trace, not reconstructed by an LLM.

## 11. Rule Sets

Rules MAY be grouped into versioned rule sets.

A rule set SHALL define:

- scope
- included rule versions
- ordering and conflict strategy
- compatibility
- effective period
- owner and approval

Executions SHALL reference the exact rule-set version.

## 12. Workspace Rules

Workspace-specific rules MAY refine global behavior only within permitted extension points.

They SHALL NOT:

- weaken non-overridable global controls
- access another Workspace's facts
- change global authority
- be reused outside their declared scope

## 13. Lifecycle

Rules SHALL follow governed draft, review, acceptance, deprecation, supersession, and archival.

Accepted versions are immutable.

New versions SHALL include impact, compatibility, test, and effective-date analysis.

## 14. Testing

Every accepted rule SHALL have:

- positive cases
- negative cases
- boundary cases
- missing-input cases
- not-applicable cases
- precedence and conflict cases
- Workspace isolation cases
- historical effective-time cases where applicable

## 15. Performance

Performance optimization SHALL preserve deterministic results and explanation completeness.

Caching SHALL include Workspace, rule-set version, effective time, and material input identity.

## 16. Security

- untrusted expressions SHALL NOT execute arbitrary code
- inputs SHALL be schema-validated
- rule authoring and approval SHALL be separated for high-risk rules
- evaluation traces SHALL protect sensitive inputs
- rule packages SHALL have integrity verification

## 17. Quality Gates

A rule passes when:

- authority and ownership are valid
- inputs and outputs are typed
- logic is deterministic and explainable
- conflicts and precedence are tested
- applicability and effective time are explicit
- Workspace isolation passes
- impact and compatibility are approved

## 18. Definition of Done

- canonical rule schema exists
- provider-independent evaluation interface exists
- exact rule versions are reproducible
- every outcome has a deterministic trace
- conflict, boundary, isolation, and historical tests pass
- no rule lifecycle change occurs automatically from runtime feedback

## 19. Summary

The Rule Engine turns explicit authority into reproducible decisions.

When deterministic rules cannot decide, the system SHALL expose uncertainty rather than hide it.
