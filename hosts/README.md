# Host Integration Packages

MCP connection configs and Skills for Claude Code, Cursor, and Codex.
These packages carry **no QA business logic** — they only connect a host
to the QA Intelligence MCP server (ADR-016 §2).

```
Host  →  Host Integration Package  →  QA Intelligence MCP  →  Agent Runtime
```

## Status: `0.1.0-dev`

Development-only server. Auth is a fixture verifier (stdio) or self-minted
OIDC (remote) — not a real IdP. Knowledge Store is in-memory seed.
Production blocked on GOV-012 G2–G6.

---

## Install (one-time, per host)

**Prerequisites:** `npm run build` from repo root first.

### Claude Code

Install the plugin by pointing Claude Code at `hosts/claude-code/` as the
plugin root. The `skills/` directory ships automatically — no separate
registration.

```sh
# CLI install
claude plugin install ./hosts/claude-code
```

Or add to `.mcp.json` / `~/.claude.json`:
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

### Cursor

Copy `hosts/cursor/mcp.json.example` into Cursor MCP settings.
Replace the placeholder with an **absolute** path (Cursor does not accept relative paths):

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

Restart Cursor after saving. Check Output → MCP if tools don't appear.

### Codex

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

### Remote transport (shared/team)

Start the HTTP server:
```sh
node dist/src/mcp/remote-dev-entrypoint.js
# Prints a signed demo bearer token to stderr
# Listens on http://127.0.0.1:8787/mcp
```

Then connect with the printed token — see `hosts/cursor/mcp-remote.json.example`.

---

## Skills (Expert Tester)

Canonical: [`references/expert-tester-workflow.md`](references/expert-tester-workflow.md) (G0–G8 + targeted retest).

| Trigger | Skill | Who | Notes |
|---------|-------|-----|--------|
| `/qa-intelligence:test` | `test` | Tester | URL + spec; env from URL |
| `/qa-intelligence:dev` | `dev` | Developer | URL + AC from source when possible |

**Local vs staging:** user passes the endpoint. Loopback → local hygiene; other http(s) → `register_workspace_environment`.

**Retest:** `run_regression_suite` with `case_ids` / `related_defect_ids`, or one screen URL, or `execute_generated_test_case`. Serious runs must `register_regression_suite`.

Command map: [`commands/README.md`](commands/README.md).

---

## MCP Tool Catalog

### Core pipeline

| Tool | Purpose |
|------|---------|
| `run_auto_qa` | Full pipeline: discover → a11y smoke → generate variants → execute → HTML report + `coverage_gaps` + `smart_retest_suggestion` + release gate |
| `run_regression_suite` | Re-run a saved suite; subset by `case_ids` or `related_defect_ids` |
| `register_regression_suite` / `list_regression_suites` | Persist + list test suites |

### Discovery

| Tool | Purpose |
|------|---------|
| `discover_ui_surface` | Semantic element map for one page |
| `discover_ui_surface_after_login` | Same, with semantic login (+ SSO/MFA) |
| `discover_ui_workflow` | Multi-page crawl; returns pages + edges + `network_hints`; persists hints cross-run |
| `discover_and_compare_role_ui_surfaces` | Dual sessions (role A vs B) + named-control diff |
| `compare_ui_surfaces` | Diff two surface captures manually |
| `discover_product_context` | Knowledge Store discovery by objective |

### Test design & execution

| Tool | Purpose |
|------|---------|
| `generate_test_cases` | SPEC-207 variants from AC + UI map |
| `execute_generated_test_case` | Execute one test case (Playwright) |
| `generate_journey_test_cases` | E2E click journeys from workflow edges |
| `generate_exploratory_charter` | Time-boxed exploratory charter from a surface |
| `execute_exploratory_session` | Bounded live probes + multi-browser compare |
| `run_depth_smokes` | a11y WCAG-subset + perf threshold + security heuristics |

### API testing

| Tool | Purpose |
|------|---------|
| `generate_api_smoke_from_openapi` | OpenAPI 3 → smoke cases (+ authz negatives) |
| `execute_api_smoke` | HTTP smoke/contract (status/body/header checks) |

### Defects & reporting

