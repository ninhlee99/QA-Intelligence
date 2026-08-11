---
id: ADR-018
title: Memory Architecture, Proportional Rigor, and Cost/Latency Efficiency
status: accepted
version: 1.0.0
date: 2026-08-05
decision_owners:
  - Repository Owner
  - Architecture
  - Runtime Platform
  - Product Governance
related_specs:
  - SPEC-001
  - SPEC-005
  - SPEC-103
  - SPEC-105
  - SPEC-106
  - SPEC-108
  - SPEC-206
  - SPEC-207
  - SPEC-209
  - SPEC-210
  - SPEC-213
  - SPEC-308
  - SPEC-309
  - SPEC-310
  - SPEC-501
  - SPEC-508
related_adrs:
  - ADR-002
  - ADR-005
  - ADR-006
  - ADR-008
  - ADR-010
  - ADR-015
  - ADR-016
  - ADR-017
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit efficiency and memory-gap review request
  - Codex Architecture and Change-Impact Review
approval_evidence: governance/reviews/memory-and-efficiency/CHANGE_IMPACT.yaml
---

# ADR-018: Memory Architecture, Proportional Rigor, and Cost/Latency Efficiency

## 1. Context

A full audit of the accepted specification baseline (governance/reviews/memory-and-efficiency/CHANGE_IMPACT.yaml
records the review) found the corpus consistently optimizes for auditability and
safety at every decision point, with no counterweight requiring the system to
also be fast, cheap, or capable of retaining working knowledge across runs.
Four concrete gaps were confirmed by direct reading of the specs, not
inference from implementation:

1. **No performance or cost goal exists anywhere in the foundation layer.**
   SPEC-001's Core Principles and governance/ARCHITECTURE_PRINCIPLES.md define
   evidence, explainability, Workspace isolation, and controlled learning as
   non-negotiable, but never state that a run should be proportionally fast or
   cheap. Every architecture spec downstream therefore defaults to
   maximal-audit-trail execution with no lever to trade against.
2. **No numeric budgets exist.** "Token budget," "cost budget," and "time
   budget" appear as bare vocabulary in SPEC-309, SPEC-310, SPEC-213, and
   SPEC-508, but no spec states a default value, a formula, or a table keyed
   by risk. SPEC-508, the natural home for a concrete budget contract, only
   states budgets "SHALL" be carried, not what they are.
3. **"Memory" is a named Scope item in SPEC-001 with zero owning
   specification.** Knowledge Store, Rule Engine, Learning Engine, and
   Ontology each have two to three dedicated specs at increasing concreteness
   (SPEC-101/103/401/501, SPEC-104/402/502, SPEC-105, SPEC-101/408). Memory
   has only a negative definition scattered across the glossary (SPEC-005),
   SPEC-002 Principle 3, AP-003, and one paragraph in SPEC-106 §6 — all of
   which say what memory is *not* (not knowledge, not conversation history)
   without ever specifying a retrieval-layer architecture, a working/session
   tier, a TTL, or a corpus-scale selection strategy. This is a Single
   Source of Truth gap under the corpus's own AP-006.
4. **Every stage and every unit of evidence is mandatory regardless of
   consequence.** SPEC-106 and SPEC-308 already define a consequence
   classification used to scope permitted Tools and approval authority, but
   no spec allows that same classification to reduce pipeline stages or
   evidence weight for low-consequence operations. A trivial, reversible
   Discovery read pays the same eight-stage runtime loop, eight-stage
   reasoning sub-loop, and two-phase `running`→`validating` completion gate
   as an irreversible production mutation.

The same review also found two smaller Single-Source-of-Truth fragmentations
worth correcting in the same change: "AI/Agent adversarial testing coverage"
is independently enumerated with non-identical lists in SPEC-206 §9, SPEC-107
§5, and SPEC-213 §3; and "flaky" test-execution semantics are defined
piecemeal across SPEC-209, SPEC-210, and SPEC-107 with no canonical owner.

