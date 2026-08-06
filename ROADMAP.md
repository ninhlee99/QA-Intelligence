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

`AgentRuntimeToolRegistry` (`src/mcp/agent-runtime-tool-registry.ts`) now
accepts an optional Session Memory instance, closing the "not yet connected
to any MCP tool call" gap the memory increment above left open. A completed
`tools/call`'s outcome (run id, outcome, output) is offered to
`SessionMemory.evaluate()` — SPEC-108 §7.1's save-decision policy still
governs it unchanged, so a non-`completed` outcome is simply not
reuse-likely and nothing is retained — keyed per tool name and scoped to the
resolved Workspace, matching SPEC-108 §4.2's own example of what Session
Memory is for ("a prior run's outcome summary for the same Workspace"). A
new `readSessionMemory(workspaceId, toolName)` accessor performs the fail-
safe §9 read. Because Session Memory must outlive any single request while a
Workspace's isolation must not (SPEC-108 §8), it is constructed once per
process and threaded through explicitly rather than rebuilt per call: the
local `stdio` dev entrypoint (`src/mcp/dev-entrypoint.ts`) now owns one
`SessionMemory` for its single-Workspace process lifetime, and the remote
`OidcBearerAuthenticator` (`src/mcp/remote/oidc-bearer-authenticator.ts`)
accepts the same instance shared across every authenticated request it
serves, even though each request still gets its own short-lived
`AgentRuntimeToolRegistry`. `tests/mcp/agent-runtime-tool-registry-session-memory.integration.test.ts`
proves retention, Workspace isolation (a retained outcome in one Workspace
is invisible to a `readSessionMemory` call for another), and that the
§7.1 gate still declines an incomplete run — all against the real
`InMemoryAgentRuntime`, not a mock.
`tests/mcp/remote/streamable-http-transport.test.ts` adds a real-HTTP proof
that a retained outcome survives across two independent requests to
`StreamableHttpTransport`, each of which is its own MCP session with no
other shared state. 514 tests total (511 pass + 3 skip, +5 from this
increment), `npm run validate` clean, no new dependency. Not yet done: no
Skill reads a prior Session Memory entry back into its own reasoning (this
increment only proves the write/read seam works through a real tool call);
Working Memory (SPEC-108 §4.1, run-scoped) still has no equivalent MCP-level
seam because it is constructed once per Skill instance rather than per run,
a pre-existing gap this increment did not touch.

## Current Phase — Requirement Review Tracer-Bullet Implementation

The documentation baseline has passed ownership, semantic alignment, dependency, traceability, schema, example, lifecycle, and governance review. The selected advisory tracer bullet is now in development: its deterministic core, test adapters, schema validator, evaluation guardrails, in-memory runtime contract, and runtime-owned Requirement Review execution path exist. Source code remains subordinate to accepted contracts.

Specification acceptance is not implementation conformance or release approval. The Agent/Skill must produce and pass GOV-012 gate evidence at the required stage.

## Recommended First Tracer Bullet

Start with the advisory `Requirement Review Agent` and its `Assess Requirement Quality` Skill because it exercises Discovery, deterministic rules before LLM reasoning, governed knowledge retrieval, evidence, uncertainty, evaluation, and Workspace isolation without production write side effects.

The first deterministic development increment is implemented. The SPEC-508 development runtime now executes retained input through the Requirement Review Agent/Skill, validates output, evidence requirements, exact versions, Skill/Tool authority, budgets, and cleanup, and retains the immutable terminal result. The SPEC-511 provider-neutral Interface and scripted deterministic/replay Adapter enforce common envelopes, operation-and-resource-scoped Workspace authorization, canonical request digests, idempotency, strict UTC deadlines, late-result retention, capability declaration, observation-only execution results, and fail-closed cleanup. The Evaluation Campaign Runner orchestrates one isolated deterministic trial, while the Evaluation Campaign Coordinator validates and schedules a multi-trial matrix with bounded parallelism, stable declared ordering, exact cross-trial versions, critical-invariant dominance, cancellation stop, cleanup consistency, and one independent Evaluation Manager analysis. A provider-neutral retained campaign repository contract and in-memory conformance baseline now retain immutable Workspace-scoped snapshots and attributable events, enforce canonical lifecycle transitions with optimistic revisions and idempotent commands, pin versions before readiness, and fail closed during recovery when active effects cannot be reconciled. Per ADR-017 (superseding ADR-012 as the default persistence decision), a `SqliteEvaluationCampaignRecordStore` now provides a working, tested, local-first per-Workspace SQLite adapter behind the same `EvaluationCampaignRecordStore` seam, and a `PostgresEvaluationCampaignRecordStore` remains available as the optional shared/team-profile adapter — both define an atomic campaign/event/command/outbox transaction model plus up/down migrations with forced Workspace RLS for the PostgreSQL path; deterministic transaction tests cover idempotent replay, optimistic update, concurrent-command reconciliation, corrupt JSONB, and outbox rollback for both adapters against the shared contract suite. PostgreSQL 18 real-driver integration and real database concurrency/RLS/worker-loss/restart conformance (the PostgreSQL adapter is currently proven only against a fake transaction manager), Judge orchestration, production identity, and production adapters remain pending. G1–G4 must pass before enablement beyond development.

