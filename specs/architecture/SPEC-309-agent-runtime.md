---
id: SPEC-309
title: Agent Runtime Architecture
version: 1.0.0
status: accepted
owner:
  - Architecture
  - AI Governance
depends_on:
  - SPEC-106
  - SPEC-201
  - SPEC-304
  - SPEC-305
  - SPEC-306
  - SPEC-308
related_adrs:
  - ADR-001
  - ADR-002
  - ADR-006
  - ADR-007
  - ADR-008
  - ADR-010
  - ADR-011
  - ADR-012
  - ADR-013
  - ADR-014
  - ADR-015
last_updated: 2026-08-03
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/full-spec-baseline/ARCHITECTURE_REVIEW.yaml
---

# SPEC-309: Agent Runtime Architecture

## 1. Purpose

The Agent Runtime is the deep module that executes governed Agent and Skill definitions while hiding planning-loop mechanics, context assembly, Tool dispatch, checkpoints, budgets, and provider variation behind a small runtime contract.

## 2. Responsibilities

- resolve immutable Agent, Skill, Prompt, rule, knowledge, Tool, and policy versions
- authorize the run and calculate the effective least-privilege envelope
- perform Discovery before requesting unavailable information
- build minimal, provenance-bearing, Workspace-scoped context
- execute deterministic rules before bounded reasoning
- select Skills and dispatch Tools only through contracts
- persist durable run state, checkpoints, approvals, and evidence
- enforce step, time, usage, cost, retry, concurrency, and side-effect budgets
- stop, recover, cancel, escalate, or terminate safely

The module SHALL NOT own product rules, provider SDKs, accepted knowledge, plugin implementation, or release decisions.

## 3. Execution Model

```text
Resolve → Authorize → Discover → Plan → Act → Observe → Validate → Decide
```

The `Plan → Act → Observe → Validate` segment may repeat only while progress is measurable and budgets permit. Every iteration has a stable step ID and records selected Skill, Tool intent, arguments, result reference, rule outcomes, evidence, and next-decision reason.

## 4. Context and State

Durable state contains facts needed to resume and audit. Ephemeral model context is reconstructed from durable references and SHALL not be the sole source of truth. Hidden model reasoning is neither required evidence nor accepted knowledge; externally checkable decisions and citations are.

## 5. Tool Safety

Tools are resolved through SPEC-510. Read-only discovery is preferred. Side effects require idempotency keys where supported; irreversible or high-consequence effects require prior approval and explicit evidence. Tool output is untrusted until validated.

## 6. Seams and Adapters

The runtime exposes one Agent Runtime contract. Provider, Tool, clock, identity, Knowledge Store, and external-system seams SHALL exist only where at least a production adapter and deterministic test/replay adapter justify substitution. Contract tests validate both through the same interface.

## 7. Failure and Recovery

Distinct failures include invalid definition, policy denial, unavailable dependency, context contamination, Tool rejection, provider failure, invalid output, budget exhaustion, no progress, cancellation, and checkpoint corruption. Recovery SHALL never repeat a non-idempotent side effect without verified outcome or approval.

## 8. Quality Gates

The architecture passes when deterministic operation can run without an LLM where applicable; all authority and budgets are enforced outside prompts; replay adapters reproduce Tool observations; cancellation and recovery preserve evidence; and no execution path can bypass Workspace isolation or Knowledge Candidate governance.

## 9. Configuration and Observability

Runtime configuration SHALL pin definition, contract, policy, Skill, Tool, prompt, provider, and schema versions and SHALL define iteration, time, token, cost, Tool-call, evidence, retry, and concurrency budgets. Changes use compatibility and migration review; in-flight runs retain their resolved versions. Metrics SHALL expose lifecycle duration, progress, budget use, Tool and policy outcomes, approvals, retries, no-progress termination, cleanup, evidence completeness, and failure class by Workspace with governed redaction.

## 10. Definition of Done

- the small runtime interface hides orchestration and provider mechanics
- deterministic/replay and production adapters pass the same contract suite
- durable checkpoints can resume without replaying unknown side effects
- every externally meaningful decision is attributable to policy and evidence
- no unresolved architecture decision blocks component implementation