This ADR does not weaken evidence, Workspace isolation, controlled learning
(ADR-010), or the Rule-Before-LLM precedence (ADR-002). It adds a missing
counterweight and a missing component, using the same governed-promotion
pattern already established by ADR-005 (Knowledge Candidate Lifecycle) and
ADR-010 (Controlled Learning).

## 2. Decision

### 2.1 Performance and cost become explicit product goals

SPEC-001 SHALL state that every governed operation is executed with rigor
*proportional to its consequence*, and that the system SHALL minimize token,
time, and Tool-call cost within that proportional bound. This is a new
foundation-level goal, not a relaxation of any existing principle — it
constrains architecture specs to justify cost, not to skip evidence.

### 2.2 Proportional Rigor (new architecture principle)

A new Architecture Principle (AP-063, "Proportional Rigor") establishes: the
number of runtime-loop stages executed, the volume of evidence retained, and
the strictness of the completion gate SHALL scale with the operation's
consequence class (already defined by SPEC-106/SPEC-308). Low-consequence,
reversible, read-only operations MAY use a reduced-stage fast path that still
records a stable step ID, selected Skill/Tool, and outcome, but MAY omit the
full evidence-completeness and version-pinning re-verification required for
medium/high-consequence operations. High-consequence and irreversible
operations are unaffected and SHALL continue to pay the full pipeline defined
by SPEC-309/SPEC-308/SPEC-508.

### 2.3 Context and Cost Efficiency (new architecture principle)

A second new Architecture Principle (AP-064, "Context and Cost Efficiency")
requires: within the correctness and provenance bounds already set by AP-060,
implementations SHALL reuse already-assembled reasoning context and already
-retrieved Knowledge Store results within the lifetime of a single Agent run
where the underlying durable references have not changed, rather than
reconstructing context from scratch on every `Plan→Act→Observe→Validate`
iteration. SPEC-508 SHALL carry a concrete default budget table (token, time,
Tool-call ceilings) keyed by consequence class, replacing the current
bare-vocabulary budget references.

### 2.4 Memory becomes a first-class, separately specified component

A new knowledge-layer specification, SPEC-108 (Memory Model), SHALL define
Memory as the retrieval-layer architecture that SPEC-001 already scopes it to
be:

- a **working/session memory tier**: bounded, Workspace-scoped, run-lifetime
  or short-TTL state that is cheaper to retain and reuse than a full Knowledge
  Candidate, used for facts like "recent run outcomes in this Workspace" or
  "a selector observed in the last successful run" — without becoming
  authoritative knowledge and without bypassing SPEC-102/AP-008 promotion for
  anything that should outlive the session;
- a **corpus-scale retrieval and ranking strategy** for when a Workspace's
  accepted Knowledge Objects grow large, extending SPEC-103's existing
  ranking factors (authority, applicability, semantic relevance, recency,
  evidence quality, review status) with an explicit selection/compaction
  approach so "Assemble Minimal Context" remains bounded as the corpus grows;
- a **risk-tiered promotion fast path**: reusing the consequence
  classification from §2.2, a low-consequence, easily-reversible observation
  (for example, a UI selector or a config value obtained through Discovery)
  MAY be auto-promoted into the working tier with full audit logging and a
  mandatory async review, instead of requiring synchronous human approval
  before any reuse. High-consequence knowledge (business rules, policy,
  anything affecting test verdicts) SHALL continue to require the full
  Knowledge Candidate lifecycle (SPEC-102, SPEC-105, AP-008) unchanged.

SPEC-108 does not replace Knowledge Store (SPEC-103/SPEC-401/SPEC-501); it
specifies the retrieval and session-memory layer that sits in front of it,
exactly as the glossary already implied ("Memory is a retrieval layer").
AP-003 ("Knowledge Before Memory") is preserved without modification: memory
still SHALL NOT become authoritative knowledge on its own, and long-term
correctness still SHALL NOT depend on conversational context.

### 2.5 Single-Source-of-Truth corrections

- SPEC-213 becomes the canonical owner of "AI/Agent adversarial testing
  coverage dimensions." SPEC-206 §9 and SPEC-107 §5 SHALL reference SPEC-213
  instead of independently enumerating the list. SPEC-213's list SHALL be
  expanded to the union of what was previously fragmented across all three
  specs, including prompt injection, tool-selection/argument/permission/
  side-effect correctness, and sensitive-data handling.
