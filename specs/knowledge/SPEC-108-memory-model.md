---
id: SPEC-108
title: Memory Model
version: 1.1.0
status: accepted
owner:
  - Knowledge Governance
  - AI Governance
  - Runtime Platform
depends_on:
  - SPEC-005
  - SPEC-101
  - SPEC-102
  - SPEC-103
  - SPEC-105
  - SPEC-106
  - GOV-006
  - GOV-007
  - GOV-009
related_adrs:
  - ADR-005
  - ADR-006
  - ADR-008
  - ADR-010
  - ADR-017
  - ADR-018
last_updated: 2026-08-05
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/memory-and-efficiency/CHANGE_IMPACT.yaml
---

# SPEC-108: Memory Model

## 1. Purpose

This specification defines Memory as the retrieval-layer architecture that
sits between runtime execution and the Knowledge Store, closing the gap left
by SPEC-001 naming Memory as an in-scope capability without an owning
component.

Memory retrieves and temporarily retains information for runtime use. It is
not a second source of authoritative truth. AP-003 ("Knowledge Before
Memory") governs this entire specification: memory SHALL NOT become
authoritative knowledge by construction, and long-term correctness SHALL NOT
depend on it.

## 2. Goals

- give the Agent Runtime a bounded, fast, Workspace-scoped place to retain
  and reuse information for the lifetime of a run or a short session
- provide a corpus-scale retrieval and ranking strategy so context assembly
  (SPEC-309, SPEC-308) stays bounded as a Workspace's accepted Knowledge
  Store grows
- provide a risk-tiered path for low-consequence observations to become
  reusable quickly, without weakening governance for anything that affects a
  verdict, rule, or policy
- keep every memory read and write traceable to a source, a Workspace, and a
  consequence classification
- require the Agent to actively decide what is worth retaining, so that
  retention is deliberate rather than an unbounded transcript
- distinguish project-scoped applicability from cross-project/global
  applicability for every retained candidate
- give repeated mistakes a fast, bounded path to become an avoidance fact,
  without letting an unreviewed single observation become a generalized rule

## 3. Non-Goals

Memory does not:

- store or represent authoritative Knowledge Objects (SPEC-102 owns this)
- replace the Knowledge Candidate lifecycle for anything above
  low-consequence classification (SPEC-105, AP-008 own this)
- retain raw conversation history, model scratchpad state, or full run
  transcripts as reusable state (SPEC-106 §6 already prohibits this; this
  spec does not relax it)
- perform pattern detection, drift detection, or hypothesis formation
  (SPEC-105 owns this)
- generalize a single project-scoped observation into a cross-project rule
  without SPEC-105's governed cross-Workspace learning flow (§4.3, §7.2)
- retain every observation by default; retention SHALL be a deliberate
  decision per §7.1, not an unbounded log of everything seen
- provide durable Agent Runtime state persistence (SPEC-401, SPEC-501, and
  the SPEC-606/607 lifecycle own durable state; Memory is a read-optimized
  layer in front of it, not a replacement for it)

## 4. Model Boundary

Memory has two tiers. Both are Workspace-scoped and both are non-
authoritative.

### 4.1 Working Memory (run-scoped)

Bounded state held for the lifetime of a single Agent run. Holds resolved
context assembled during `Resolve`/`Discover` (SPEC-309), retrieval results
already fetched from the Knowledge Store, and step-local intermediate facts.
Discarded when the run terminates unless explicitly promoted per §7.

### 4.2 Session Memory (short-TTL, Workspace-scoped)

Bounded state that outlives a single run but expires on an explicit,
configured TTL or explicit invalidation. Holds low-consequence observations
eligible for the fast promotion path in §7 (for example: a UI selector
observed in the last successful run, a transient environment fact, a recent
run's outcome summary for the same Workspace). Session Memory is never the
sole source of truth for a claim used in a verdict; any claim it supplies
SHALL be re-verifiable against its original source or SHALL be excluded from
consequence-bearing decisions.

Session Memory is distinct from, and SHALL NOT be confused with, the
Knowledge Store's accepted Knowledge Objects. It has no review workflow of
its own beyond the audit log and async review required by §7.

### 4.3 Applicability Scope

Every candidate for retention SHALL be classified along a second, independent
dimension from consequence classification (§7): applicability scope.

- **Project-scoped**: applies only to the originating Workspace (for
  example: a selector, an endpoint path, a fixture value, a defect pattern
  specific to one codebase). Default classification for every candidate
  unless evidence supports a broader scope.
- **Cross-project / global**: applies beyond the originating Workspace (for
  example: a testing heuristic, a class of mistake, a technique that
  generalizes across codebases and business domains). SHALL NOT be inferred
  from a single observation; it SHALL require repeated corroboration across
  more than one Workspace or an explicit generalization step, both handled
  by SPEC-105 §11 (cross-Workspace learning requires explicit governance).

A candidate's applicability scope SHALL be decided independently of its
consequence classification: a project-scoped observation can be
high-consequence (a business rule specific to one client), and a
cross-project observation can be low-consequence (a generally useful
exploratory-testing heuristic). Memory SHALL NOT promote any candidate to
cross-project/global applicability through the §7 fast path — only
project-scoped, low-consequence candidates are eligible for the fast path.
Cross-project candidates of any consequence level SHALL follow SPEC-105's
governed cross-Workspace learning flow.

## 5. Inputs

Permitted inputs to Memory include:

- context and retrieval results already produced during the current run's
  `Resolve`/`Discover` stages (SPEC-309)
- query results already returned by the Knowledge Store (SPEC-103, SPEC-501)
- observations carrying a consequence classification (SPEC-106, SPEC-308)
- prior Session Memory entries that have not expired

Memory SHALL NOT accept raw conversation transcripts, unscoped model output,
or any input lacking Workspace identity and provenance.

## 6. Retrieval and Ranking at Scale

As a Workspace's accepted Knowledge Store grows, "Assemble Minimal Context"
(SPEC-308 §"Assemble Minimal Context", SPEC-309) SHALL remain bounded. Memory
extends the ranking factors already defined by SPEC-103 (authority,
applicability, semantic relevance, recency, evidence quality, review status)
with an explicit selection strategy:

- a maximum candidate-set size SHALL be enforced before ranking, not after
- ranking SHALL be deterministic given the same inputs, ranking version, and
  Workspace snapshot
- when the ranked candidate set still exceeds the context budget (SPEC-508),
  Memory SHALL select the highest-ranked subset and SHALL record what was
  excluded and why, rather than silently truncating
- corpus-level summarization (summarizing across many Knowledge Objects, as
  opposed to SPEC-102's per-object summaries) MAY be used only when the
  summary links back to every exact source object it draws from, consistent
  with SPEC-102's existing summary-provenance requirement

## 7. Save Decision Policy and Risk-Tiered Promotion Path

Memory is not a transcript. The Agent SHALL actively decide, for every
candidate observation, whether it is retained at all — retention is never
the default, and "nothing worth reusing happened" is a valid, expected
outcome for most steps.

### 7.1 Save Decision Criteria

A candidate SHALL be evaluated against all of the following before it is
retained at any tier:

- **Reuse likelihood**: is this fact plausibly needed again in this
  Workspace or across Workspaces (§4.3), or is it one-off and only relevant
  to the current step? One-off facts SHALL NOT be retained beyond Working
  Memory.
- **Novelty**: does this contradict, refine, or confirm an existing
  Knowledge Object, Session Memory entry, or prior recorded mistake (§7.3)?
  A candidate that merely repeats an already-retained fact SHALL NOT create
  a duplicate entry; it SHALL reinforce the existing entry's confidence and
  recency instead.
- **Cost of being wrong**: combines consequence classification (SPEC-106,
  SPEC-308) with how easily the entry can be invalidated later (§9). A fact
  that is cheap to verify on reuse and cheap to invalidate if stale is
  favored for retention over one that is expensive to verify.
- **Provenance sufficiency**: a candidate lacking a resolvable source
  reference or Workspace identity SHALL NOT be retained (§5, §9), regardless
  of how useful it appears.

A candidate that fails the reuse-likelihood or provenance-sufficiency
criteria SHALL be discarded at run end with no retention decision recorded
beyond the run's own step evidence. This is the expected outcome for the
majority of Working Memory content per §4.1.

### 7.2 Risk-Tiered Promotion Path

For candidates that pass §7.1, reusing the consequence classification
already defined by SPEC-106/SPEC-308:

- **Low-consequence, reversible, project-scoped observations** (for example:
  a UI selector, a transient configuration value, a non-authoritative
  environment fact) MAY be auto-promoted from Working Memory into Session
  Memory without synchronous human approval, provided the promotion is
  audit-logged with source, Workspace, timestamp, classification, and
  applicability scope, and is subject to a mandatory asynchronous review
  consistent with SPEC-105 §12's human-oversight expectations.
- **Medium- and high-consequence observations, and any cross-project/global
  candidate regardless of consequence** (anything affecting a business rule,
  policy, test verdict, release decision, or claiming applicability beyond
  the originating Workspace) SHALL NOT use this path. They SHALL follow the
  full Knowledge Candidate lifecycle (SPEC-102, SPEC-105, AP-008) unchanged
  before any reuse beyond the current run.
- A promotion SHALL be reversible: async review MAY reject a Session Memory
  entry, which SHALL immediately invalidate it for future reads without
  requiring a running Agent to be interrupted mid-step.

### 7.3 Failure-Avoidance Retention

A specific, mandatory case of §7.1: when a run's outcome is a defect,
incorrect verdict, blocked/failed execution, or a human-corrected Agent
decision, the Agent SHALL evaluate the causal mistake (not merely the
symptom) as a save candidate, so the same avoidable error is not repeated in
a later run. This candidate follows the same §7.2 tiering — a project-scoped,
low-consequence mistake (for example, "this endpoint requires header X that
was omitted") is eligible for the fast path into Session Memory; a mistake
that reveals a generalizable testing gap (for example, "boundary values were
never checked for this input class") is a cross-project candidate and SHALL
follow SPEC-105's Learning Engine workflow, which owns pattern detection and
recurrence prevention across runs (SPEC-105 §6, §9). Memory retains the
avoidance fact for fast reuse; SPEC-105 owns turning a recurring pattern of
such facts into a governed, generalized improvement.

## 8. Workspace Isolation

- Working Memory and Session Memory SHALL be scoped to exactly one
  Workspace; no entry is readable outside its owning Workspace.
- Memory SHALL NOT be the mechanism by which cross-Workspace learning
  occurs; cross-Workspace learning remains governed exclusively by SPEC-105
  §11.
- Session Memory SHALL be invalidated, not silently retained, when a
  Workspace is deleted, exported, or re-imported (consistent with ADR-017
  §4 Workspace/user isolation).

## 9. Failure Handling

Memory SHALL fail safe (return no result rather than a stale or
misattributed one) when:

- Workspace scope is ambiguous or unverified
- an entry's source reference no longer resolves
- an entry's TTL has expired
- ranking version or Workspace snapshot version cannot be determined
- a consequence classification cannot be established for a proposed
  promotion

A Memory failure SHALL cause the caller to fall back to a direct Knowledge
Store query or to proceed without the memory shortcut; it SHALL NOT block
the run outright unless the underlying data was required and unavailable
from any source.

## 10. Relationship to Other Components

- **Knowledge Store (SPEC-103/SPEC-401/SPEC-501)**: source of authoritative,
  durable Knowledge Objects. Memory reads from it and MAY cache its results;
  Memory never writes to it directly — only the governed Knowledge Candidate
  lifecycle does.
- **Learning Engine (SPEC-105)**: owns pattern/drift detection and the
  Knowledge Candidate promotion workflow for anything above low-consequence
  classification. Memory's §7 fast path is a narrower, bounded complement to
  SPEC-105, not a substitute for it.
- **Agent Runtime (SPEC-309) and Reasoning Engine (SPEC-308)**: consume
  Memory during `Resolve`/`Discover`/`Assemble Minimal Context`. AP-064
  (Context and Cost Efficiency, ADR-018) requires reuse of Working Memory
  within a run when underlying durable references are unchanged.
- **Agent Runtime Contract (SPEC-508)**: Memory reads/writes count against
  the budget table introduced by ADR-018; Memory reduces cost by avoiding
  redundant retrieval, it does not exempt a run from its budget.

## 11. Observability

Memory SHALL report:

- working/session entry counts by Workspace and consequence tier
- promotion, expiry, and rejection rates for Session Memory
- cache/reuse hit rate within a run (supports AP-064 verification)
- ranking candidate-set size and exclusion counts at scale
- failure-safe fallback rate

## 12. Quality Gates

Memory passes when:

- no Working or Session Memory entry is treated as authoritative knowledge
  without passing the applicable promotion path
- every entry retains Workspace identity and provenance
- low-consequence promotion is audit-logged and asynchronously reviewable
- medium/high-consequence observations cannot bypass the full Knowledge
  Candidate lifecycle through Memory
- retrieval ranking at scale is deterministic and bounded
- failure handling never silently returns stale or cross-Workspace data
- a candidate lacking reuse likelihood or provenance is discarded rather than
  retained by default (§7.1)
- every retained candidate carries an explicit applicability scope decision,
  and no candidate reaches cross-project/global scope through the fast path
  (§4.3, §7.2)
- a defect, incorrect verdict, or human-corrected decision produces an
  evaluated failure-avoidance candidate, tiered per §7.2/§7.3

## 13. Definition of Done

- Working Memory and Session Memory tiers are implemented as described, with
  Session Memory backed by a Workspace-scoped, TTL-bounded store
- the risk-tiered promotion path enforces consequence classification before
  allowing async-only review
- SPEC-309/SPEC-308 context assembly consumes Memory instead of
  reconstructing Knowledge Store queries on every iteration when durable
  references are unchanged
- corpus-scale ranking is exercised against a Workspace with a large
  accepted Knowledge Store and remains bounded and deterministic
- simulated stale-reference, expired-TTL, cross-Workspace, and
  unclassifiable-consequence cases fail safe per §9
- a simulated repeated mistake (same defect class recurring across runs in
  one Workspace) is retained as a project-scoped avoidance fact and is
  observably reused to avoid repeating the mistake in a later run
- a simulated single-Workspace observation cannot be promoted to
  cross-project/global applicability without SPEC-105's governed flow

## 14. Summary

Memory is the bounded, non-authoritative retrieval and short-term retention
layer between runtime execution and the Knowledge Store. It makes reuse fast
and cheap for what is safe to reuse quickly, requires the Agent to actively
decide what is worth keeping rather than retaining everything, separates
what applies to one project from what generalizes across projects, and gives
mistakes a fast path to becoming avoidance facts — while leaving everything
that could affect a verdict, rule, or policy, or that claims broader
applicability, inside the same governed promotion path the system already
trusts.
