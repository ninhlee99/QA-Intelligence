---
id: SPEC-106
title: Agent and Skill Knowledge Model
version: 1.0.0
status: accepted
owner:
  - Knowledge Governance
  - AI Governance
depends_on:
  - SPEC-004
  - SPEC-005
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - SPEC-104
  - SPEC-105
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-005
  - ADR-007
  - ADR-008
  - ADR-010
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/KNOWLEDGE_REVIEW.yaml
---

# SPEC-106: Agent and Skill Knowledge Model

## 1. Purpose

This specification defines the canonical meaning, identity, composition, versioning, and governance of QA Intelligence Agents, Skills, Tools, prompts, and working context.

## 2. Model Boundary

- An **Agent Definition** declares a governed QA role, objectives, capabilities, limits, and escalation behavior.
- A **Skill Definition** declares one reusable procedure with explicit triggers, inputs, outputs, evidence, and failure behavior.
- A **Tool Definition** declares an authorized action contract. A tool never grants its caller more authority than the active policy.
- A **Prompt Template** is versioned implementation input, not product intent or accepted knowledge.
- An **Agent Run** is a runtime occurrence of an exact Agent Definition and its resolved dependencies.

A Skill is not a Plugin. A Skill owns procedural QA behavior; a Plugin is a replaceable technology adapter. A Skill MAY use tools exposed through plugins only through approved contracts.

## 3. Agent Definition

Every Agent Definition SHALL declare:

- stable identifier, semantic version, lifecycle status, accountable owner, and Workspace scope
- QA role, intended users, goals, non-goals, and consequence class
- accepted requirements, rules, and knowledge scopes it may use
- required and optional Skills with compatible version ranges
- allowed Tools, per-tool permissions, and approval requirements
- input, output, evidence, and escalation contracts
- maximum steps, elapsed time, model usage or cost, retries, and concurrent work
- deterministic validation performed before and after bounded AI reasoning
- prohibited actions and data classes
- supported Runtime and Evaluation contract versions

An Agent Definition SHALL NOT embed credentials, provider-specific secrets, unreviewed business rules, or accepted knowledge copied from the Knowledge Store.

## 4. Skill Definition

Every Skill Definition SHALL declare:

- identity, version, status, owner, purpose, and non-goals
- positive and negative trigger conditions
- required inputs, preconditions, outputs, and postconditions
- ordered procedure and permitted decision points
- required knowledge, rules, tools, and evidence
- side effects, idempotency expectations, compensation, and approval points
- failure, uncertainty, cancellation, and escalation behavior
- security, privacy, and Workspace constraints
- evaluation suite references and compatibility requirements

Skill instructions SHALL separate normative requirements from examples and implementation hints. Conflicting instructions SHALL be resolved by the authority order in Foundation and Governance; a Skill cannot override platform policy.

## 5. Composition Rules

An Agent MAY compose multiple Skills when their contracts, authority, and versions are compatible. Composition SHALL preserve:

1. the narrowest applicable permissions
2. Workspace and data classification
3. deterministic-rule precedence
4. provenance for every selected Skill and Tool
5. explicit conflict resolution or safe failure

Dynamic Skill discovery MAY suggest candidates, but only registered, enabled, compatible Skills may execute.

## 6. Context and Memory

Agent working context is ephemeral runtime state. It SHALL be purpose-limited, minimally necessary, Workspace-scoped, provenance-bearing, and deleted according to retention policy.

Conversation history, scratchpads, model state, and run summaries SHALL NOT become authoritative knowledge. Reusable observations enter the governed Knowledge Candidate lifecycle defined by SPEC-102 and SPEC-105.

## 7. Lifecycle and Compatibility

Agent, Skill, Tool, and Prompt versions use `draft → in_review → accepted → deprecated → retired`, with `rejected` as a terminal review outcome. Only accepted and enabled versions may be released.

Breaking changes include altered triggers, permissions, side effects, required inputs, output meaning, evidence obligations, or safety behavior. Breaking changes require a new major version, migration impact analysis, and regression evaluation.

## 8. Security and Authority

Effective authority is the intersection of platform policy, Workspace policy, Agent Definition, Skill Definition, Tool Definition, runtime approval, and actor authority. Missing or conflicting authority results in denial or human escalation.

Prompt content and retrieved documents are untrusted input. They cannot change policy, expand tools, cross Workspaces, suppress evidence, or authorize persistence.

## 9. Acceptance Criteria

This specification is ready for acceptance when schemas exist for Agent, Skill, Tool, and Prompt definitions; valid and invalid examples pass; composition conflicts are tested; lifecycle and compatibility checks are automated; and every persistent learning path ends at Knowledge Candidate governance.

## 10. Actors and Ownership

- Product Governance owns the QA outcome and capability scope of an Agent.
- AI Governance owns autonomy, Prompt, model-use, and escalation policy.
- Quality Engineering owns Skill procedure correctness and evaluation coverage.
- Security owns permission classes and non-overridable controls.
- Runtime Platform implements execution but cannot redefine Agent or Skill meaning.
- Knowledge Governance owns persistent knowledge semantics and promotion.

One accountable owner SHALL be resolved for every executable version. Contributors and model providers never acquire authority by producing content.

## 11. Inputs and Outputs

Registration accepts a schema-valid immutable definition, dependency versions, integrity digest, compatibility declaration, evaluation references, and approval evidence. Resolution returns the exact definition, effective dependency graph, authority envelope, compatibility result, and provenance.

Invalid identity, unresolved dependency, incompatible version, missing evaluation, expired approval, or disabled status SHALL produce a structured non-executable result.

## 12. Failure and Recovery

Definition validation, resolution, invocation, Tool, policy, provider, and persistence failures SHALL remain distinct. Partial registration SHALL not expose an executable version. Retrying registration is idempotent by artifact identity and digest.

If an accepted dependency is revoked, compromised, or becomes incompatible, affected Agent and Skill versions SHALL be disabled or blocked through impact analysis; historical runs retain the versions originally used.

## 13. Observability and Evidence

The system SHALL expose registration, resolution, selection, conflict, permission denial, version incompatibility, deprecation, and disablement events. Telemetry identifies artifact and Workspace references without logging Prompt bodies, secrets, protected knowledge, or hidden reasoning.

## 14. Limits and Configuration

Platform policy defines absolute maximum steps, time, retries, Tool calls, model usage, cost, data classification, and retention. Agent and Skill definitions may narrow but never widen those limits. Defaults SHALL fail safe and be versioned; unbounded execution is prohibited.

## 15. Edge Cases

Required tests include ambiguous or overlapping Skill triggers, recursive Skill composition, missing optional and required dependencies, Prompt injection inside instructions, deprecated Tool versions, incompatible output schemas, revoked approvals, concurrent registration, digest mismatch, and cross-Workspace resolution attempts.

## 16. Quality Gates and Definition of Done

- all representation schemas compile under Draft 2020-12 and positive and negative examples pass
- trigger, composition, compatibility, authority, lifecycle, failure, and isolation behavior is deterministic where required
- production and deterministic adapters cross the same Interface where a seam is justified
- every Agent and Skill references evaluation coverage and rollback or disablement behavior
- no Prompt, conversation, Plugin, Tool, or runtime memory becomes product authority or accepted knowledge
- GOV-008, GOV-009, and applicable GOV-012 evidence is retained

There are no open semantic decisions in version 1.0. Provider selection and implementation packaging remain downstream decisions.