- SPEC-210 becomes the canonical owner of the execution-outcome vocabulary,
  including a new first-class `flaky` outcome distinct from `indeterminate`
  and `infrastructure_error`. SPEC-209 (quarantine policy) and SPEC-107
  (variance measurement) SHALL reference SPEC-210's definition instead of
  redefining it.

## 3. Deployment and Scope

This ADR affects specification text only. It does not change ADR-017's
local-first SQLite/PostgreSQL decision, ADR-016's MCP host-integration
decision, or ADR-015's tracer-bullet exclusions. The Requirement Review
tracer bullet MAY adopt the fast path and working-memory tier once SPEC-108
and the amended SPEC-309/SPEC-508 are implemented, but is not required to
before GOV-012 evidence for its current scope is produced.

## 4. Consequences

- Runs classified as low-consequence become measurably cheaper and faster
  once implemented, without weakening evidence for medium/high-consequence
  operations.
- SPEC-508 gains a concrete, testable budget contract instead of an abstract
  one, closing a gap that made "budget compliance" unverifiable.
- Cross-run reuse of low-stakes observations no longer requires the same
  synchronous governance weight as a business-rule change, while
  high-consequence knowledge promotion is untouched.
- A new spec (SPEC-108) and two new architecture principles (AP-063, AP-064)
  add surface area to review and maintain; this is accepted because the
  alternative — leaving "Memory" permanently unspecified and every operation
  permanently maximal-rigor — was assessed as a larger long-term risk to both
  the product's stated differentiation ("continuously learn") and to
  operating cost.
- SPEC-206, SPEC-107, and SPEC-209 lose local detail in favor of referencing
  SPEC-213/SPEC-210, reducing drift risk at the cost of one extra
  cross-reference hop for readers.

## 5. Alternatives Considered

- **Leave budgets abstract and let suite-level policy specs define numbers
  later** was rejected because no suite-level policy spec currently exists or
  is scheduled, so "later" had no owner or trigger; a default table in
  SPEC-508 is overridable by suite-level policy, not blocked by its absence.
- **Fold Memory into SPEC-103 (Knowledge Store) instead of a new spec** was
  rejected because Knowledge Store is durable-object-of-record semantics
  governed by full promotion lifecycle, while Memory is explicitly a
  lighter-weight retrieval/session layer in front of it; merging them risks
  re-introducing the exact "conversation as knowledge" conflation AP-003
  exists to prevent.
- **Apply proportional rigor by exempting entire Skills instead of scaling by
  consequence class per operation** was rejected because it would let a
  mostly-low-risk Skill skip rigor on an occasional high-consequence step;
  scaling per-operation using the existing consequence classification keeps
  the same unit of authorization already used for Tool/approval scoping.
- **Do nothing and accept the current governance-heavy default** was
  rejected per the explicit Repository Owner request that spec and system
  performance, cost, correctness, and memory be improved without changing
  the underlying goal of a fully autonomous, comprehensive test agent.

## 6. Validation

- a Discovery-only, read-only, reversible operation completes with fewer
  recorded stages and less evidence volume than a production-mutating
  operation of the same Skill, while both remain traceable to a stable step
  ID and outcome
- SPEC-508's budget table produces a default token/time/Tool-call ceiling for
  a given consequence class without requiring a suite-level override to exist
- two successive `Plan→Act→Observe→Validate` iterations within one run reuse
  previously assembled context/retrieval results when their underlying
  durable references are unchanged, and re-resolve when they are not
- a low-consequence observation (for example, a UI selector) becomes
  available for reuse in the working-memory tier without synchronous human
  approval, is audit-logged, and does not affect any test verdict or
  business rule
- a high-consequence observation still requires the full Knowledge Candidate
  lifecycle before reuse
- SPEC-206, SPEC-107, and SPEC-209 no longer contain independently
  enumerated AI-testing-coverage or flaky-outcome definitions that conflict
  with SPEC-213 or SPEC-210
