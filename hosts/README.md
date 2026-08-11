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
- `claude-code/skills/` — Claude Code Skills bundled with this plugin
  (`dev/SKILL.md` → `/qa-intelligence:dev`, `test/SKILL.md` →
  `/qa-intelligence:test`). Claude Code auto-discovers any
  `skills/*/SKILL.md` under a plugin's root, so installing the plugin
  installs these Skills too — no separate registration step.
- `codex/.codex-plugin/plugin.json` — Codex plugin manifest (local `stdio`)
- `cursor/mcp.json.example` — Cursor MCP server config for local `stdio`
  (copy into your Cursor MCP settings and replace the absolute path)
- `cursor/mcp-remote.json.example` — Cursor MCP server config for the
  remote Streamable HTTP transport (see "Remote transport" below)

## Installing the Claude Code plugin

Two ways to get the MCP server and the bundled Skills at once:

- **Local plugin directory** — point Claude Code's plugin settings directly
  at `hosts/claude-code/` as the plugin root. No marketplace needed; the
  `skills/` directory ships with it automatically.
- **Marketplace** — this repo's root `.claude-plugin/marketplace.json`
  declares the same `hosts/claude-code` directory as the `qa-intelligence`
  plugin's `source`, so `claude plugin install qa-intelligence` (or adding
  this repo as a marketplace) installs the MCP connection and the Skills
  together, the same way the local-directory path does.

## Before use

Run `npm run build` from the repository root first — the packages launch
the compiled `dist/src/mcp/dev-entrypoint.js`, not the TypeScript source.

## Exposed tools (development)

The shared fixture (`src/mcp/dev-fixture.ts`) currently registers these MCP tools
on both stdio and remote transports:

| Tool | Purpose |
|------|---------|
| `assess_requirement_quality` | SPEC-203/202 requirement quality review (seeded `REQ-DEMO-001`) |
| `discover_product_context` | SPEC-201 Knowledge Store discovery by objective |
| `discover_ui_surface` | Live-page Semantic UI Map (Page/Field/Action); optional `browser` |
| `discover_ui_surface_after_login` | Same, after semantic login (+ optional HTTP Basic Auth) |
| `generate_test_cases` | SPEC-207 variants from AC + UI map |
| `execute_generated_test_case` | Execute one generated TestCase object |
| `run_auto_qa` | Discover → a11y naming smoke → generate → execute → HTML/JSON report + draft defects + release gate + prior avoidance hints |
| `assess_ui_accessibility_smoke` | Naming a11y smoke (missing/duplicate names) — not full WCAG; also embedded in `run_auto_qa` |
| `generate_exploratory_charter` | Time-boxed exploratory charter from a surface |
| `execute_exploratory_session` | Phase 9: run session (auto oracles + multi-browser capture compare) |
| `assess_defect_quality` | SPEC-211 defect-document quality review |
| `draft_defects_from_qa_run` | SPEC-211 draft defects from failed/flaky outcomes (standalone) |
| `assess_execution_record_quality` | SPEC-210 ExecutionRecord document quality |
| `execute_browser_test` | **DEMO ONLY** seeded plans (`TC-DEMO-001` / `TC-DEMO-002`) — not for real targets |
| `register_workspace_secret` | Phase 6: register Workspace secret (value never listed back) |
| `list_workspace_secrets` | Phase 6: list secret refs/metadata only |
| `assess_business_analysis_quality` | Phase 7 / SPEC-204: Workflow document quality |
| `assess_risk_quality` | Phase 7 / SPEC-205: Risk document quality |
| `assess_test_strategy_quality` | Phase 7 / SPEC-206: Test Strategy document quality |
| `assess_test_case_quality` | Phase 7 / SPEC-207: Test Case document quality |
| `assess_test_dataset_quality` | Phase 7 / SPEC-208: Test Dataset document quality |
| `assess_automation_asset_quality` | Phase 7 / SPEC-209: Automation Asset document quality |
| `assess_report_quality` | Phase 7 / SPEC-212: Report document quality |
| `execute_api_smoke` | Phase 8: HTTP API smoke/contract (status/body/header); infra ≠ product fail |
| `run_depth_smokes` | Phase 10: a11y WCAG-subset + perf threshold + security heuristics (`has_critical`) |
| `list_failure_avoidance_hints` | Phase 11: Session Memory `avoid:*` hints from prior `run_auto_qa` drafts |
| `register_workspace_environment` | SPEC-512 §12: register allowlisted target `environment:…` + `base_url` |
| `list_workspace_environments` | List registered target environments |
| `generate_business_analysis_stub` | SPEC-204: Workflow stub from UI map / URL |
| `generate_risk_stub` | SPEC-205: Risk stubs from UI map / URL |
| `generate_test_strategy_stub` | SPEC-206: Test Strategy **stub** from UI map (heuristic — not a professional strategy) |
| `file_defects_to_tracker` | Optional Jira/Linear/webhook filing (dry-run default; `confirm_file=true` to POST) |
| `register_knowledge_record` | Durable Knowledge seed under `.qa-knowledge/` |
| `register_test_dataset` / `list_test_datasets` | SPEC-208: dataset governance metadata (no secret rows) |
| `create_automation_asset` | SPEC-209: AutomationAsset stub from TestCase refs |
| `evaluate_test_case_quality_skill` | SPEC-213 dogfood: EvaluationManager over Assess Test Case Quality |
| `compare_ui_surfaces` | Role/permission thin: diff two UI maps (admin vs viewer) |
| `register_requirement` / `list_requirements` | SPEC-202 ingest real Requirements for generate/run_auto_qa |
| `discover_ui_workflow` | Multi-page same-origin crawl (pages + edges) |
| `register_regression_suite` / `list_regression_suites` / `run_regression_suite` | Persist + re-run browser/API packs |
| `generate_api_smoke_from_openapi` | OpenAPI 3 → ApiSmokeCase[] (status; optional authz negatives) |
| `generate_journey_test_cases` | E2E click journeys from `discover_ui_workflow` edges |
| `export_defects_for_tracker` | Markdown/Jira text export (no tracker API call) |

**Release posture:** `0.1.0-dev` host packages are the supported **development release**.
Production enablement remains blocked on GOV-012 G2–G6 (ADR-016 §8). See gate record under `governance/reviews/`.

Prefer `password_secret_ref` / `field_secret_refs` after `register_workspace_secret` (demo seed: `workspace-secret:demo-password`).
Prefer `environment_ref` after `register_workspace_environment` (demo seeds: `environment:dev-fixture-page` / `environment:dev-fixture-login`). Non-loopback http(s) URLs must match the allowlist; `data:` and loopback remain fixture escapes.
For API smoke prefer `bearer_token_secret_ref` / `basic_auth_password_secret_ref`. On AC, set `expected_url_includes` / `expected_title_includes` / `expected_network` — generator copies them onto the positive `generated_assertion` (xhr/fetch url+status+body snippet after UI submit).

Host Skills: `claude-code/skills/dev` (code-first) and `claude-code/skills/test`
(UI/spec-first Senior QA workflow). Run `npm run mcp:dev` or `npm run mcp:remote`
after clone.
