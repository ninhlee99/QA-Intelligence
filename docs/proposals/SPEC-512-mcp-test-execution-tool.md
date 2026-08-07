---
id: SPEC-512
title: MCP Test Execution Tool Contract
version: 0.1.0
status: draft
owner:
  - Architecture
  - Quality Engineering
depends_on:
  - SPEC-106
  - SPEC-210
  - SPEC-309
  - SPEC-407
  - SPEC-503
  - SPEC-506
  - SPEC-508
  - SPEC-509
  - SPEC-510
related_adrs:
  - ADR-007
  - ADR-008
  - ADR-009
  - ADR-016
  - ADR-019
  - ADR-020
  - ADR-022
  - ADR-023
last_updated: 2026-08-07
---

> **Proposal, not governed.** Lives under `docs/proposals/`, outside `specs/`,
> so it is excluded from `tests/validate_repository.py`, `meta/SPEC_INDEX.yaml`,
> and `meta/SPEC_READINESS.yaml`. The `interfaces` family (SPEC-501–511) is
> baselined `accepted`; this cannot be promoted into `specs/interfaces/` as
> `draft` without breaking that invariant. Promotion to a real SPEC-512
> requires: Repository Owner sign-off, a governance review producing
> `approval_evidence` per SPEC-007 §15, and either the `interfaces` family
> readiness status changing to allow mixed status or this spec being accepted
> alongside the rest of the family.

# SPEC-512 (proposed): MCP Test Execution Tool Contract

## 1. Purpose

This specification defines the MCP-exposed Tool that lets a Host (Claude Code, Cursor, Codex, CI) request execution of a governed feature/flow test against a real environment, and receive back a SPEC-210-conformant result. It instantiates the generic SPEC-510 Agent Tool Contract for the specific capability of browser-based test execution, so that a Host's natural-language intent ("test feature A", "test this flow") resolves to one deterministic, evidenced Agent run rather than ad hoc host-side browser automation.

## 2. Background and Problem

SPEC-210 defines what a governed test execution is (lifecycle, result vocabulary, evidence). SPEC-407 defines how a Playwright Plugin performs semantic browser actions. SPEC-510 defines the generic Tool contract shape. As of this writing, no accepted capability composes these three: the remote MCP server (ADR-020) exposes exactly one Tool, `assess_requirement_quality` (SPEC-203), and `src/adapters/playwright/*` is unwired adapter code with no Agent, Skill, or MCP Tool registration in front of it.

Without this Tool, a Host has no governed way to satisfy "test feature A" through QA Intelligence, and would either refuse or fall back to an ungoverned browser MCP (evidence untraceable, no Workspace isolation, no rule engine, no accepted result vocabulary).

## 3. Goals

- one MCP Tool (`execute_test_flow` or equivalent capability name) that accepts a test intent and returns a SPEC-210 result
- Host-side intent match ("test X", "run this flow") resolves via ADR-016 Host Integration Package Skills to this Tool, not to a generic browser MCP
- execution runs through Agent Runtime (SPEC-508) and Playwright Plugin (SPEC-407), never directly from the MCP transport
- evidence (screenshots, traces, assertions) is retained and referenceable per SPEC-210 §6

## 4. Non-Goals

- defining a new browser automation protocol (SPEC-407 already owns this)
- defining test authoring/design (SPEC-207 Test Design owns test case creation; this Tool executes already-approved or ad hoc-authorized cases)
- replacing `chrome-devtools` or other general-purpose browser MCP servers for exploratory, non-governed use
- production enablement — this Tool remains development-only until GOV-012 G1–G4 pass, per ADR-016 §8

## 5. Scope and Applicability

Applies to the remote (ADR-020) and stdio (ADR-019) MCP transports for Claude Code, Cursor, and Codex Host Integration Packages, and to CI callers using the same interface. Does not apply to direct SDK/library use of `playwright-execution-engine.ts` outside the Agent Runtime path.

## 6. Definitions

- **Test Flow**: a named sequence of semantic UI actions and assertions against a target environment, identified by reference (approved TestCase) or supplied inline for an unapproved ad hoc run.
- **Target Environment**: the URL, credential set, and environment identity (e.g. staging) the flow executes against, bound to Workspace policy.
- **Execution Result**: the SPEC-210 §4 canonical outcome plus evidence, returned to the Host.

## 7. Actors and Ownership

- **Host** (Claude Code/Cursor/Codex/CI): issues the Tool call on user intent; owns no QA business logic (ADR-016 §2).
- **MCP Interface**: transport-facing, untrusted relative to domain authority (ADR-016 §6); routes the call to Agent Runtime.
- **Agent Runtime** (SPEC-508): sole lifecycle writer; invokes the Test Execution Agent via SPEC-509.
- **Playwright Plugin** (SPEC-407): performs the actual browser actions and evidence capture.
- **Rule Engine / Knowledge Store**: supply governed selectors, environment policy, and credential authorization — never bypassed by direct plugin calls (ADR-002).

## 8. Inputs and Outputs

Input SHALL contain: Workspace and actor identity; target environment reference (not raw credentials — see §12); test flow reference or inline flow definition; exact Agent/Skill/Tool version pins; consequence class; budgets/deadline (SPEC-508 §3.1); idempotency key; evidence requirements.

Output SHALL be a SPEC-508 `final_result` whose domain payload is a SPEC-210 §4 outcome (`passed`, `failed`, `blocked`, `skipped`, `cancelled`, `flaky`, `infrastructure_error`, `indeterminate`) plus evidence references (§15), never raw Playwright provider objects.

## 9. Functional Requirements

