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

All packages use the ADR-019 minimal in-house `stdio` JSON-RPC transport
(`src/mcp/jsonrpc.ts`, `src/mcp/mcp-server.ts`,
`src/mcp/stdio-transport.ts`), not the official
`@modelcontextprotocol/sdk`. The wire protocol is standard MCP
(`2025-06-18`), so any compliant host can connect regardless of which
implementation produced the message.

## Directories

- `claude-code/.claude-plugin/plugin.json` — Claude Code plugin manifest
- `codex/.codex-plugin/plugin.json` — Codex plugin manifest
- `cursor/mcp.json.example` — Cursor MCP server config (copy into your
  Cursor MCP settings and replace the absolute path)

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