| Tool | Purpose |
|------|---------|
| `assess_ui_accessibility_smoke` | Naming a11y smoke (unlabeled/duplicate) — not full WCAG |
| `draft_defects_from_qa_run` | SPEC-211 draft from failed/flaky runs |
| `assess_defect_quality` | SPEC-211 defect document quality review |
| `export_defects_for_tracker` | Markdown/Jira text + evidence pack + `quality_warnings` pre-check |
| `file_defects_to_tracker` | Optional live filing (dry-run default; `confirm_file=true` to POST) |

### Baselines & learning

| Tool | Purpose |
|------|---------|
| `capture_ui_baseline` / `compare_ui_baseline` | Exact PNG hash+dims under `.qa-baselines/` (observation only) |
| `register_ui_surface_baseline` / `compare_ui_surface_to_baseline` | Named-control drift under `.qa-surface-baselines/` |
| `list_failure_avoidance_hints` | Session Memory `avoid:*` hints from prior runs (durable) |
| `list_learning_candidates` | Learning candidates raised by recurrence (never auto-promotes) |
| `raise_mistake_recurrence_candidate` | Manually flag a recurring mistake |

### Setup & credentials

| Tool | Purpose |
|------|---------|
| `register_workspace_environment` | Register allowlisted target (`environment:…` + `base_url`) |
| `list_workspace_environments` | List registered environments |
| `register_workspace_secret` | Register secret (value never listed back) |
| `list_workspace_secrets` | List secret refs/metadata only |
| `register_requirement` / `list_requirements` | Ingest real requirements for generate/run_auto_qa |
| `register_test_dataset` / `list_test_datasets` / `resolve_test_dataset_fields` | Synthetic field samples + resolve fills |
| `register_knowledge_record` | Durable Knowledge seed under `.qa-knowledge/` |
| `create_automation_asset` | AutomationAsset stub → `.qa-automation-assets/` |

### Document assessors (Phase 7)

| Tool | Purpose |
|------|---------|
| `assess_requirement_quality` | SPEC-203/202 requirement review |
| `assess_business_analysis_quality` | SPEC-204 BA document review |
| `assess_risk_quality` | SPEC-205 Risk document review |
| `assess_test_strategy_quality` | SPEC-206 Test Strategy review |
| `assess_test_case_quality` | SPEC-207 Test Case review |
| `assess_test_dataset_quality` | SPEC-208 Test Dataset review |
| `assess_automation_asset_quality` | SPEC-209 Automation Asset review |
| `assess_report_quality` | SPEC-212 Report review |
| `assess_execution_record_quality` | SPEC-210 Execution Record review |

### Stub generators

| Tool | Purpose |
|------|---------|
| `generate_business_analysis_stub` | Heuristic BA stub from UI map — not a professional document |
| `generate_risk_stub` | Heuristic risk stubs from UI map |
| `generate_test_strategy_stub` | Heuristic strategy stub from UI map |

### Demo only

| Tool | Purpose |
|------|---------|
| `execute_browser_test` | **DEMO ONLY** — seeded plans `TC-DEMO-001`/`TC-DEMO-002` |
| `evaluate_test_case_quality_skill` | SPEC-213 dogfood evaluation |

---

## Durable state (survives MCP restart)

| Directory | Contents |
|-----------|----------|
| `.qa-baselines/` | PNG visual baselines |
| `.qa-surface-baselines/` | UI surface baselines |
| `.qa-traces/` | Playwright fail-only trace zips (open with `npx playwright show-trace`) |
| `.qa-screenshots/` | Failure screenshots |
| `.qa-avoidance-hints/` | Durable `avoid:*` session memory entries |
| `.qa-learning-candidates/` | Learning candidates raised by recurrence |
| `.qa-mistake-occurrences/` | Mistake occurrence counts |
| `.qa-regression-suites/` | Persisted regression suites |
| `.qa-knowledge/` | Durable knowledge records |
| `.qa-automation-assets/` | Automation asset stubs |
| `.qa-test-datasets/` | Test dataset registry |
| `.qa-credentials/` | Workspace credential registry |

---

## Tips

- **Credentials:** always `register_workspace_secret` first, then use `password_secret_ref` / `field_secret_refs` — never plain passwords in tool input.
- **Environments:** non-loopback URLs need `register_workspace_environment` first.
- **API testing:** use `bearer_token_secret_ref` / `basic_auth_password_secret_ref` on `execute_api_smoke`.
- **Oracles:** set `expected_url_includes` / `expected_title_includes` / `expected_network` on AC — generator copies them onto the positive `generated_assertion`.
- **Trace debugging:** `npx playwright show-trace .qa-traces/<file>.zip`
