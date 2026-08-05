---
id: SPEC-508
title: Agent Runtime Contract
version: 1.2.0
status: accepted
owner:
  - Architecture
  - Runtime Platform
depends_on:
  - SPEC-108
  - SPEC-309
  - SPEC-505
  - SPEC-506
  - SPEC-507
related_adrs:
  - ADR-002
  - ADR-008
  - ADR-010
  - ADR-011
  - ADR-014
  - ADR-015
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
  - Codex Runtime Completion Change Review
approval_evidence: governance/reviews/requirement-review-tracer-bullet/RUNTIME_COMPLETION_CHANGE_IMPACT.yaml
---

# SPEC-508: Agent Runtime Contract

## 1. Purpose

This contract is the test surface for starting, observing, controlling, and completing a governed Agent run independent of model and Tool providers.

## 2. Operations

- `start(request) -> run_reference`
- `execute(run_reference, execution_with_context) -> final_result`
- `inspect(run_reference, access_context) -> run_snapshot`
- `result(run_reference, access_context) -> final_result`
- `approve(run_reference, approval_with_context) -> transition`
- `resume(run_reference, checkpoint_with_context) -> transition`
- `cancel(run_reference, cancellation_with_context) -> transition`
- `stream_events(run_reference, cursor, access_context) -> events`

Every read or control operation SHALL carry a trusted immutable Workspace context, explicit actor and policy identity, and an operation identifier. The runtime SHALL bind these claims to the run reference and authorize the operation-specific permission and exact run resource before reading state, returning events, changing lifecycle state, or emitting a new event. Execution authorization SHALL additionally cover the retained exact Agent, allowed Skills, allowed Tools, and input resource references.

`execute` is the only external command that asks the runtime to advance retained authorized input through Agent/Skill execution. It SHALL carry an expected revision and idempotency key but SHALL NOT accept caller-supplied output, verdict, evidence, cleanup status, lifecycle state, or final result. The runtime remains the sole lifecycle writer and invokes Skills through SPEC-509 and Tools through SPEC-510. `result` is a read operation and returns only the retained authoritative terminal result.

## 3. Start Request

The request SHALL contain operation and Workspace identity, a trusted immutable Workspace context carrying actor authority, exact Agent version, task purpose and consequence class, inputs by reference, allowed Skill/Tool constraints, an exact policy version pin, budgets, deadline, evidence requirements, and idempotency key. The runtime SHALL bind the request Workspace, actor, and policy to that context and SHALL obtain an authorization decision outside prompts before creating a run or emitting an authorization-granted event.

### 3.1 Default Budgets by Consequence Class

Per AP-064 (Context and Cost Efficiency, ADR-018), budgets SHALL have concrete
default values, not exist only as unquantified vocabulary. The runtime SHALL
apply the following default ceilings keyed by the request's consequence class
(SPEC-106, SPEC-308) unless an explicit suite-level or request-level policy
overrides them within governed bounds:

| Consequence class          | Max `Plan→Act→Observe→Validate` iterations | Token budget (reasoning input+output) | Tool-call budget | Wall-clock deadline |
|-----------------------------|:---:|:---:|:---:|:---:|
| Low (reversible, read-only) | 8   | 40,000  | 10 | 2 minutes  |
| Medium (reversible, side-effecting) | 20  | 150,000 | 40 | 10 minutes |
| High (irreversible or approval-gated) | 40  | 400,000 | 100 | 30 minutes |

A request MAY declare a stricter (lower) budget than its class default. A
request MAY exceed a class default only through an explicit, evidenced
override recorded at authorization time; the override itself SHALL be
retained as part of the run's evidence. These defaults bound cost; they do
not replace the evidence and completion-gate requirements of §4, which still
apply in full to medium- and high-consequence runs and in reduced form to
low-consequence runs under AP-063 (Proportional Rigor).

## 4. Snapshot and Result

Snapshots SHALL expose lifecycle state, current externally explainable objective, consumed budgets, pending approval, checkpoint, failure class, and evidence references. Final results SHALL include validated output, outcome, exact resolved versions, rule decisions, Skill and Tool usage, citations, uncertainty, policy events, usage, timings, and cleanup status.

Every terminal state SHALL retain a final result. A successful `execute` SHALL pass through `running` and `validating`; `completed` is impossible unless output validation, every retained evidence requirement, exact version retention, Skill/Tool allowlists, budget accounting, and cleanup outcome pass. Runtime completion means the governed execution completed; it SHALL NOT convert an advisory domain verdict such as `changes_required` or `indeterminate` into a runtime failure.

Per AP-063 (Proportional Rigor, ADR-018), a low-consequence run's `validating` phase MAY check a reduced evidence set (output validation, Skill/Tool allowlists, and cleanup outcome, but not full version-retention re-verification) while still producing a retained final result. Medium- and high-consequence runs SHALL always check the full set listed above.

Hidden chain-of-thought is excluded. Auditable decisions, observations, citations, and validation outcomes are required.

## 5. Guarantees

Duplicate starts with the same scope and idempotency key resolve to the same run. Duplicate executes with the same run, scope, idempotency key, and canonical command resolve to the same retained final result; reuse with changed input is an idempotency conflict. A run SHALL have one lifecycle writer: execution reserves the current revision before invoking an executor and SHALL NOT overwrite a concurrent cancellation or newer state. Late observations SHALL retain auditable attempt facts but SHALL NOT complete a run after its deadline. Execution requires the expected current revision and exact authority over the retained Agent, input references, and allowed Skill and Tool resources. Returned policy and used Skill/Tool versions SHALL be bound to retained exact version pins. Cancellation is monotonic. The runtime cannot widen permissions. Events are ordered per run or carry an explicit sequence gap. A terminal run and its result are immutable except for append-only audit annotations.

## 6. Conformance

Implementations SHALL pass contract tests for duplicate start, duplicate execute, concurrent execute, cancellation during execution, stale execute, result retrieval, policy denial, rejected approval, budget exhaustion, no progress, pre-execution and late-result timeout, resume, provider failure, Skill failure, Tool failure, invalid output, event replay, evidence completeness, cleanup, terminal-result schema conformance and immutability, and cross-Workspace denial.

## 7. Compatibility and Operations

Operations and envelopes SHALL be schema-versioned and size-bounded. Event payloads SHALL carry an exact payload-schema reference that is consistent with the event type. Version 1.1.0 adds `execute` and `result` without changing existing version 1.0.0 envelope or lifecycle meanings; there are no production consumers or in-flight runs requiring migration. Version 1.2.0 adds the default budget table (§3.1) and the proportional-rigor reduced evidence set (§4) as additive clarifications of existing budget and evidence vocabulary; it does not change any envelope shape and requires no migration. Additive optional observations may be compatible; changed lifecycle, authority, budget, effect, or verdict semantics require a major version and migration. Streaming or polling are transport choices and SHALL preserve the same canonical state. Metrics and traces expose correlation, resolved versions, lifecycle, budget, approval, failure, and cleanup without exposing secrets or hidden reasoning.