## Remote MCP Transport Decision (ADR-020, 2026-08-06)

Giai đoạn 2's remaining items (2.5 remote transport, 2.6 Memory Workspace-scope
through a real MCP transport call) required a decision ADR-019 §6 explicitly
deferred: how remote Streamable HTTP transport and its interactive OIDC login
terminate without building a second authorization implementation alongside
the one ADR-014 already proved (`JwksWorkspaceIntegrityProofVerifier`,
`OidcWorkspaceContextIssuer`). **ADR-020** now records that decision:
`StreamableHttpTransport` extends the existing transport-agnostic
`McpServer`/`jsonrpc`/`protocol` core (unchanged) with a single-endpoint
`node:http` POST handler — no SSE, no session resumption, no new HTTP
framework — and a separate `oauth-callback-server.ts` terminates the
Authorization Code + PKCE leg by handing the resulting token straight to
`OidcWorkspaceContextIssuer.issue()`, the same seam a local `stdio` caller's
`resolveWorkspaceContext()` would use. Per-request authorization for remote
therefore has no independent allow/deny logic of its own; a bearer token is
re-verified through `issue()` on every request rather than cached in a
session. The governance side of this decision (governance/reviews/mcp-remote-
transport/CHANGE_IMPACT.yaml, meta/ADR_INDEX.yaml, meta/REPOSITORY_GRAPH.yaml,
governance/DECISION_GRAPH.md, MANIFEST.yaml) landed first; `StreamableHttpTransport`
(src/mcp/remote/streamable-http-transport.ts) and `OauthCallbackServer`
(src/mcp/remote/oauth-callback-server.ts) are now implemented against it,
plus `OidcBearerAuthenticator` (src/mcp/remote/oidc-bearer-authenticator.ts)
as the concrete bridge between a verified bearer token and a per-request
`AgentRuntimeToolRegistry` — `McpServer` itself is unmodified. Every HTTP
request is its own MCP session (no session resumption in scope): the
transport performs the `initialize` handshake transparently, re-verifies the
bearer token through `WorkspaceContextIssuer.issue()` on every request (no
session cache), and refuses to bind to a non-loopback host without an
explicit test-only opt-out. `tests/mcp/remote/streamable-http-transport.test.ts`
proves a valid token reaches the same `tools/call` outcome a `stdio` caller
would, and that a missing, expired, or suspended-Workspace token fails
closed (401) before `tools/list` is reachable, against a real listening HTTP
server and a real `InMemoryAgentRuntime` — not a mock.
`tests/mcp/remote/oauth-callback-server.test.ts` proves the PKCE
authorization-code round trip (including a wrong-verifier rejection and an
unknown-state rejection) against a real listening HTTP server and the
deterministic `WorkspaceContextIssuer`, with the token endpoint faked via
dependency injection (`fetchImpl`) rather than a real IdP. No new dependency
was added (`node:http`/`node:crypto`/native `fetch` only, per ADR-020 §4).
509 tests total (506 pass + 3 skip, +11 from this increment), `npm run
validate` clean. Building and conformance-testing this in development does
not require production enablement; ADR-016 §8's GOV-012 G1–G4 gate still
blocks turning remote on, matching the precedent ADR-019's own `stdio`
transport already set (built and tested before its own gate passed). Not
yet done: no host package in `hosts/` points at the remote transport (it is
code-complete and tested but unwired to any entrypoint), a real
`WorkspaceMembershipResolver` backed by governed platform state, durable
cross-instance rate limiting, and refresh-token rotation (all explicit
ADR-020 §8 open items).

## Rule Engine Interface Conformance (SPEC-502 §7, 2026-08-06)

