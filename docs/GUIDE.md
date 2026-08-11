# QA Intelligence — Install & Usage Guide

> Authoritative sources: `README.md`, `hosts/README.md`, ADR-016, ADR-020.
> If this file and a source above disagree, the source wins.

## Status

`0.1.0-dev` — the MCP server runs today against real targets. Auth is fixture
(stdio) or self-minted OIDC (remote) — not a real IdP. Production blocked on
GOV-012 G2–G6.

---

## 1. Prerequisites

- Node.js `>=24 <25` (`.nvmrc` pins `24`)
- npm (ships with Node)

## 2. Install

```sh
git clone <repo-url> QA-Intelligence
cd QA-Intelligence
npm install
npm run build
```

Optional checks:
```sh
npm run typecheck
npm test
npm run validate   # full governance + schema + typecheck + test + audit
```

---

## 3. Connect your host

### 3.1 Claude Code

Install the plugin:
```sh
claude plugin install ./hosts/claude-code
```

Or manually in `.mcp.json` / `~/.claude.json`:
```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "node",
      "args": ["/absolute/path/to/QA-Intelligence/dist/src/mcp/dev-entrypoint.js"],
      "env": { "QA_INTELLIGENCE_DEV_WORKSPACE_ID": "workspace-claude-dev" }
    }
  }
}
```

Skills available after connecting: `/qa-intelligence:test`, `/qa-intelligence:dev`

### 3.2 Cursor

Copy `hosts/cursor/mcp.json.example` into Cursor MCP settings.
Use an **absolute path** — Cursor does not resolve relative paths:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "node",
      "args": ["/absolute/path/to/QA-Intelligence/dist/src/mcp/dev-entrypoint.js"],
      "env": { "QA_INTELLIGENCE_DEV_WORKSPACE_ID": "workspace-cursor-dev" }
    }
  }
}
```

Restart Cursor after saving. If tools don't appear: Output → MCP for errors.

### 3.3 Codex

Install plugin from `hosts/codex/` or add to `~/.codex/config.yaml`:
```yaml
mcpServers:
  qa-intelligence:
    command: node
    args:
      - /absolute/path/to/QA-Intelligence/dist/src/mcp/dev-entrypoint.js
    env:
      QA_INTELLIGENCE_DEV_WORKSPACE_ID: workspace-codex-dev
```

### 3.4 Remote transport (shared/team)

Start the HTTP server:
```sh
node dist/src/mcp/remote-dev-entrypoint.js
# Listens on http://127.0.0.1:8787/mcp
# Prints a signed demo bearer token to stderr on startup
```

Override host/port: `QA_INTELLIGENCE_DEV_REMOTE_HOST` / `QA_INTELLIGENCE_DEV_REMOTE_PORT`.

Connect from any host using the printed token. Example (Cursor):
```json
{
  "mcpServers": {
    "qa-intelligence-remote": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {
        "Authorization": "Bearer <token printed on startup>"
      }
    }
  }
}
```

Claude Code CLI:
```sh
claude mcp add --transport http qa-intelligence-remote http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer <token>"
```

**Note:** the dev token only verifies against the process that minted it.
Don't reuse tokens across restarts.

---

## 4. Expert QA workflows

### 4.1 Test a feature (tester workflow)

```
/qa-intelligence:test
```

The agent asks (or infers from context):
1. Target URL + environment
2. Spec / acceptance criteria (ticket, doc, or stated behavior)
3. Login credentials if session-gated

Then runs the full pipeline and gives you:
- `release_recommendation` — do_not_release / changes_required / recommend_release
- `draft_defects` — with evidence (screenshots + trace paths)
- `coverage_gaps` — what was NOT tested (explicit)
- `smart_retest_suggestion` — exact case_ids to re-run after a fix

### 4.2 QA before pushing (developer workflow)

```
/qa-intelligence:dev
```

The agent reads your open source file, derives AC from code, tests localhost,
and gives you a gate decision before you push.

### 4.3 Retest after a fix

```
run_regression_suite with related_defect_ids: ["DEF-DRAFT:<id>"]
```

Read `release_recommendation` — not pass count.
If still failing, open `.qa-traces/<file>.zip`:
```sh
npx playwright show-trace .qa-traces/<file>.zip
```

### 4.4 Multi-role / permission testing

```
discover_and_compare_role_ui_surfaces
```

Runs two login sessions (role A + role B) and diffs the named controls.
Surfaces authz gaps: controls visible to one role but not blocked for the other.

### 4.5 API contract testing

When the UI has a backing API:
```
generate_api_smoke_from_openapi (include_authz_negatives: true)
→ execute_api_smoke
```

Don't claim API pass from happy 200 alone.

### 4.6 No spec available

```
generate_exploratory_charter
→ execute_exploratory_session (include_live_probes: true)
```

Use the output to draft AC candidates, confirm with the product owner,
then run the full pipeline.

---

## 5. Setup helpers

### Credentials (do once per session)

```
register_workspace_secret { name: "staging-password", value: "..." }
→ use password_secret_ref: "workspace-secret:staging-password"
```

Never pass plain passwords in tool input — they appear in logs.

### Environments (required for non-localhost targets)

```
register_workspace_environment {
  environment_ref: "environment:staging",
  base_url: "https://staging.example.com"
}
```

### Test data (synthetic, no real PII)

```
register_test_dataset { purpose: "...", classification: "synthetic", field_samples: {...} }
→ resolve_test_dataset_fields
→ pass field_values to execute/regression
```

---

## 6. Token + identity reference

| | Stdio (dev) | Remote (dev) | Production (not built) |
|---|---|---|---|
| Auth | Fixture verifier | Self-minted OIDC (ephemeral RSA keypair) | Real IdP (ADR-014, unbuilt) |
| Token source | None needed | Printed to stderr on startup | Standard OAuth flow |
| Membership | In-process fixture | Single-actor fixture | Real governed store (unbuilt) |

When ADR-014 lands, only the token source and URL change — config shape stays the same.

---

## 7. What's not here

- **REST/GraphQL API** — `api/README.md` says "not started"
- **Product UI** — no UI package in this repo; all interaction via MCP host
- **Production OIDC** — ADR-014 pending; both entrypoints use dev-only identity

---

## 8. Reference

- [`PRODUCT.md`](PRODUCT.md) — one-page idea
- [`../RULES.md`](../RULES.md) — non-negotiables
- [`hosts/README.md`](../hosts/README.md) — full tool catalog
- [`hosts/claude-code/skills/test/SKILL.md`](../hosts/claude-code/skills/test/SKILL.md) — expert tester workflow
- [`hosts/claude-code/skills/dev/SKILL.md`](../hosts/claude-code/skills/dev/SKILL.md) — developer QA workflow
- [`../archive/`](../archive/) — historical SPECs / ADRs (optional)