- The Tool SHALL be discoverable via `list_capabilities` (SPEC-510 §2) with a description precise enough for Host-side intent matching to prefer it over a generic browser MCP for governed test requests.
- The Tool SHALL reject calls lacking a trusted Workspace context, per SPEC-506.
- The Tool SHALL resolve the target environment and credentials through Workspace-scoped configuration (§12), never accept raw secrets as call arguments (SPEC-510 §3).
- The Tool SHALL invoke the Playwright Plugin only through the Agent Runtime's Skill/Tool invocation path (SPEC-508 §2, `execute`), never directly from the MCP request handler.
- An inline (non-approved) flow SHALL be permitted only for `advisory` or `reversible` consequence class runs; anything higher SHALL require a pre-approved TestCase reference.

## 10. State and Lifecycle

Follows SPEC-210 §3 lifecycle (`planned → queued → preparing → running → collecting_evidence → completed|failed|cancelled|timed_out|blocked`) as projected through SPEC-508's run lifecycle (`start → execute → running → validating → terminal`). This section is explanatory and SHALL NOT redefine either.

## 11. Interfaces and Dependencies

- SPEC-510 (`list_capabilities`, `validate_call`, `invoke`) — outer Tool contract
- SPEC-508 (`start`, `execute`, `result`) — Agent Runtime execution path
- SPEC-509 — Skill invocation for the Test Execution Agent
- SPEC-407 — Playwright Plugin capabilities (§3) used by that Skill
- SPEC-210 — result vocabulary and evidence requirements
- ADR-016 §4-5 — Host Integration Package Skills are the mechanism by which a Host resolves "test feature A" to this Tool; this Tool does not itself implement intent parsing

## 12. Authorization, Security, and Workspace Isolation

Per SPEC-407 §4, browser contexts SHALL be isolated per execution scope and credentials SHALL use approved injection — the Tool SHALL NOT accept username/password as plain call arguments; it SHALL accept a Workspace-scoped credential/environment reference resolved server-side. Target environments (e.g. staging URLs requiring basic auth) SHALL be pre-registered per Workspace, not supplied ad hoc by the Host, so a compromised or careless Host cannot direct execution at an arbitrary or unauthorized URL.

## 13. Failure and Recovery

Provider failures map per SPEC-407 §5 (element unavailable, action rejected, assertion failed, navigation failed, timeout, browser crash, policy denial, plugin error) into SPEC-210 §4 outcomes; infrastructure/tooling failures SHALL surface as `infrastructure_error`, never as a product `failed`, per SPEC-210 §4.

## 14. Compatibility, Versioning, and Migration

Follows SPEC-510 §6: schema and effect semantics version-negotiated before call; breaking change requires major version bump. Initial version is additive only — no prior Tool of this shape exists to migrate from.

## 15. Observability and Evidence

Evidence (screenshots, traces, console/network logs where authorized) SHALL link to exact execution, step, assertion, environment, and capture time per SPEC-210 §6, with redaction preserving diagnostic meaning per the same section and SPEC-407 §7 metrics constraints (no credential or protected content in logs).

## 16. Performance and Limits

Budgets follow SPEC-508 §3.1 default ceilings by consequence class; a browser test flow SHOULD default to `reversible` unless the flow includes destructive or high-consequence actions, in which case `high_consequence` budgets and pre-approval apply.

## 17. Configuration

Per-Workspace: allowed target environments, credential references, browser/Playwright version pins (SPEC-407 §7), evidence retention policy, default consequence class.

## 18. Edge Cases

- Host supplies a target URL not in the Workspace's registered environment list: SHALL be denied at `validate_call`, not at browser navigation time.
- Basic-auth-protected staging environments: credential resolution SHALL happen inside the Plugin via the registered reference, not via a Host-supplied header.
- Flaky UI (transient failures unrelated to the product under test): SHALL be classified `flaky` or `infrastructure_error` per SPEC-210 §4, never silently retried into a `passed`.

## 19. Acceptance Criteria and Examples

- Given a Workspace with a registered `staging` environment and an approved TestCase, when a Host calls this Tool with that TestCase reference, then the result is a SPEC-210 outcome with linked evidence and no raw credentials in the response.
- Given an unregistered target URL, when a Host calls this Tool, the call SHALL be denied before any browser action occurs.
- Given a transient network timeout unrelated to the assertion under test, the result SHALL be `infrastructure_error`, not `failed`.

## 20. Quality Gates

Per ADR-016 §9 validation checklist: equivalent governed semantics across Claude Code, Cursor, Codex, and direct contract tests; Host packages cannot call the Playwright Plugin or persistence directly; Workspace denial/approval/cancellation/timeout/evidence behavior unchanged across transports; schema/version incompatibility fails before execution.

## 21. Open Decisions

- Exact Tool name and JSON schema for `execute_test_flow` (or split into `plan_test_flow` / `run_test_flow` per SPEC-210's `planned`/`queued` states) — not yet decided.
- Whether inline (non-approved) flow definitions are in scope for v1 or deferred until SPEC-207 Test Design has a governed authoring path.
- Which Host Integration Package Skill text drives the "test feature A" → this Tool intent match (ADR-016 §5) — to be authored alongside the Claude Code/Cursor/Codex packages.

## 22. Definition of Done

- Agent Runtime path exists composing SPEC-508 execute → SPEC-509 Skill → SPEC-407 Plugin, with no direct MCP-to-Plugin shortcut
- Tool registered in the MCP registry (`src/mcp/*-entrypoint.ts`) alongside `assess_requirement_quality`
- contract tests per SPEC-510 §5 and SPEC-407 §6 pass, including a deterministic fake/replay Plugin adapter
- this specification's status is promoted from `draft` to `accepted` with governance review evidence, per SPEC-007 §15
