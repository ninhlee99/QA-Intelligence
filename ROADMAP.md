# QA Intelligence Roadmap

## Documentation Baseline

```text
Foundation                  accepted
Governance                  GOV-001–012 accepted
Architecture Decisions      ADR-001–018 accepted
Knowledge Specifications    SPEC-101–108 accepted
Product Specifications      SPEC-201–213 accepted
Architecture Specifications SPEC-301–310 accepted
Interface Specifications    SPEC-501–511 accepted
Component Specifications    SPEC-401–411 accepted
Runtime Specifications      SPEC-601–607 accepted
Meta and indexes             accepted and validated
Ontology and schemas         accepted and validated
Rules and reference          accepted baseline
Playbooks and AI guidance    accepted baseline
```

## Persistence Architecture Note

Persistence is local-first per ADR-017 (2026-08-03), superseding ADR-012's
PostgreSQL-only assumption. The default profile is one SQLite database per
Workspace owned by a single local parent runtime; PostgreSQL remains an
optional adapter for the shared/team profile only. A provider-neutral
`EvaluationCampaignRecordStore` seam, a working `SqliteEvaluationCampaignRecordStore`
(via Node's `node:sqlite`), and a `PersistedEvaluationCampaignRepository`
already exist and pass the shared contract suite. The PostgreSQL adapter now
also has a real `pg`-driver `PgTransactionManager` proven against a local
PostgreSQL 18 server: the shared contract suite, a concurrent-writer race,
Row-Level Security enforcement under a non-superuser application role, and
state survival across a fresh transaction manager (restart-equivalent) all
pass. Production identity (OIDC), a hosted/managed database target, and
worker-loss conformance remain pending, consistent with step 5 below. A
parallel `AgentRunRecordStore` seam and `SqliteAgentRunRecordStore` now give
Agent Run state (not just Evaluation Campaign state) the same durable,
contract-tested persistence path. `InMemoryAgentRuntime` is now composed
through this seam via `PersistedAgentRuntime`
(`src/runtime/persisted-agent-runtime.ts`): a completed-command hook mirrors
final state into the store without duplicating the state machine, and
`restore()` proves a run started in one process is inspectable, and can be
cancelled, from a fresh process backed by the same SQLite file — a real
restart-survival test, not a mock. Fixing this also surfaced and corrected
two assumptions in `SqliteAgentRunRecordStore` that had never been exercised
against a real `InMemoryAgentRuntime`-produced record: a `start` command's
initial revision is not always `1`, and event count is not always equal to
revision. A `PostgresAgentRunRecordStore`
(`src/runtime/postgres-agent-run-record-store.ts`) now gives Agent Run state
the same optional shared/team-profile PostgreSQL adapter path the Evaluation
Campaign aggregate already has, reusing the existing generic
`PostgresTransactionManager`/`PgTransactionManager` seam as-is. Unlike the
Evaluation Campaign aggregate, the Agent Run seam carries no outbox intent,
so the adapter and its migration
(`migrations/postgresql/0002_agent_run_store.up.sql`) retain only the run,
event, and command tables plus Workspace RLS. It passes the same shared
`runAgentRunRecordStoreContract` suite as `SqliteAgentRunRecordStore`, both
against an in-process fake (`tests/runtime/fake-postgres-transaction-manager.ts`)
and, gated on `QA_INTELLIGENCE_TEST_POSTGRES_URL`, against a real server via
`tests/runtime/agent-run-record-store.real.test.ts` (concurrent-writer,
RLS-without-scope, and restart-survival cases, mirroring the Evaluation
Campaign real-driver suite) — this real-server path has now been run against
a live PostgreSQL 18 instance under a non-superuser application role
(`qa_intelligence_app`), all 23 real-driver cases across both aggregates
passing, so the same restart/concurrency/RLS conformance the Evaluation
Campaign PostgreSQL adapter proved now also holds for Agent Run state.

ADR-012 §7 and SPEC-505 §7 required a transactional outbox with explicit
claim, retry, and dead-letter handling, but only the producer half (atomic
outbox-intent commit inside `PostgresEvaluationCampaignRecordStore`'s own
transaction) previously existed — nothing claimed, published, retried, or
dead-lettered a row afterward. A provider-neutral `OutboxPublisher` seam
(`src/evaluation/outbox-publisher.ts`) now defines that consumer half:
`claimBatch` leases a bounded batch of unpublished, unleased-or-expired rows
(PostgreSQL via `FOR UPDATE SKIP LOCKED` so concurrent workers partition
instead of double-claim, ADR-012 §7), `markPublished` finalizes one claimed
event, and `markFailed` either schedules a backoff retry or — at
`max_attempts` — dead-letters the row into a new terminal state migration
`0003_outbox_dead_letter` adds (`dead_lettered_at`, mutually exclusive with
`published_at`). Because the outbox worker is a platform-level publisher
across every Workspace rather than a Workspace-scoped caller, it runs under
a dedicated `qa_intelligence_outbox_worker` database role that migration
0003 grants a table-wide RLS policy — not the Workspace-scoped application
role, and not a superuser. `SqliteOutboxPublisher` and
`PostgresOutboxPublisher` both pass a shared
`runOutboxPublisherContract` suite (claim atomicity, lease-expiry reclaim,
duplicate-delivery prevention, retry-vs-dead-letter, batch bounding), and a
real-driver suite (`tests/evaluation/outbox-publisher.real.test.ts`, gated
on both `QA_INTELLIGENCE_TEST_POSTGRES_URL` and
`QA_INTELLIGENCE_TEST_POSTGRES_OUTBOX_WORKER_URL`) proves a row committed by
the application-role producer is claimable and publishable by the
worker-role consumer, that two concurrent workers never double-claim the
same row, and that the application role cannot see outbox rows outside its
own Workspace-scoped query — all verified against a live local PostgreSQL 18
instance, run 5 consecutive times with zero flakes after fixing a shared
same-database interference issue (draining ahead of a target event instead
of assuming it lands in the first bounded claim batch). OIDC/internal
authorization remains the one open item from ADR-012 §7's original
validation list.

ADR-014/SPEC-506 §7 required the production identity adapter to pass the
same validation vectors as the deterministic identity fixtures, but only the
deterministic `DeterministicWorkspaceAuthorizer` (`src/adapters/deterministic/workspace-authorizer.ts`)
existed — its cryptographic proof check was deliberately left to an injected
`WorkspaceIntegrityProofVerifier` seam rather than substitute crypto. A
production `JwksWorkspaceIntegrityProofVerifier`
(`src/adapters/oidc/jwks-integrity-proof-verifier.ts`, using `jose`) now
implements that seam: it treats `integrity_proof` as a compact JWT signed by
the Workspace Manager's identity provider, verifies signature, issuer,
audience, and expiry against a remote JWKS (rotation handled by re-fetching
on an unknown `kid`), and only then compares the verified payload's
`canonical_claims` against the caller-supplied canonical claims — denying
rather than throwing or defaulting to allow on any mismatch, decode error,
expiry, or unreachable JWKS endpoint. Because a real verifier needs a
network round trip, `WorkspaceIntegrityProofVerifier.verify` was widened
from `boolean` to `boolean | Promise<boolean>` and
`DeterministicWorkspaceAuthorizer.authorize` now genuinely awaits it instead
of wrapping every branch in `Promise.resolve` — a mechanical control-flow
change with no effect on any existing deny/allow decision. The prior
`tests/adapters/workspace-authorizer.test.ts` assertions were extracted into
a shared `runWorkspaceAuthorizerContract` suite
(`tests/adapters/workspace-authorizer-contract.ts`), matching the
record-store/outbox seams' existing "one suite, many adapters" pattern, so
both the deterministic and OIDC/JWKS adapters are proven against the same
17-case vector set. A real-driver test
(`tests/adapters/jwks-integrity-proof-verifier.real.test.ts`) mints its own
ephemeral RSA keypair and serves its own local JWKS HTTP endpoint — no
external identity provider or environment variable is needed, so it runs
unconditionally in `npm test` — and additionally proves rejection of an
unknown signing key, an expired token, a wrong issuer, a wrong audience, and
an unreachable JWKS endpoint, plus acceptance of a freshly rotated key once
published. This closes the "production OIDC verifier" implementation gap for
the integrity-proof-verification seam specifically; OIDC discovery, the
Authorization Code + PKCE interactive login flow, and constructing a trusted
`WorkspaceContext` from raw IdP claims remained the Workspace Manager's
responsibility (SPEC-306/406).

The claims-to-context half of that responsibility is now also implemented.
A `WorkspaceContextIssuer` seam (`src/requirement-review/public.ts`) defines
`issue()` from an already-obtained identity token to a
`WorkspaceContextIssuanceResult`. `OidcWorkspaceContextIssuer`
(`src/adapters/oidc/workspace-context-issuer.ts`) verifies that token's
signature, issuer, audience, and expiry against a remote JWKS (the same
`jose` primitives as the integrity-proof verifier), resolves Workspace
membership/roles/permissions/policy for its subject through an injected
`WorkspaceMembershipResolver` seam, denies if the actor has no membership in
the target Workspace or the Workspace is suspended (SPEC-406 §4's
suspended-Workspace invariant), and — only once every check passes — signs a
fresh `integrity_proof` with the Workspace Manager's own key (distinct from
the upstream IdP's key) over `canonicalWorkspaceIntegrityClaims`, reusing
the same canonicalization the verifier already checks against. A
`DeterministicWorkspaceContextIssuer` pairs with it as ADR-014 §2's required
"deterministic signed-claims test adapter." Both pass a shared
`runWorkspaceContextIssuerContract` suite
(`tests/adapters/workspace-context-issuer-contract.ts`), and a real-driver
test (`tests/adapters/oidc-workspace-context-issuer.real.test.ts`) mints two
independent local JWKS endpoints — one standing in for the upstream IdP, one
for the Workspace Manager's own key — and proves the issued
`integrity_proof` round-trips successfully through the already-built
`JwksWorkspaceIntegrityProofVerifier`/`DeterministicWorkspaceAuthorizer`,
the first test in the repo exercising both real cryptographic adapters
together end-to-end rather than independently. No "governed platform state"
membership store exists yet, so `WorkspaceMembershipResolver` has only a
deterministic fixture implementation; a real platform membership/role/policy
store is a separate, larger, not-yet-scoped effort. Interactive
Authorization Code + PKCE login is also still unimplemented — it needs a
browser redirect/callback surface the stdio-only MCP dev entrypoint doesn't
have (ADR-016 §8) — so `src/mcp/dev-entrypoint.ts` remains unchanged and
still explicitly non-production; this closes the claims-to-context mapping
gap specifically, not ADR-014 end-to-end.

## Spec-Quality Update (2026-08-05)

A critical review of the accepted spec baseline (governance/reviews/memory-and-efficiency/CHANGE_IMPACT.yaml)
found the corpus consistently optimized for auditability without a
counterbalancing requirement for speed, cost, or memory. ADR-018 records the
correction:

- **SPEC-108 (Memory Model)**, new: Memory is now a first-class,
  specified component — a bounded, non-authoritative retrieval and
  working/session-memory layer in front of the Knowledge Store. It requires
  the Agent to actively decide what is worth retaining (not retain
  everything by default), separates project-scoped from cross-project/global
  applicability, and gives recurring mistakes a bounded path to become
  avoidance facts without bypassing governed learning for anything that
  could affect a verdict, rule, or policy.
- **AP-063 (Proportional Rigor)** and **AP-064 (Context and Cost
  Efficiency)**, new architecture principles: low-consequence, reversible
  operations may use a reduced-stage fast path; context and retrieval reuse
  within a run is now required, not merely permitted; SPEC-508 carries a
  concrete default token/time/Tool-call budget table keyed by consequence
  class instead of unquantified budget vocabulary.
- **SSOT corrections**: SPEC-107 §5 is now the single canonical owner of
  AI/Agent adversarial-testing coverage dimensions (SPEC-206 §9 and
  SPEC-213 §3.1 reference it); SPEC-210 §4 is now the single canonical owner
  of the execution-outcome vocabulary, including a new first-class `flaky`
  outcome distinct from `indeterminate` and `infrastructure_error`
  (SPEC-209 §7 references it).
- **SPEC-105 (Learning Engine)** gained an explicit mistake/failure-
  recurrence-prevention section (§9a) distinguishing a one-off mistake
  (handled by SPEC-108's bounded avoidance-fact path) from a recurring
  pattern (which still requires the full governed candidate lifecycle).

This is a specification-only change. It does not alter ADR-015's
tracer-bullet exclusions or ADR-017's persistence decision, and it does not
weaken evidence or governance for medium/high-consequence operations.
Implementation of the Memory component and the fast path is not required
before GOV-012 evidence for the current Requirement Review tracer-bullet
scope, but SHOULD be adopted before the platform expands to the remaining
product capabilities (see Implementation Sequence, step 6 and beyond) so
that speed, cost, and memory are not retrofitted after twelve more
capabilities have already been built without them.

## Memory Component (SPEC-108)

`WorkingMemoryKnowledgeSearch` (§4.1 run-scoped cache, AP-064 reuse) and
`SessionMemory` (§7 save-decision policy and risk-tiered fast path, §8
Workspace isolation, §9 fail-safe reads) are implemented as a shared module
in `src/memory/`, not per-capability. Two remaining Definition-of-Done items
are now implemented: `evaluateFailureAvoidanceCandidate()`
(`src/memory/failure-avoidance.ts`) applies §7.3 — a one-off, project-scoped,
low-consequence causal mistake from a defect, incorrect verdict, blocked or
failed execution, or a human-corrected decision is retained as an avoidance
fact through the same §7.2 tiering; a recurring or generalizable mistake is
declined and left to SPEC-105 §9a's governed Learning Engine workflow rather
than retained here. `reportMemoryObservability()`
(`src/memory/observability.ts`) satisfies §11 by aggregating Working
Memory's cache/reuse hit rate with Session Memory's lifetime promotion,
expiry, async-rejection, and decline-by-reason counters into one report per
Workspace. Corpus-scale ranking (§6) remains unimplemented — there is no
Workspace yet with an accepted Knowledge Store large enough to require
bounded ranking — and Session Memory remains an in-process store rather than
a durable, contract-tested seam like the Evaluation Campaign and Agent Run
record-stores; no Skill yet calls the failure-avoidance path from a real
run.

## Current Phase — Requirement Review Tracer-Bullet Implementation

The documentation baseline has passed ownership, semantic alignment, dependency, traceability, schema, example, lifecycle, and governance review. The selected advisory tracer bullet is now in development: its deterministic core, test adapters, schema validator, evaluation guardrails, in-memory runtime contract, and runtime-owned Requirement Review execution path exist. Source code remains subordinate to accepted contracts.

Specification acceptance is not implementation conformance or release approval. The Agent/Skill must produce and pass GOV-012 gate evidence at the required stage.

## Recommended First Tracer Bullet

Start with the advisory `Requirement Review Agent` and its `Assess Requirement Quality` Skill because it exercises Discovery, deterministic rules before LLM reasoning, governed knowledge retrieval, evidence, uncertainty, evaluation, and Workspace isolation without production write side effects.

The first deterministic development increment is implemented. The SPEC-508 development runtime now executes retained input through the Requirement Review Agent/Skill, validates output, evidence requirements, exact versions, Skill/Tool authority, budgets, and cleanup, and retains the immutable terminal result. The SPEC-511 provider-neutral Interface and scripted deterministic/replay Adapter enforce common envelopes, operation-and-resource-scoped Workspace authorization, canonical request digests, idempotency, strict UTC deadlines, late-result retention, capability declaration, observation-only execution results, and fail-closed cleanup. The Evaluation Campaign Runner orchestrates one isolated deterministic trial, while the Evaluation Campaign Coordinator validates and schedules a multi-trial matrix with bounded parallelism, stable declared ordering, exact cross-trial versions, critical-invariant dominance, cancellation stop, cleanup consistency, and one independent Evaluation Manager analysis. A provider-neutral retained campaign repository contract and in-memory conformance baseline now retain immutable Workspace-scoped snapshots and attributable events, enforce canonical lifecycle transitions with optimistic revisions and idempotent commands, pin versions before readiness, and fail closed during recovery when active effects cannot be reconciled. Per ADR-017 (superseding ADR-012 as the default persistence decision), a `SqliteEvaluationCampaignRecordStore` now provides a working, tested, local-first per-Workspace SQLite adapter behind the same `EvaluationCampaignRecordStore` seam, and a `PostgresEvaluationCampaignRecordStore` remains available as the optional shared/team-profile adapter — both define an atomic campaign/event/command/outbox transaction model plus up/down migrations with forced Workspace RLS for the PostgreSQL path; deterministic transaction tests cover idempotent replay, optimistic update, concurrent-command reconciliation, corrupt JSONB, and outbox rollback for both adapters against the shared contract suite. PostgreSQL 18 real-driver integration and real database concurrency/RLS/worker-loss/restart conformance (the PostgreSQL adapter is currently proven only against a fake transaction manager), Judge orchestration, production identity, and production adapters remain pending. G1–G4 must pass before enablement beyond development.

## Implementation Sequence

Implement the vertical slice in this order:

1. **In progress:** create contract and state-machine tests from SPEC-508–511 and SPEC-606–607; SPEC-508 execute/result is complete for the in-memory development slice
2. **Completed:** implement deterministic fake/replay adapters; SPEC-511 common-envelope, authorization, idempotency, deadline, late-result retention, capability, execution-observation, cleanup, cancellation, replay divergence, and trial isolation cases all pass against `ScriptedEvaluationAdapter`
3. **Completed for the in-memory multi-trial development slice:** implement deep core modules for requirement assessment, SPEC-511 trial orchestration, bounded campaign scheduling, evidence verification, cleanup, critical aggregation, and independent evaluation verdicts without provider SDK leakage
4. **Completed for the in-memory retained-state development slice:** define the provider-neutral campaign repository seam, canonical lifecycle, immutable Workspace-scoped snapshots and events, optimistic revisions, idempotent commands, exact-version readiness, trial boundaries, and fail-closed recovery decisions
5. **In progress:** the PostgreSQL campaign record-store transaction contract, outbox handoff, Workspace RLS migration, rollback migration, and deterministic transaction tests exist; a real `pg`-driver `PgTransactionManager` now proves restart, concurrent-writer, and RLS behavior against a live PostgreSQL 18 server. A parallel `AgentRunRecordStore`/`SqliteAgentRunRecordStore` seam gives Agent Run state the same contract-tested persistence path SPEC-410 §5 requires, and `InMemoryAgentRuntime` now writes through it via `PersistedAgentRuntime`. A `PostgresAgentRunRecordStore` (migration `0002_agent_run_store`) gives Agent Run state the same optional PostgreSQL adapter path; it now also passes the same real-driver conformance (restart, concurrent-writer, RLS under a non-superuser role) the Evaluation Campaign adapter proved, run against a live local PostgreSQL 18 instance. The outbox-claim/publication consumer half (`OutboxPublisher`/`SqliteOutboxPublisher`/`PostgresOutboxPublisher`, migration `0003_outbox_dead_letter`, dedicated `qa_intelligence_outbox_worker` role) is now implemented and proven against a live PostgreSQL 18 server too — claim, publish, retry-vs-dead-letter, and cross-worker no-double-claim all pass. A production `JwksWorkspaceIntegrityProofVerifier` now implements ADR-014/SPEC-506 §7's integrity-proof-verification seam with real JWT/JWKS signature, issuer, audience, and expiry checks, proven against the same shared `runWorkspaceAuthorizerContract` suite as the deterministic adapter plus real-driver rotation/tamper/unreachable-endpoint cases. A production `OidcWorkspaceContextIssuer`/`DeterministicWorkspaceContextIssuer` pair now also implements the claims-to-context issuance half (SPEC-306/406's "authorize and issue Workspace context"), proven both independently against a shared `runWorkspaceContextIssuerContract` suite and interoperating end-to-end with the already-built verifier via a real two-JWKS round-trip test; interactive OIDC discovery and the Authorization Code + PKCE login flow (no browser redirect/callback surface exists yet) and a real Workspace membership/role/policy platform store remain unimplemented, so full OIDC/internal authorization is not yet closed end-to-end
6. add production provider, Tool, and repository adapters and run the same conformance suites
7. add the host-neutral MCP facade and thin Codex, Claude Code, and Cursor packages after the relevant core capability passes development conformance
8. produce and approve GOV-012 G1–G4 evidence before enabling the Agent or Skill beyond development
9. run regression, canary, monitoring, rollback, and operational validation for G5–G6 before release

Required next actions:

- preserve the comprehensive QA/QC scope; the tracer bullet validates architecture, not the final breadth of the platform
- keep manual, exploratory, deterministic, automated, adversarial, and non-functional testing available according to risk
- retain exact versions, evidence, uncertainty, failure attribution, and Workspace context in every run
- reject shortcuts that place business rules in prompts, provider behavior in core modules, or observations directly in accepted knowledge

Source code SHALL remain subordinate to the accepted specifications.
