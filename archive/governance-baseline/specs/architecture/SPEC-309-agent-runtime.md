---
id: SPEC-309
title: Agent Runtime Architecture
version: 1.1.0
status: accepted
owner:
  - Architecture
  - AI Governance
depends_on:
  - SPEC-106
  - SPEC-108
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
  - ADR-017
  - ADR-013
  - ADR-014
  - ADR-015
  - ADR-018
last_updated: 2026-08-05
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
- build minimal, provenance-bearing, Workspace-scoped context, reusing Working Memory (SPEC-108) within a run instead of reconstructing it on every iteration when underlying durable references are unchanged
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

Per AP-063 (Proportional Rigor, ADR-018), the number of stages executed and the evidence volume recorded SHALL scale with the operation's consequence class (SPEC-106, SPEC-308). A low-consequence, reversible, read-only step MAY use a reduced-stage fast path that still records a stable step ID, the selected Skill/Tool, and the outcome, but MAY omit full evidence-completeness and version-pinning re-verification. Medium- and high-consequence or irreversible steps SHALL always execute the full model above.

## 4. Context and State

Durable state contains facts needed to resume and audit. Ephemeral model context is reconstructed from durable references and SHALL not be the sole source of truth. Hidden model reasoning is neither required evidence nor accepted knowledge; externally checkable decisions and citations are.

Per AP-064 (Context and Cost Efficiency, ADR-018), reconstruction SHALL reuse Working Memory (SPEC-108) and already-retrieved Knowledge Store results within the lifetime of a single run when their underlying durable references have not changed, rather than re-resolving them on every iteration. A change to an underlying reference invalidates reuse and forces re-resolution.

## 5. Tool Safety

Tools are resolved through SPEC-510. Read-only discovery is preferred. Side effects require idempotency keys where supported; irreversible or high-consequence effects require prior approval and explicit evidence. Tool output is untrusted until validated.

## 6. Seams and Adapters

The runtime exposes one Agent Runtime contract. Provider, Tool, clock, identity, Knowledge Store, and external-system seams SHALL exist only where at least a production adapter and deterministic test/replay adapter justify substitution. Contract tests validate both through the same interface.

In the default local profile, one OS-user-owned parent runtime holds the active
Workspace owner lease, owns SQLite access, and coordinates bounded child
workers. Child agents and test workers return observations through runtime
interfaces and SHALL NOT advance authoritative state or open Workspace storage
directly. Shared PostgreSQL operation is an optional deployment adapter and
cannot change runtime semantics.

## 7. Failure and Recovery

Distinct failures include invalid definition, policy denial, unavailable dependency, context contamination, Tool rejection, provider failure, invalid output, budget exhaustion, no progress, cancellation, and checkpoint corruption. Recovery SHALL never repeat a non-idempotent side effect without verified outcome or approval.

## 8. Quality Gates

The architecture passes when deterministic operation can run without an LLM where applicable; all authority and budgets are enforced outside prompts; replay adapters reproduce Tool observations; cancellation and recovery preserve evidence; and no execution path can bypass Workspace isolation or Knowledge Candidate governance.

## 9. Configuration and Observability

Runtime configuration SHALL pin definition, contract, policy, Skill, Tool, prompt, provider, and schema versions and SHALL define iteration, time, token, cost, Tool-call, evidence, retry, and concurrency budgets, using the concrete default table keyed by consequence class defined in SPEC-508. Changes use compatibility and migration review; in-flight runs retain their resolved versions. Metrics SHALL expose lifecycle duration, progress, budget use, Tool and policy outcomes, approvals, retries, no-progress termination, cleanup, evidence completeness, and failure class by Workspace with governed redaction.

## 10. Definition of Done

- the small runtime interface hides orchestration and provider mechanics
- deterministic/replay and production adapters pass the same contract suite
- durable checkpoints can resume without replaying unknown side effects
- every externally meaningful decision is attributable to policy and evidence
- no unresolved architecture decision blocks component implementation
