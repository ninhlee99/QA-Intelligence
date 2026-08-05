---
id: ADR-019
title: Minimal Self-Implemented MCP Transport Instead of the Official SDK
status: accepted
version: 1.0.0
date: 2026-08-05
decision_owners:
  - Architecture
  - Runtime Platform
  - Security
related_specs:
  - SPEC-503
  - SPEC-508
  - SPEC-509
  - SPEC-510
related_adrs:
  - ADR-011
  - ADR-016
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit continue-and-decide instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/mcp-transport/CHANGE_IMPACT.yaml
---

# ADR-019: Minimal Self-Implemented MCP Transport Instead of the Official SDK

## 1. Context

ADR-016 commits QA Intelligence to a host-neutral MCP Interface reachable by
Codex, Claude Code, and Cursor. The initial development transport is local
`stdio` (ADR-016 §8). An implementation choice is required for how that
transport and the underlying JSON-RPC 2.0 message layer are built.

The official `@modelcontextprotocol/sdk` package exists and implements the
protocol, but pulls in 16 direct dependencies (`express`, `hono`, `zod`,
`cors`, `jose`, `eventsource`, and others) intended to cover every MCP
transport (stdio, Streamable HTTP, SSE, OAuth) and server/client role at
once. QA Intelligence's runtime baseline (ADR-011) currently holds two
production dependencies (`ajv`, `ajv-formats`) plus the `pg` driver added
under ADR-017/ADR-018 for a capability (a real SQL wire protocol) with no
in-house alternative. MCP's `stdio` transport, by contrast, is a bounded,
well-specified surface: read newline-delimited JSON-RPC 2.0 messages from
stdin, write them to stdout, and implement a small set of MCP methods
(`initialize`, `tools/list`, `tools/call`, and their notifications).

## 2. Decision

The development-phase MCP Interface SHALL be implemented in-house as a
minimal JSON-RPC 2.0 message layer plus a `stdio` transport, scoped to
exactly the MCP methods QA Intelligence's Host Integration Packages need
(§4). It SHALL NOT depend on `@modelcontextprotocol/sdk` or an equivalent
all-transport SDK.

This is an implementation-technology decision, not a protocol decision:
the wire format, method names, and JSON-RPC envelope SHALL remain
byte-compatible with the official MCP specification so any compliant host
(Claude Code, Codex, Cursor) can connect without modification, and so a
future migration to the official SDK — or addition of remote Streamable
HTTP transport — remains possible without changing ADR-016's authoritative
execution path (`Host → Host Integration Package → QA Intelligence MCP
Interface → Agent Runtime/Evaluation Engine`).

## 3. Rationale

- The `stdio`-only, tools-only surface QA Intelligence needs today is a
  small fraction of what the official SDK implements; the unused surface
  (HTTP server framework, OAuth/PKCE, SSE, CORS) still ships as installed
  dependency weight and audit surface.
- ADR-011 §5 already treats added dependencies as requiring architecture
  review; a 16-dependency transport SDK for a JSON-RPC message loop is
  disproportionate to the runtime baseline's stated preference for a small,
  auditable dependency set.
- MCP's `stdio` JSON-RPC framing is simple enough (newline-delimited JSON
  objects, a handful of method names) that a correct, tested in-house
  implementation is a bounded, low-risk effort — unlike a database wire
  protocol (ADR-017/018's `pg` decision) or a browser automation protocol,
  where an in-house reimplementation would be high-risk and low-value.
- A minimal implementation keeps every MCP-facing line of code inside this
  repository's own test and audit boundary, consistent with AP-064's
  "no unauthorized dependency owns domain meaning" pattern already used for
  the record-store seams.

## 4. Scope of the Minimal Implementation

The in-house layer SHALL implement only:

- JSON-RPC 2.0 request/response/notification framing over `stdio`
  (newline-delimited JSON, per the MCP transport specification)
- `initialize` / `initialized`
- `tools/list`
- `tools/call`
- `notifications/cancelled` (best-effort; Tool cancellation still passes
  through the Agent Runtime's own cancellation semantics, not the
  transport's)
- protocol version negotiation and a fail-closed rejection of an
  unsupported version

It SHALL NOT implement: Streamable HTTP, SSE, OAuth/PKCE, resources,
prompts, sampling, or any MCP capability QA Intelligence's Host Integration
Packages do not use. Adding one of those later is an additive change to
this transport layer, not a reason to adopt the full SDK by default.

## 5. Module and Seam Rules

The MCP transport is a thin adapter at the seam ADR-016 §2 defines. It
SHALL:

- translate `tools/call` into the SPEC-508 Agent Runtime contract (or
  SPEC-511 Evaluation Adapter contract where applicable) and translate the
  result back into an MCP tool result — it SHALL NOT call a Skill
  implementation or persistence directly (ADR-016 §4)
- carry the same Workspace context, idempotency, deadline, and
  authorization requirements as every other SPEC-508 caller; MCP is an
  untrusted transport relative to domain authority (ADR-016 §6)
- have a deterministic/replay counterpart for contract tests, consistent
  with every other seam in this codebase

## 6. Consequences

- No new runtime dependency is added for MCP in the development phase.
- The in-house transport must itself be tested for JSON-RPC framing
  correctness, protocol version negotiation, and malformed-input handling
  — work the official SDK would otherwise have done.
- If QA Intelligence later needs remote Streamable HTTP transport with
  OAuth (ADR-016 §6, shared/team profile), that is new scope requiring its
  own review; adopting the official SDK at that point, once its full
  surface has real consumers, remains an option this ADR does not foreclose.
- Host Integration Packages (Claude Code, Codex, Cursor) are unaffected:
  they speak standard MCP over `stdio` and cannot distinguish an in-house
  transport implementation from the official SDK's.

## 7. Alternatives Considered

- **Adopt `@modelcontextprotocol/sdk` now** was rejected for the reasons in
  §3 — disproportionate dependency weight for the `stdio`-only surface
  needed today. This is a reversible choice (§6), not a permanent
  rejection of the SDK.
- **Hand-roll a custom, non-compliant tool-calling protocol** was rejected
  because it would break interoperability with Claude Code, Codex, and
  Cursor, defeating ADR-016's entire purpose.
- **Delay MCP work until the official SDK's dependency footprint is
  smaller or modularized** was rejected because there is no committed
  timeline for that, and ADR-016 §8 already permits a development-phase
  `stdio` adapter now.

## 8. Validation

- a compliant MCP client (or a scripted JSON-RPC harness standing in for
  one) can complete `initialize`, list tools via `tools/list`, and invoke a
  tool via `tools/call` against the in-house transport
- an unsupported protocol version is rejected before any tool is exposed
- malformed JSON-RPC input fails closed with a structured JSON-RPC error,
  never a crash or a hung connection
- a `tools/call` invocation carries Workspace context and authorization
  through to the underlying SPEC-508/SPEC-511 contract exactly as a
  direct caller would
- the transport layer has no reference to Skill implementations, Rule
  Engine internals, or persistence beyond the contracts it calls through
