---
id: ADR-020
title: Remote Streamable HTTP MCP Transport with OAuth for the Shared/Team Profile
status: accepted
version: 1.0.0
date: 2026-08-06
decision_owners:
  - Architecture
  - Security
  - Runtime Platform
related_specs:
  - SPEC-306
  - SPEC-406
  - SPEC-406
  - SPEC-506
  - SPEC-508
  - SPEC-511
related_adrs:
  - ADR-014
  - ADR-016
  - ADR-017
  - ADR-019
supersedes: []
superseded_by: null
approved_by:
  - Repository Owner through explicit instruction to write this ADR before implementation
  - Codex Technical and Governance Review
approval_evidence: governance/reviews/mcp-remote-transport/CHANGE_IMPACT.yaml
---

# ADR-020: Remote Streamable HTTP MCP Transport with OAuth for the Shared/Team Profile

## 1. Context

ADR-016 §8 commits QA Intelligence to a remote Streamable HTTP MCP transport with OAuth for the shared/team profile, but explicitly sequences it after local `stdio` (ADR-019) and after production MCP enablement is unblocked. ADR-019 §6 states that adding remote transport "is new scope requiring its own review" and does not foreclose it. That review is this ADR.

Two production identity primitives already exist and are proven against real cryptography (ROADMAP, `src/adapters/oidc/`):

- `JwksWorkspaceIntegrityProofVerifier` — verifies a signed `integrity_proof` JWT against a remote JWKS (ADR-014/SPEC-506 §7).
- `OidcWorkspaceContextIssuer` — turns an already-obtained identity token into a signed `WorkspaceContext` via `WorkspaceMembershipResolver` (ADR-014, SPEC-306/406).

Neither primitive performs the interactive part of OIDC: there is no Authorization Code + PKCE redirect/callback surface, and no HTTP transport for MCP exists at all — only `stdio` (ADR-019). This ADR decides how those two gaps close for a *remote, multi-host, multi-user* profile without duplicating or bypassing the identity work already accepted.

## 2. Problem

The local `stdio` transport (ADR-019) assumes one OS-user-owned parent runtime and inherits the host process's own trust boundary — there is no network-facing attack surface, and Workspace context is asserted by a fixture or a locally-issued signed context. A remote transport removes that assumption: an arbitrary network client claims to act as a Workspace member, over a connection this process does not control the other end of. Three problems must be decided together, because a wrong answer to any one defeats the others:

1. **Transport**: how does an MCP client reach this server over a network instead of a spawned subprocess's stdio, without adopting a general-purpose HTTP server framework this repository has twice declined (ADR-011 §5, ADR-019 §3)?
2. **Interactive identity**: how does a human at a host (Claude Code, Codex, Cursor) complete OIDC Authorization Code + PKCE against the organization's identity provider, when the MCP server itself is not a browser and cannot render a login page?
3. **Per-request authorization**: once a client holds an access token, how does every `tools/call` still pass through the same `DeterministicWorkspaceAuthorizer`/`OidcWorkspaceContextIssuer` seam a local caller uses, so remote does not become a second, divergent authorization path?

## 3. Decision

### 3.1 Transport: minimal Streamable HTTP, same JSON-RPC core as `stdio`

