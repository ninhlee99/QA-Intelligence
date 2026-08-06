---
id: ADR-023
title: Adopt the Official MCP SDK for Host Integration Packages
status: accepted
version: 1.0.0
date: 2026-08-06
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
  - ADR-019
  - ADR-020
supersedes: [ADR-019]
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/mcp-sdk-adoption/CHANGE_IMPACT.yaml
---

# ADR-023: Adopt the Official MCP SDK for Host Integration Packages

## 1. Context

ADR-019 chose to hand-roll a minimal JSON-RPC/`stdio` transport instead of adopting `@modelcontextprotocol/sdk`, on the grounds that the `stdio`-only, tools-only surface needed at the time was a small fraction of what the official SDK implements, and that a 16-dependency SDK was disproportionate for it. ADR-019 §6 explicitly left the door open: "If QA Intelligence later needs remote Streamable HTTP transport with OAuth... adopting the official SDK at that point, once its full surface has real consumers, remains an option this ADR does not foreclose." ADR-020 subsequently added exactly that remote transport (`StreamableHttpTransport`, PKCE OAuth via `OauthCallbackServer`), and a working remote entrypoint (`src/mcp/remote-dev-entrypoint.ts`) with a real host-facing config example (`hosts/cursor/mcp-remote.json.example`) now exists. The condition ADR-019 §6 named for revisiting this decision has been met: the fuller MCP surface (remote transport, OAuth) now has real consumers in this repository, not just a hypothetical future need.

## 2. Decision

Adopt `@modelcontextprotocol/sdk` as a runtime dependency for QA Intelligence's Host Integration Package layer (`src/mcp/`), replacing the in-house JSON-RPC/transport implementation ADR-019 built. The wire protocol remains unchanged (MCP is a standard regardless of implementation), so this is an implementation-technology decision, not a protocol decision — identical to how ADR-019 itself was framed.

## 3. Rationale

- **The condition ADR-019 §6 set for revisiting this has been met.** This is not a reversal made lightly or without new information — ADR-019 named the exact circumstance (remote transport and OAuth reaching real consumers) that would justify adopting the SDK, and that circumstance now holds.
- **Maintaining a hand-rolled implementation of a growing standard is a widening liability, not a one-time cost.** ADR-019's in-house layer already needed its own tests for JSON-RPC framing, protocol version negotiation, and malformed-input handling — work the SDK would have done for free. Now that remote transport, PKCE OAuth, and bearer-token authentication also exist in-house (`src/mcp/remote/`), the surface this repository is independently maintaining and auditing has grown well past "a JSON-RPC message loop," which was the scoping justification ADR-019 relied on.
- **The official SDK is maintained by the protocol's own steward (Anthropic) and used by the reference host implementations (Claude Code, Claude Desktop) themselves** — adopting it reduces the risk of this repository's hand-rolled transport silently drifting from the protocol as MCP itself evolves, a risk that grows every time the spec adds a capability this repository would otherwise have to hand-implement again.
- **Dependency weight is a real cost but a bounded, auditable one.** `@modelcontextprotocol/sdk`'s direct dependencies (`express`, `hono`, `zod`, `jose`, `ajv`/`ajv-formats`, `cors`, `eventsource`, `pkce-challenge`, and others) substantially overlap with dependencies this repository already carries (`ajv`, `ajv-formats`, `jose` are already direct dependencies from ADR-014/ADR-021) or are themselves widely-audited, standard packages (`zod`, `express`) rather than obscure ones — this is not the same risk profile as the browser-automation reimplementation question ADR-022 separately resolved by adopting Playwright.

## 4. Decision Rules