Eleven `DeterministicRuleEngine` implementations exist across the tracer
bullet and the twelve replicated capabilities
(`RequirementQualityRuleEngine`, `CompositeRuleEngine`,
`RequirementIntelligenceRuleEngine`, `RiskQualityRuleEngine`,
`TestCaseQualityRuleEngine`, `TestStrategyQualityRuleEngine`,
`TestDatasetQualityRuleEngine`, `AutomationAssetQualityRuleEngine`,
`ExecutionRecordQualityRuleEngine`, `DefectQualityRuleEngine`,
`ReportQualityRuleEngine`), and the shared `RuleEvaluationRequest`/
`RuleEvaluationValue`/`RuleEvaluationFailure`/`DeterministicRuleEngine`
type contract in `src/requirement-review/public.ts` already matched
SPEC-502 §2/§3/§5 closely. What none of them had was SPEC-502 §7's own
requirement: "A deterministic reference adapter and each production
adapter SHALL pass the same golden-vector contract suite" — the pattern
already used for the record-store, outbox, workspace-authorizer, and
workspace-context-issuer seams (`run*Contract` functions), but never built
for rule engines. `tests/shared/rule-engine-contract.ts`
(`runRuleEngineContract`) now provides that suite: determinism (identical
inputs produce identical outputs), missing facts never becoming a
`satisfied` decision, response-shape conformance against §3's required
fields, a non-empty explanation trace for any non-`satisfied` outcome, and
no state leakage between independent evaluations. Every one of the eleven
engines now calls it once from its own test file, reusing that file's
existing fixture builders rather than duplicating domain setup — including
`RequirementQualityRuleEngine`, which previously had no test calling
`.evaluate()` directly at all (only indirectly through
`AssessRequirementQuality`). 55 new tests (569 total, 566 pass + 3 skip),
`npm run validate` clean, no production code changed and no new
dependency — this closed a conformance-evidence gap, not a missing
implementation.

## Execution Engine Contract (SPEC-504, 2026-08-06)

SPEC-504 previously had zero implementation — unlike SPEC-502 (Rule Engine
Interface), where the type contract already existed and only the shared
conformance suite was missing, SPEC-504 had no interface, no adapter, and
no test at all before this increment. `src/execution-engine/public.ts` now
defines the provider-neutral interface ADR-009 requires between the Core
Platform and any Execution Plugin: `descriptor`/`validate`/`prepare`/
`start`/`cancel`/`finalize`, a request/result envelope with an idempotency
digest (`executionRequestDigest`, mirroring `src/evaluation/adapter.ts`'s
already-proven pattern for SPEC-511), and an event-sink callback `start`
drives for SPEC-504 §4's ordered event stream (accepted/preparing/started/
progress/evidence_created/assertion_result/completed/failed/cancelled/
cleanup_completed) rather than a separate poll operation. Result outcomes
reuse the exact `ExecutionOutcome` literal union SPEC-210 §4 already owns
as its single source of truth (passed/failed/blocked/skipped/cancelled/
flaky/infrastructure_error/indeterminate) — this module does not define a
competing vocabulary.

`src/adapters/replay/deterministic-execution-engine.ts`
(`DeterministicExecutionEngine`) is the "deterministic simulator/replay
engine" SPEC-504 §7 requires to exist and pass the same conformance suite a
production engine eventually will. It scripts scenarios per `attempt_id`
(SPEC-602 §4: retries are distinct attempts) rather than per exact-request
match, proving idempotent `start` (a duplicate start replays the same
retained events instead of re-executing), cooperative cancellation that
never rewrites an already-terminal outcome (SPEC-602 §5), and cleanup
reporting. `tests/execution-engine/execution-engine-contract.ts`
(`runExecutionEngineContract`) is the first shared golden-vector suite for
this seam — the same `run*Contract` pattern already used for record-stores,
outbox, workspace-authorizer/context-issuer, and (as of the prior
increment) rule engines, now extended to Execution Engine adapters. 11 new
tests (580 total, 577 pass + 3 skip), `npm run validate` clean, no new
dependency.

A real Playwright adapter (SPEC-407) was deliberately not attempted in this
increment — not deferred arbitrarily, but blocked by a real, verified
dependency gap: SPEC-407 §2/§3 requires semantic locate/interact against
governed UI evidence (ADR-003, "Semantic UI Instead of Raw DOM"), which
requires SPEC-301 (Semantic Analyzer), SPEC-302 (DOM Cleaner), SPEC-303
(Feature Extractor), and SPEC-408 (Ontology Repository) — all four still at
0% implementation. Building a Playwright adapter today could only use raw
CSS/XPath selectors, which would violate ADR-003 outright rather than
partially satisfy it. The correct next step toward a real browser
execution engine is the semantic UI specs, not a non-conformant shortcut.

## Platform Event Contract (SPEC-505, 2026-08-06)