Extend ADR-019's scope, not replace it. `src/mcp/jsonrpc.ts`, `protocol.ts`, `mcp-server.ts`, and `agent-runtime-tool-registry.ts` already separate the transport-agnostic MCP core from the `stdio`-specific I/O (`stdio-transport.ts`). A new `StreamableHttpTransport` SHALL be added alongside `StdioTransport`, implementing only the request/response half of MCP's Streamable HTTP transport (a single `POST /mcp` endpoint accepting one JSON-RPC message per request, replying with one JSON-RPC message; `GET /mcp` SSE server-push notifications are out of scope — QA Intelligence's tool set has no server-initiated messages today) using Node's built-in `node:http`, not `express`/`hono`/any web framework. `McpServer` itself SHALL NOT change: it already takes an injected `send` function and knows nothing about the transport, so this is additive, matching ADR-019 §6's stated migration path.

### 3.2 Interactive identity: Authorization Code + PKCE terminates in a thin, separate auth service, not inside the MCP JSON-RPC loop

The MCP server itself SHALL NOT implement the browser redirect/callback dance. A separate, minimal `src/mcp/remote/oauth-callback-server.ts` HTTP surface (also `node:http`, no framework) implements exactly RFC 7636 (PKCE) + the Authorization Code grant's redirect and callback legs, and nothing else: it starts a short-lived local (or, for a hosted deployment, a fixed-URL) listener, redirects the user's browser to the identity provider's authorization endpoint with a generated PKCE `code_verifier`/`code_challenge`, receives the callback with an authorization `code`, exchanges it for tokens directly with the identity provider's token endpoint, and hands the resulting ID/access token to `OidcWorkspaceContextIssuer.issue()` — the already-accepted, already-tested seam — to obtain a signed `WorkspaceContext`. This service issues no authorization decisions of its own; it is a token-acquisition front door, structurally unable to widen authority, because the only thing downstream of it is the same `issue()` call a local deterministic test adapter also goes through.

A Host Integration Package (Claude Code, Codex, Cursor) that needs remote access is configured with this callback service's URL, not with raw IdP credentials — consistent with ADR-016 §5's "Host-specific instructions SHALL remain minimal."

### 3.3 Per-request authorization: identical seam, new bearer-token entry point

`StreamableHttpTransport` SHALL extract a bearer token from the `Authorization` header of each HTTP request and resolve it to a `WorkspaceContext` through the exact same `OidcWorkspaceContextIssuer`/`DeterministicWorkspaceAuthorizer` pair `AgentRuntimeToolRegistry` already calls — not a second authorization implementation. Concretely, `resolveWorkspaceContext()` (already an injected dependency of `AgentRuntimeToolRegistry`, currently satisfied by `fixedWorkspaceContext()` in the dev entrypoint) becomes, for the remote profile, a function that verifies the bearer token and calls `issue()` per request. No token, an expired token, or a token that fails `issue()`'s checks (unknown issuer, bad signature, no Workspace membership, suspended Workspace) SHALL fail the HTTP request closed (401) before any JSON-RPC message is parsed — the transport enforces this before `McpServer.handleLine` ever runs, so an unauthenticated request cannot reach `tools/list` or `tools/call` the way ADR-016 §6 requires ("Tool discovery SHALL reveal no inaccessible Workspace, secret, or protected artifact").

### 3.4 Transport security baseline

- TLS termination is a deployment concern (reverse proxy or hosting platform), not code in this repository; the HTTP listener itself SHALL refuse to bind to a non-loopback address without an explicit `QA_INTELLIGENCE_MCP_REMOTE_ALLOW_INSECURE` opt-out used only in tests, so plaintext-over-network is not a silent default.
- Every authenticated request is logged with actor, Workspace, operation id, and correlation id through the same audit path SPEC-508 already requires (ADR-014 §3) — the HTTP transport adds no new audit format.
- Rate limiting and quota enforcement (ADR-016 §6) are scoped to a per-Workspace token-bucket check inside the transport, backed by an in-process counter for development and left as an explicit open item (§8) for a shared/durable counter in production, rather than blocking this ADR on a distributed rate limiter design.

## 4. Decision Rules

- The transport layer (`StreamableHttpTransport`, `oauth-callback-server.ts`) SHALL NOT import a Skill implementation, Rule Engine, or persistence adapter directly — same structural rule ADR-019 §5 states for `stdio`, now also enforced for HTTP.
- The transport layer SHALL NOT implement its own token validation, signature checking, or claims-to-Workspace mapping — it SHALL call `OidcWorkspaceContextIssuer`/`DeterministicWorkspaceAuthorizer` exactly as `AgentRuntimeToolRegistry` does today. A second authorization implementation for "the remote case" is the failure mode this rule exists to prevent.
- No new general-purpose HTTP framework, OAuth client library, or session-store dependency SHALL be added; `node:http` plus the existing `jose`-based primitives (already a dependency since ADR-014) are sufficient for the scope in §3.
- A request that would succeed over `stdio` under a given `WorkspaceContext` SHALL succeed identically over Streamable HTTP under the equivalent authenticated context, and vice versa for denial — ADR-016 §9's cross-transport equivalence requirement applies unchanged.
- Production enablement of the remote transport remains blocked by the same GOV-012 G1–G4 gate ADR-016 §8 already requires for `stdio`; this ADR authorizes building and testing the transport in development, not enabling it in production ahead of that gate.

## 5. Alternatives Considered

- **Adopt `@modelcontextprotocol/sdk` now that a real HTTP/OAuth surface is needed** was reconsidered (ADR-019 §6 explicitly left this open) and still rejected for this increment: the scope actually needed (§3.1–3.3) is a single POST endpoint plus a PKCE callback leg, not the SDK's full Streamable HTTP + SSE + session-resumption + multi-provider OAuth surface. The 16-dependency cost ADR-019 §3 identified has not changed; only the specific need (some remote reachability) has appeared, not a need for the SDK's full breadth. Remains open per ADR-019 §6 if requirements grow past this scope.
- **Terminate PKCE/OAuth inside the MCP JSON-RPC server itself** was rejected: it would make `McpServer` — a small, already-tested, transport-agnostic protocol handler — responsible for browser redirects and IdP token exchange, coupling two concerns ADR-019 §5 deliberately kept separate (protocol handling vs. domain seam translation), and would make every future MCP method handler carry authentication-flow awareness it does not need.
- **Reuse the `stdio` dev entrypoint's fixture proof over the network** was rejected outright: a fixture verifier (`integrity_proof === fixture-sha256:...`) is a test double, not authentication; exposing it on a network listener would let any caller construct a valid proof for any claimed identity.
- **Delay this ADR until GOV-012 G1–G4 pass** was considered, since ADR-016 §8 blocks *production enablement* on those gates regardless of transport. Rejected because building and conformance-testing the transport in development does not require production enablement, and ADR-019 itself was written and implemented before its own G1–G4 gate passed — the precedent this repository already follows is "the transport can exist and be tested in development ahead of the gate that unblocks turning it on."

## 6. Consequences

- QA Intelligence gains a remote-reachable MCP surface for the shared/team profile without adding a web framework or OAuth client library dependency.
- The interactive login flow becomes a distinct, separately deployable service (`oauth-callback-server.ts`) rather than a mode of the MCP server, which also means it can be disabled entirely for the local-first default profile with zero code path overlap.
- Every identity and authorization decision remains inside the two seams ADR-014 already proved against real cryptography (`JwksWorkspaceIntegrityProofVerifier`, `OidcWorkspaceContextIssuer`) — this ADR adds a new *entry point* to those seams, not a new *implementation* of what they do.
- A real Workspace membership/role/policy platform store is still absent (ROADMAP, ADR-014 gap) — `WorkspaceMembershipResolver` still only has a deterministic fixture. This ADR's remote transport is therefore conformance-testable against that fixture but not yet meaningfully usable against a real organization's membership data; that gap is unchanged by this decision and remains separately scoped.
- Rate limiting beyond an in-process token bucket, session/refresh-token revocation propagation, and multi-instance deployment (this ADR assumes one server process per shared-profile deployment, consistent with ADR-013's modular monolith) are explicitly deferred (§8).

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A bearer token is replayed after Workspace suspension or membership revocation | `issue()` already denies on a suspended Workspace (SPEC-406 §4) per-request, not per-session — there is no session cache to go stale, since every HTTP request re-verifies |
| Plaintext deployment leaks bearer tokens | Non-loopback bind refused by default (§3.4); TLS termination required in front of the listener for any real deployment |
| The callback service becomes a second, drifting authorization implementation over time | Decision Rule (§4): it terminates at `issue()` and has no independent allow/deny logic of its own; conformance tests (§9) assert this structurally, the same way ADR-019 §8 asserts the transport layer has no Skill/persistence reference |
| Rate-limit/quota gap allows resource exhaustion before a durable limiter exists | In-process token bucket in development; production enablement is already blocked on GOV-012 G4 (load/operational validation), which SHALL include this specifically before remote is turned on |

## 8. Open Items (Not Decided Here)

- A durable, cross-instance rate limiter/quota store — deferred until a real multi-instance shared-profile deployment exists to size it against.
- A real `WorkspaceMembershipResolver` backed by governed platform state (ADR-014's own open item, not introduced by this ADR).
- Refresh-token rotation and revocation propagation semantics — the Authorization Code + PKCE leg in §3.2 covers initial token acquisition; long-lived session handling is separate scope.
- SSE server-push (`GET /mcp`) — excluded from §3.1 because no current QA Intelligence Tool needs a server-initiated message; adding one later is additive to this ADR, not a reason to revisit it.

## 9. Validation

- a Streamable HTTP request with a valid bearer token reaches the same `tools/call` outcome a `stdio` request with the equivalent `WorkspaceContext` would
- a missing, expired, malformed, or wrong-issuer/audience bearer token fails the HTTP request closed (401) before `tools/list` or `tools/call` is reachable
- the PKCE callback service, driven by two independent local JWKS endpoints (mirroring `tests/adapters/oidc-workspace-context-issuer.real.test.ts`'s pattern), produces a token that round-trips through `OidcWorkspaceContextIssuer`/`DeterministicWorkspaceAuthorizer` exactly as the existing real-driver test proves for a non-HTTP caller
- `StreamableHttpTransport` and `oauth-callback-server.ts` have no reference to Skill implementations, Rule Engine internals, or persistence beyond the contracts they call through (mirrors ADR-019 §8's transport-purity check)
- a non-loopback bind without the explicit test-only opt-out is refused
- disabling the remote transport (process not started) leaves the local `stdio` transport and all existing conformance unaffected