- The official SDK's server APIs SHALL be used for both the local `stdio` transport and the remote Streamable HTTP transport, replacing `src/mcp/jsonrpc.ts`, `src/mcp/protocol.ts`, `src/mcp/mcp-server.ts`, `src/mcp/stdio-transport.ts`, and `src/mcp/remote/streamable-http-transport.ts`'s hand-rolled framing — but not the domain seam. `src/mcp/agent-runtime-tool-registry.ts` (the seam translating `tools/call` into the SPEC-508 Agent Runtime contract) and `src/mcp/remote/oidc-bearer-authenticator.ts`/`src/mcp/remote/oauth-callback-server.ts` (the OIDC identity seam) SHALL remain as-is in their responsibility: the SDK owns transport and protocol framing, this repository's own code continues to own everything past that seam, exactly as ADR-016 §4/ADR-019 §5 already require regardless of which SDK sits below.
- The SDK SHALL NOT be used to implement, bypass, or duplicate Workspace authorization, idempotency, deadline, or authority-widening logic — those remain owned by SPEC-508/SPEC-511 callers through the existing seam, per ADR-016 §6 ("MCP is an untrusted transport adapter relative to domain authority").
- Migration SHALL preserve wire-level compatibility: a host that worked against the hand-rolled transport SHALL continue to work unmodified against the SDK-backed one, since both speak standard MCP.
- The SDK's OAuth/PKCE primitives MAY replace `src/mcp/remote/oauth-callback-server.ts`'s hand-rolled implementation where they cover the same RFC 7636 flow, but the token still SHALL be handed to `OidcWorkspaceContextIssuer.issue()` (ADR-014's proven seam) — the SDK does not become a second identity-verification implementation.

## 5. Alternatives Considered

- **Keep the hand-rolled transport indefinitely** was rejected: ADR-019 §6 already named the specific condition under which this repository committed to revisiting the decision, and that condition is now met — continuing to hand-roll after that point is maintaining a bespoke implementation of someone else's evolving standard for no remaining architectural reason.
- **Adopt the SDK only for the remote transport, keep the hand-rolled `stdio` transport** was rejected: running two different transport implementations side by side (one hand-rolled, one SDK-based) for the same protocol is a worse maintenance burden than standardizing on one, and the `stdio` transport's own hand-rolled test suite (framing, version negotiation, malformed input) would still need to be kept correct indefinitely for no benefit once the SDK is already a dependency.
- **Wait for the SDK to modularize into smaller transport-specific packages** was rejected: there is no committed timeline for that, and the condition justifying adoption now (remote transport with real consumers) is already satisfied.

## 6. Consequences

- QA Intelligence gains a maintained, standard-compliant MCP implementation for both local and remote transports, reducing the amount of protocol-framing code this repository must independently test and keep correct as MCP evolves.
- Runtime dependency count grows by one direct package (`@modelcontextprotocol/sdk`) and its own dependency tree; several of those transitive dependencies overlap with packages already present in this repository.
- `src/mcp/jsonrpc.ts`, `src/mcp/protocol.ts`, `src/mcp/mcp-server.ts`, `src/mcp/stdio-transport.ts`, and `src/mcp/remote/streamable-http-transport.ts` become superseded by the SDK-backed replacement; their existing contract tests (ADR-019 §8's validation list) SHALL be re-verified against the new transport before the old files are removed, not deleted first and re-proven after.
- The domain seam (`AgentRuntimeToolRegistry`, `OidcBearerAuthenticator`, `OauthCallbackServer`'s handoff to `OidcWorkspaceContextIssuer`) is unaffected in responsibility, only in which transport layer calls into it.

## 7. Validation

- every ADR-019 §8 validation case (initialize/tools/list/tools/call, unsupported protocol version rejection, malformed input fail-closed, Workspace context/authorization pass-through, no direct Skill/persistence reference) passes against the SDK-backed transport
- a Host Integration Package that worked against the hand-rolled transport connects and operates identically against the SDK-backed one, with no host-visible behavior change
- the remote transport's bearer-token authentication and PKCE flow continue to terminate at the existing `OidcWorkspaceContextIssuer`/`DeterministicWorkspaceAuthorizer` seam, not a new one
- `npm audit` reports no high-severity vulnerability introduced by the SDK or its dependency tree