SPEC-505's exact §2 envelope field set (event id/type, schema version,
occurred+recorded timestamps, producer identity+version, Workspace/actor,
correlation/causation ids, aggregate id+sequence, payload, classification,
integrity metadata) already existed — but only inside `OutboxRecord`
(`src/evaluation/outbox-publisher.ts`), a consumer-side shape read back out
of the transactional outbox rather than a producer-facing type any domain
module could construct an event against. `src/events/public.ts` now
provides `PlatformEvent`/`buildPlatformEvent()`: validates every §2
required field (failing closed and reporting every violation at once, not
just the first), rejects a command-shaped payload per §3 ("Events describe
completed facts and SHALL NOT be used as ambiguous commands"), defaults
`causation_id` to `correlation_id` for a root event, and computes a
deterministic `sha256` `integrity_digest` over every other field so
`verifyPlatformEventIntegrity()` can independently detect tampering rather
than trusting a stored digest. `toOutboxRecord()` converts a built
`PlatformEvent` into the exact `OutboxRecord` shape `OutboxPublisher`
requires, proving by working code (not just documentation) that the two
types share one field definition rather than two that could silently
drift. §6's duplicate-delivery, reordering, and poison-event conformance
requirements were deliberately not re-tested here —
`runOutboxPublisherContract` already proves claim exclusivity, lease-expiry
reclaim, and retry-vs-dead-letter against real SQLite and PostgreSQL
adapters, and authorization/redaction are already proven at the RLS/role
boundary in the real-driver PostgreSQL suite; this increment's scope was
specifically the producer-side envelope construction and integrity half
SPEC-505 had no dedicated type for. 14 new tests (594 total, 591 pass + 3
skip), `npm run validate` clean, no new dependency, and neither
`OutboxRecord` nor `OutboxPublisher` were modified.

## Skill and Tool Contracts (SPEC-509/SPEC-510, 2026-08-06)

Both interfaces had zero implementation before this increment — unlike
SPEC-502 and SPEC-505, where the underlying field/type shape already
existed and only a shared conformance suite or a producer-facing type was
missing. None of the nine Skills built so far (`AssessRequirementQuality`,
`AssessRiskQuality`, `AssessTestCaseQuality`, ...) implemented a common
interface; each exposed its own `.review()`-shaped method. No Tool
interface existed at all — `AgentRunStartRequest.allowed_tools` was only a
`VersionReference[]` allowlist, not SPEC-510's actual contract.

`src/skills/public.ts` defines the SPEC-509 §2 interface
(`describe`/`match`/`validate`/`invoke`), its §3 descriptor, and its §4
match/result shapes. `src/adapters/replay/skill-invocation-adapter.ts`
(`RequirementQualitySkill`) wraps the real, already-shipped
`AssessRequirementQuality` behind it — proving the new interface actually
fits a production Skill rather than only a synthetic scenario built to
satisfy its own shape. `tests/skills/skill-contract.ts`
(`runSkillContract`) is the shared conformance suite SPEC-509 §5 requires
(positive/negative trigger, permission denial without widening authority,
invalid-input fail-closed, postcondition/evidence, deterministic replay);
writing it surfaced a real assumption error — the first version compared
entire `output` objects for the replay test, which failed because
`AssessRequirementQuality` legitimately mints a fresh assessment id per
call. The fix lets a fixture supply a `decisionFingerprint()` comparing
only the decision-relevant subset (verdict/findings), not incidental
identity fields.

`src/tools/public.ts` defines the SPEC-510 §2 interface
(`list_capabilities`/`validate_call`/`invoke`/`inspect_effect`/`compensate`),
its §3 descriptor/call shapes, and all ten §4 result codes
(success/denial/invalid_input/not_found/conflict/throttling/timeout/
provider_failure/partial_effect/unknown_effect).
`src/adapters/replay/deterministic-tool.ts` (`DeterministicTool`) is the
required deterministic fake adapter (§6) — it cannot wrap a real Tool
because none exists yet (Playwright remains blocked exactly as recorded in
the SPEC-504 entry above), so its scenarios are scripted per
`idempotency_key` rather than wrapping production code, but it still
proves least privilege, idempotency, redaction, and compensation
structurally. `tests/tools/tool-contract.ts` (`runToolContract`) is the
shared suite for SPEC-510 §5 (least privilege, no-authorization-proof
denial, idempotency without effect re-application, conflict on a
different call reusing the same key, timeout/partial-effect distinction,
`inspect_effect` never fabricating a status for an unknown reference,
redaction, cross-Workspace, deterministic replay). Writing it found one
real bug: `DeterministicTool.validate_call()` originally treated "no
scripted scenario for this key" as an `invalid_arguments` policy denial,
which meant `invoke()`'s already-correct `not_found` branch (SPEC-510 §4)
could never execute — `validate_call()` always denied first. Fixed by
removing that check from `validate_call()`: whether a simulator happens to
have a scripted answer is an adapter-internal detail, not a policy
decision a real Tool's `validate_call()` would ever make.

30 new tests (624 total, 621 pass + 3 skip), `npm run validate` clean, no
new dependency.

## Ontology Repository (SPEC-408, 2026-08-06)

`ontology/*.yaml` (entities, relationships, enumerations, constraints) was
already an accepted spec baseline, validated by the Python governance
tooling (`tests/validate_repository.py` via PyYAML) — but no TypeScript
runtime code could read it at all; no YAML parser existed among the
TypeScript dependencies. **ADR-021** decided this before code: adopt
`js-yaml` (one direct dependency, one transitive `argparse`, both pure
JavaScript with no native binding) rather than hand-rolling a YAML parser.
This differs from ADR-019's JSON-RPC decision — JSON-RPC framing is a
small, bounded surface a correct in-house implementation could realistically
cover, but full YAML (anchors, block styles, multi-line scalars) is not,
and nothing guarantees `ontology/*.yaml` stays within today's narrow
flow-style subset forever.

`src/ontology/public.ts` defines the SPEC-408 §3 interface
(`currentRelease`/`release`/`resolveTerm`/`validateExtension`/
`compareReleases`) and all six §5 failure codes as distinct outcomes.
`src/ontology/yaml-ontology-repository.ts` (`YamlOntologyRepository`) is
the real, production adapter: it reads `meta/ONTOLOGY_INDEX.yaml` and the
four `ontology/*.yaml` files it indexes via `js-yaml`'s safe-by-default
`load()`, caches the parsed release once (SPEC-408 §4 "accepted ontology
releases are immutable"), and fails closed with `integrity_failure` if the
four files' own `ontology_version` fields disagree. `validateExtension()`
rejects a Workspace extension that redeclares a global-scope entity id
(§6), a duplicate id, or a relationship pointing at an unknown endpoint.
Writing this surfaced a real path-resolution bug before any test caught
it: the first version of `defaultRepositoryRoot()` walked up two directory
levels from the compiled file's own location, which is wrong given
`tsconfig.json`'s `rootDir: "."` (`src/ontology/x.ts` compiles to
`dist/src/ontology/x.js`, three levels below the actual repository root
that contains `meta/`/`ontology/`) — found by running the compiled module
directly against the real files before writing tests, not by a test
catching it after the fact.

`tests/ontology/yaml-ontology-repository.test.ts` has two halves: nine
tests read this repository's own real, already-accepted `ontology/*.yaml`
files directly (no mock) — confirming the actual 47-entity release loads,
`Requirement` and `depends_on` resolve as real terms, and the cached
release is the same object across calls — and six tests use disposable
`mkdtemp` fixture directories to exercise failure paths a passing
repository state cannot exhibit (missing index file, `ontology_version`
mismatch, an index missing a required artifact entry, duplicate/unknown-
endpoint extension rejection). 15 new tests (639 total, 636 pass + 3
skip), `npm run validate` clean, `npm audit` reports zero vulnerabilities
including the two new packages. Not yet done: only one release (`1.0.0`)
exists on disk, so `compareReleases()` between two genuinely different
versions is untested beyond comparing a release against itself (SPEC-408
has no second accepted release yet to compare against); no consumer
(Knowledge Repository, Semantic Analyzer, or anything else) has been wired
to this component yet — this increment is the read component itself, not
its integration.

## Knowledge Repository (SPEC-401/SPEC-103, 2026-08-06)

The existing `InMemoryKnowledgeSearch` (SPEC-501) is a read-only, fixed-seed
search adapter — it has no create/revise/promote/deprecate/archive
commands and does not implement SPEC-102's Knowledge Object model or
lifecycle at all. `src/knowledge/public.ts` now defines the provider-
neutral `KnowledgeRepository` interface with all thirteen SPEC-103 §6 core
operations (seven commands — createDraft/reviseDraft/submitForReview/
recordDecision/promoteCandidate/deprecateOrSupersede/archive — and six
queries — getExactVersion/getCurrentAccepted/listHistory/query/
traverseRelationships/appendLifecycleEvent) plus all eight SPEC-103 §14
failure codes as distinct outcomes. `src/adapters/memory/in-memory-
knowledge-repository.ts` (`InMemoryKnowledgeRepository`) is the reference
adapter: it enforces SPEC-102 §9's exact lifecycle graph (draft → in_review
→ accepted → deprecated/superseded → archived) as an explicit transition
table, optimistic concurrency via expected_revision, immutability of
accepted versions (reviseDraft refuses to touch anything already
accepted), Workspace isolation that fails closed as not_found rather than
leaking existence across Workspaces, and idempotent createDraft under a
caller-supplied idempotency key. 15 new tests cover the full five-step
lifecycle, an illegal direct draft-to-archived transition, a stale-revision
conflict, the immutability refusal, cross-Workspace and global-scope
visibility, combined query filtering, relationship traversal, and
candidate promotion creating an accepted object directly without a
draft/review detour. Not yet done: this is an in-memory reference adapter
only (the SQLite/PostgreSQL durable adapter ADR-017's pattern would add is
separate, larger scope, the same way Evaluation Campaign Repository
started in-memory before its SQLite adapter existed); "recovery" and
"vendor substitution" conformance (SPEC-401 §7) are untestable without a
second durable adapter to compare against; and no Skill or other consumer
has been wired to this repository yet.

