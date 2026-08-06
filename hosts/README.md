# Host Integration Packages

This is the canonical root for QA Intelligence's **Host Integration
Packages** as defined by ADR-016 §3 — installable Codex, Claude Code,
Cursor, or similar bundles that connect a host to QA Intelligence. This is
a distinct concept from a **Platform Plugin** (SPEC-503, `plugins/`), which
is an adapter from the Core Platform to an external technology
(Playwright, GitHub, ...). Host Integration Packages own no QA business
logic, policy, accepted knowledge, evaluation verdicts, runtime lifecycle,
or final-result authority (ADR-016 §2) — they only carry host metadata and
MCP connection configuration.

The authoritative execution path (ADR-016 §2) is:

```text
Host -> Host Integration Package -> QA Intelligence MCP Interface -> Agent Runtime / Evaluation Engine
```

## Status: development only

Every package here points at `dist/src/mcp/dev-entrypoint.js`
(`src/mcp/dev-entrypoint.ts`), an explicitly non-production MCP server:

- authorization uses a deterministic fixture verifier, not OIDC (ADR-014's
  production identity work is still pending)
- the Knowledge Store is an in-memory seed with one example requirement
  (`REQ-DEMO-001`)
- the Reasoning Provider is a scripted replay adapter with an empty
  script — an indeterminate deterministic-rule outcome will not be
  resolved by a real model

This matches ADR-016 §8: "Development MAY add an in-process or `stdio`
MCP adapter after the relevant core capability is vertically complete."
Production MCP enablement remains blocked until the Agent/Skill passes
GOV-012 G1-G4 and the transport itself passes security, isolation,
approval, cancellation, evidence, and operational conformance (ADR-016
§8) — none of which any package here claims.

## Transport

All packages use the official `@modelcontextprotocol/sdk` (ADR-023,
superseding ADR-019's prior in-house implementation) via
`src/mcp/sdk-mcp-server.ts` and `src/mcp/stdio-transport.ts`. The wire
protocol is standard MCP (`2025-06-18`), so any compliant host can connect
regardless of which implementation produced the message — migrating off
the hand-rolled transport changed no host-visible behavior.

## Remote transport (shared/team profile, development only)

`src/mcp/remote-dev-entrypoint.ts` (compiled to
`dist/src/mcp/remote-dev-entrypoint.js`) wires the same Agent Runtime,
reviewer, and seeded `REQ-DEMO-001` requirement `dev-entrypoint.ts` uses,
but exposes them over ADR-020's `StreamableHttpTransport`
(`src/mcp/remote/streamable-http-transport.ts`) with **real** cryptographic
identity instead of a fixture proof: it mints its own ephemeral RSA
keypair, serves its own local JWKS endpoint standing in for an upstream
IdP, and issues real signed OIDC ID tokens through
`OidcWorkspaceContextIssuer` — the same production identity seam ADR-014
proved, not a shortcut. Run it directly:

```sh
npm run build
node dist/src/mcp/remote-dev-entrypoint.js
```

It listens on `http://127.0.0.1:8787/mcp` by default (override with
`QA_INTELLIGENCE_DEV_REMOTE_PORT`/`QA_INTELLIGENCE_DEV_REMOTE_HOST`) and
prints a real, signed demo bearer token to stderr on startup — paste it
into `cursor/mcp-remote.json.example`'s `Authorization` header (copy that
file into your Cursor MCP settings) to connect a real host over the remote
transport. The inline single-actor membership fixture and the
self-signed JWKS server are still explicitly non-production (ADR-014's
real governed membership store remains unbuilt), and production enablement
is blocked on GOV-012 G1-G4 regardless (ADR-016 §8, ADR-020 §4) — but this
is a real, working remote MCP round trip a host can actually connect to
today, not only conformance tests (`tests/mcp/remote/`).

## Directories

- `claude-code/.claude-plugin/plugin.json` — Claude Code plugin manifest (local `stdio`)
- `codex/.codex-plugin/plugin.json` — Codex plugin manifest (local `stdio`)
- `cursor/mcp.json.example` — Cursor MCP server config for local `stdio`
  (copy into your Cursor MCP settings and replace the absolute path)
- `cursor/mcp-remote.json.example` — Cursor MCP server config for the
  remote Streamable HTTP transport (see "Remote transport" below)

## Before use

Run `npm run build` from the repository root first — the packages launch
the compiled `dist/src/mcp/dev-entrypoint.js`, not the TypeScript source.

## Exposed tool

`assess_requirement_quality` — runs the Requirement Review Agent /
Assess Requirement Quality Skill (SPEC-203) through the real Agent
Runtime (SPEC-508) and Rule Engine, against the seeded `REQ-DEMO-001`
requirement by default. Pass `requirement_ref` to target a different
identifier, though only the seeded requirement will resolve until a real
Knowledge Store adapter replaces the in-memory seed.