## Judge Calibration, Disagreement, Drift, Leakage, and Self-Evaluation (SPEC-310 §2/§6, SPEC-107 §4, 2026-08-06)

`EvaluationManager` (SPEC-411/213) aggregates trial outcomes but has no
concept of a Judge at all — zero calibration, disagreement, drift,
leakage, or self-evaluation detection existed anywhere. `src/evaluation/
judge-calibration.ts` adds all five, deliberately provider-neutral (it
operates on already-produced `JudgeVerdict` records, never a reasoning-
provider SDK call, mirroring ADR-002/ADR-009's deterministic-vs-LLM
separation applied to the Judge oracle tier specifically). `detectDisagreement()`
groups verdicts per case/trial and flags any real split without resolving
it by majority vote (the same "never hide a failed critical invariant"
principle SPEC-107 §7 states for aggregate scores, applied to Judge
output). `calibrateJudge()` compares a Judge's verdicts only against
genuine oracle labels — never against another Judge, which would be
circular — and returns `undefined` rather than a fabricated accuracy when
there is no overlapping oracle case. `detectDrift()` flags an accuracy
decline across successive calibration runs beyond a caller-supplied
threshold, since "how much decline is meaningful" is a suite-level policy
choice (SPEC-107 §14), not a value this module should invent.
`detectSelfEvaluation()` flags a Judge whose identity matches the subject
it judged (SPEC-107 §4: "A Judge SHALL not evaluate its own hidden
rationale"). `detectLeakage()` flags a Judge that received a hidden-
holdout evidence reference (SPEC-107 §6 contamination). `judgeAuthorityPermitted()`
gives SPEC-107 §4's authority limit a checkable boolean: a
`high_consequence` decision backed by a Judge alone, with no corroborating
deterministic oracle and no human review, is denied. 15 new tests (669
total, 666 pass + 3 skip), `npm run validate` clean, no new dependency.
Not yet done: none of this is wired into `EvaluationManager` or the
Evaluation Campaign Runner as a live consumer yet — it exists as a
standalone, tested module; and SPEC-107 §4's full four-rung oracle
hierarchy (deterministic → evidence-anchored rubric → calibrated Judge →
human) has no selection orchestration — `judgeAuthorityPermitted()` is one
gate within that hierarchy, not the hierarchy's routing logic itself.

## Remote Transport Host Wiring (2026-08-06)

`StreamableHttpTransport` and `OidcBearerAuthenticator` (ADR-020) existed
and were conformance-tested but nothing in `hosts/` pointed at them — every
host package still used the local `stdio` dev entrypoint only.
`src/mcp/remote-dev-entrypoint.ts` closes that gap: it wires the identical
Agent Runtime, reviewer, and seeded `REQ-DEMO-001` requirement
`dev-entrypoint.ts` uses, but serves them over the remote transport with
real cryptographic identity rather than a fixture proof — it mints its own
ephemeral RSA keypair, runs two independent local JWKS servers (one
standing in for an upstream IdP, one for the Workspace Manager's own key,
mirroring the real-driver interop test's two-JWKS pattern), and issues a
real signed OIDC ID token through `OidcWorkspaceContextIssuer` on startup.
Running it and calling it with `curl` end-to-end (not just unit tests)
confirms a real token reaches a real Agent Runtime verdict
(`changes_required` for the seeded requirement's missing rationale) and
that a missing bearer token is denied with 401 before `tools/list` is
reachable.

`tests/adapters/jwks-fixture-server.ts` moved to
`src/adapters/oidc/jwks-fixture-server.ts` since the dev entrypoint needs
its ephemeral-keypair/local-JWKS-server logic at runtime, not only in
tests — the two existing real-driver OIDC tests were updated to import
from the new location with no behavior change. `hosts/cursor/mcp-remote.json.example`
demonstrates the standard MCP remote client config shape (`"url"` instead
of `"command"`/`"args"`) pointing at the dev server with a bearer token
header. No new tests were added for this increment (it is host wiring
confirmed by a real end-to-end `curl` call, not a new unit-testable
module); 669 tests remain, `npm run validate` clean. Not yet done: Claude
Code and Codex plugin manifests have no remote variant yet — their exact
remote-server declaration format needs confirming per host before adding
one; the Workspace membership resolver remains a single-actor inline
fixture, the same pre-existing ADR-014 gap noted elsewhere, not something
this increment introduced.

## Knowledge Repository SQLite Adapter (2026-08-06)

`KnowledgeRepository` previously had only an in-memory reference adapter.
`src/adapters/sqlite/sqlite-knowledge-repository.ts`
(`SqliteKnowledgeRepository`) implements the same interface directly
against a real SQLite file, one database per Workspace (ADR-017). Unlike
`SqliteEvaluationCampaignRecordStore`/`SqliteAgentRunRecordStore` (which
implement a generic `retainMutation` envelope over an event-sourced
aggregate), `KnowledgeRepository`'s interface already exposes direct
per-operation commands, so this adapter implements each one directly
against SQLite rows across four tables (`qa_knowledge_objects` for current
state, `qa_knowledge_history` for every version, `qa_knowledge_lifecycle_events`,
`qa_knowledge_idempotency`) inside `BEGIN IMMEDIATE`/COMMIT/ROLLBACK
transactions, matching the concurrency and lifecycle rules already proven
in the in-memory adapter. Seven tests exercise it against real SQLite
files: retain-and-load, a genuine restart-survival test (a completely
separate repository instance opening the same file sees the prior
Workspace-scoped state — not the same in-process object), the full
five-step lifecycle, a stale-revision conflict, idempotent `createDraft`,
cross-Workspace isolation, and combined query filtering. Writing it
surfaced a real TypeScript inference issue (not a logic bug): generic
type parameters on `#transaction`/`checkRevision`/`succeeded` failed to
infer correctly when a callback had multiple return branches, because
`failure()`'s branch left the generic unconstrained and poisoned the
whole union to `unknown` — fixed by supplying explicit type arguments at
each call site rather than relying on inference. 7 new tests (676 total,
673 pass + 3 skip), `npm run validate` clean, no new dependency (`node:sqlite`
was already an accepted baseline choice from Giai đoạn 0). Not yet done: a
PostgreSQL adapter (the optional ADR-017 shared/team-profile counterpart)
does not exist, so "vendor substitution" conformance (SPEC-401 §7) remains
untested against a second durable adapter; no consumer is wired to either
Knowledge Repository adapter yet.

## Judge Calibration Wired Into EvaluationManager (2026-08-06)

`src/evaluation/judge-calibration.ts` existed as a standalone, tested
module with no consumer. `EvaluationInput` now accepts two optional
fields — `judge_verdicts` and `hidden_holdout_refs` — that leave every
existing required field and all twelve prior tests unchanged. A new
`judgeIntegrityReasons()` helper calls the real `detectDisagreement()`,
`detectSelfEvaluation()`, and `detectLeakage()` functions and folds any
finding into the same `invalid_test_reasons` vocabulary
`unverified-evaluation-evidence` already populates — a Judge integrity
problem makes the affected trial's evidence untrustworthy the exact same
way unverified evidence already does, reusing one mechanism rather than
adding a parallel one. Because this reuses an existing output field,
`schemas/evaluation-result.schema.json` (`additionalProperties: false`)
needed no change, and the existing schema-conformance test still passes
unmodified. Four new tests prove the real wiring end-to-end through
`EvaluationManager.evaluate()` (not against the calibration module in
isolation): a clean set of Judge verdicts leaves a passing verdict
untouched, real disagreement between two Judges turns the verdict
`indeterminate`, a Judge whose identity matches its subject is flagged,
and a Judge that received a hidden-holdout reference is flagged as
contamination. 4 new tests (680 total, 677 pass + 3 skip), `npm run
validate` clean, no new dependency, no schema change. `calibrateJudge()`,
`detectDrift()`, and `judgeAuthorityPermitted()` were deliberately not
wired this round — they need concepts `EvaluationInput` does not carry yet
(an oracle-label corpus, calibration history over time, a consequence
class), which would mean redesigning the interface rather than wiring an
existing module, a larger change than this increment's scope. No campaign
runner or coordinator produces real `judge_verdicts` yet either, since no
real Judge/reasoning-provider adapter exists to generate one outside a
test.

## Semantic UI Pipeline: DOM Cleaner, Semantic Analyzer, Feature Extractor (SPEC-302/301/303, 2026-08-06)

All three had zero implementation. Built in their real dependency order
(SPEC-302 depends only on 101/201/301; SPEC-301 depends on 302 output as
one source type; SPEC-303 depends on both). None of the three drive a
live browser — each is a pure data-transformation stage over
already-captured or already-derived data — so none needed a Playwright
dependency, consistent with the SPEC-504 entry above's finding that
building a Playwright adapter itself remains separately blocked.

`src/dom-cleaner/public.ts` defines the SPEC-302 §3/§4 input/output
contracts and all seven §8 failure codes.
`src/adapters/dom-cleaner/deterministic-dom-cleaner.ts`
(`DeterministicDomCleaner`) implements the exact §5 pipeline stage order
against an already-typed `RawDomNode` tree: prohibited tags
(script/style/etc.) are removed entirely, noise attributes (style/class/
event handlers) are dropped without a redaction event (they are not
sensitive, just irrelevant), policy-driven redaction is recorded as a
distinct event, accessible role/name/interaction hints are retained, and
size/depth/byte limits fail closed before any output is returned. 10
tests confirm removal, redaction, accessibility retention, size-limit
enforcement, deterministic byte-identical output across repeated runs,
and honest coverage reporting.

`src/semantic-analyzer/public.ts` defines the SPEC-301 §3 request/
observation contracts (fact vs. derived-observation vs. hypothesis kept
structurally distinct) and all six §6 failure codes.
`src/adapters/semantic-analyzer/deterministic-semantic-analyzer.ts`
(`DeterministicSemanticAnalyzer`) performs only the deterministic
"Apply Deterministic Extraction" / "Resolve Ontology Concepts" pipeline
stages and never the "Perform Bounded AI Analysis" stage — the same
pattern `ScriptedReasoningProvider([])` already uses elsewhere in this
codebase to report `unavailable` rather than fabricate a model call. It
currently accepts `cleaned_dom` source content and resolves interactive
elements to `Action`/`Field` fact observations, flagging (not silently
dropping) any element with no accessible name. 7 tests include a real
end-to-end run of `DeterministicDomCleaner` output through this analyzer.

`src/feature-extractor/public.ts` defines the SPEC-303 §3 candidate
contract (Page/Region/Feature/Field/Action/State) and all seven §8
failure codes. `src/adapters/feature-extractor/deterministic-feature-extractor.ts`
(`DeterministicFeatureExtractor`) maps each `Action`/`Field` observation
into a `FeatureCandidate` whose identity is its own accessible name
(SPEC-303 §5: "semantic anchors... not fragile DOM position"), fails
closed on an identity collision between two distinct observations rather
than silently merging them, and classifies changes against an optional
prior feature map (§6) — a changed accessible name is correctly
classified `semantic`, not `presentation_only`, since it is a meaning
change an assistive technology or an assertion would observe, not mere
styling. 9 tests include a full, real, three-stage
DomCleaner → SemanticAnalyzer → FeatureExtractor pipeline run with no
mocks at any stage.

26 new tests across the three modules (706 total, 703 pass + 3 skip),
`npm run validate` clean, no new dependency. This clears SPEC-407's stated
blocker (ADR-003 semantic locate/interact requires SPEC-301/302/303/408,
all now implemented at the interface + deterministic-adapter level) at
the design level — a real Playwright *adapter* implementing these
interfaces against a live browser is still separate, larger scope
requiring its own `playwright` dependency decision (mirroring ADR-021's
`js-yaml` precedent) and has not been attempted here.

## Knowledge Repository PostgreSQL Adapter (2026-08-06)

Following the SQLite adapter, `KnowledgeRepository` now also has the
ADR-017 optional shared/team-profile PostgreSQL counterpart, proven
against a real, live PostgreSQL 18 server rather than only committed as
untested code. Migration `0004_knowledge_repository.up.sql`/`.down.sql`
adds the same four tables the SQLite adapter uses, with `FORCE ROW LEVEL
SECURITY` scoped by the `qa.workspace_id` session variable (the same
pattern migration `0002_agent_run_store` already established) — the two
object-bearing tables additionally allow reading rows where
`workspace_id = 'global'`, matching SPEC-102 §13's "Global knowledge MAY
be shared." `src/adapters/postgres/postgres-knowledge-repository.ts`
(`PostgresKnowledgeRepository`) reuses the existing
`PostgresTransactionManager`/`PostgresTransaction` seam from the
Evaluation Campaign adapter and implements each `KnowledgeRepository`
method directly, the same shape the SQLite adapter uses. Writing it
surfaced one real bug before any test ran: TypeScript caught
`existing?.status` where `existing` is a `{object, revision}` pair, not
the object itself — the correct access is `existing?.object.status`.

Verification here went beyond writing a gated test that skips cleanly:
PostgreSQL 18 (installed in an earlier session but not currently running)
was started, migration 0004 applied to the existing `qa_intelligence_test`
database, and the non-superuser `qa_intelligence_app` role granted access
to the four new tables. `tests/knowledge/postgres-knowledge-repository.real.test.ts`
then ran for real (not just typechecked) against that live server: retain-
and-load, the full lifecycle (confirming `accepted` cannot skip straight
to `archived` without deprecating/superseding first), a concurrency
conflict, idempotent `createDraft`, and — critically — Row-Level Security
Workspace isolation exercised under the non-superuser role specifically,
since a superuser connection always bypasses RLS regardless of `FORCE ROW
LEVEL SECURITY` and would make that test meaningless, a lesson this
repository's own `pg-transaction-manager.real.test.ts` already recorded.
All five tests passed against the real server. The CI workflow's existing
`postgres-adapter` job now also applies migration 0004, grants the new
tables, and runs this test file — extending the existing job rather than
adding a new one; the workflow's pre-existing gap where migrations 0002/
0003 are never applied or exercised in CI was not touched, as it predates
this work and is out of scope here.

5 new tests (707 total, 703 pass + 4 skip — the skip count rose by one for
this file's own clean skip when no database is configured), `npm run
validate` clean, no new dependency (`pg` was already accepted under
ADR-017). Not yet done: no shared `run*KnowledgeRepositoryContract`
function exists the way record-stores have, so "vendor substitution"
conformance (proving SQLite and PostgreSQL are semantically equivalent
through one shared test suite) remains unverified — the SQLite and
PostgreSQL test files use similar scenarios but do not share code; no
consumer is wired to either adapter yet.

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
