# Host Integration Packages

MCP connection configs and Skills for Claude Code, Cursor, Codex, and Antigravity.
These packages carry **no QA business logic** — they only connect a host
to the QA Intelligence MCP server (ADR-016 §2).

```
Host  →  Host Integration Package  →  QA Intelligence MCP  →  Agent Runtime
```

**Scope:** test + report only. No SNS / Slack / email notify integrations.

> **Hướng dẫn cài đặt & sử dụng chi tiết (tiếng Việt):**  
> [`docs/GUIDE.md`](../docs/GUIDE.md)

## Status: `0.9.0` release candidate

Production-local stdio is supported with the coding-agent host as its trust
boundary. Remote HTTP remains a development demo and must not be deployed for
team use until external identity and operational gates pass.

---

## Install (one-time, per host)

**Prerequisites:** Node 24 and Chromium. From the repository root run
`npm install`, `npx playwright install chromium`, then `npm install --global .`.

Chi tiết từng bước (Cursor / Claude Code / Codex / remote): xem **[docs/GUIDE.md §5–§6](../docs/GUIDE.md)**.

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
      "command": "qa-intelligence-mcp",
      "env": { "QA_INTELLIGENCE_WORKSPACE_ID": "my-project" }
    }
  }
}
```

### Cursor

Copy `hosts/cursor/mcp.json.example` into Cursor MCP settings:

```json
{
  "mcpServers": {
    "qa-intelligence": {
      "command": "qa-intelligence-mcp",
      "env": {
        "QA_INTELLIGENCE_WORKSPACE_ID": "my-project",
        "QA_INTELLIGENCE_HEADED": "1"
      }
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
    command: qa-intelligence-mcp
    env:
      QA_INTELLIGENCE_WORKSPACE_ID: my-project
```

### Antigravity

Copy `hosts/antigravity/mcp_config.json.example` to the workspace
`.agents/mcp_config.json` and choose a unique workspace id. The skill format is
open-standard; import the required folders from `hosts/codex/skills/` rather
than maintaining another fork.

### Remote transports

The remote server supports both MCP transport forms:

- Streamable HTTP: `POST /mcp` (preferred for new clients).
- Legacy SSE compatibility: `GET /sse` plus the advertised authenticated
  `POST /messages?sessionId=...` endpoint.

Every request requires a bearer token. SSE sessions are bound to the
authenticated workspace and actor. For Internet or team deployment, expose
these routes only through reviewed HTTPS termination; direct non-loopback HTTP
binding is refused by default.

### Remote transport demo — not production

Start the HTTP server:
```sh
npm run mcp:remote:demo
# Prints a signed demo bearer token to stderr
# Listens on http://127.0.0.1:8787/mcp
```

The self-issued token demonstrates transport interoperability only. Do not use
it for shared or production environments.

---

## Skills (Expert Tester)

Canonical: [`references/expert-tester-workflow.md`](references/expert-tester-workflow.md)  
Domain pack: [`references/domain-pack.md`](references/domain-pack.md) · templates: [`templates/domain-knowledge/`](templates/domain-knowledge/)

| Trigger | Skill | Who |
|---------|-------|-----|
| `$testcase` | `testcase` | Test designer — executable cases only, no run |
| `$qa` | `qa` | QA — requirement, risk, strategy, coverage design |
| `$qc` | `qc` | QC — real-browser execution, evidence, verdict |
| `$exploratory` | `exploratory` | Bounded exploratory charter + live observations |
| `$retest` | `retest` | Targeted regression / defect retest |
| `$defect-triage` | `defect-triage` | Evidence-backed defect drafting and review |
| `/qa-intelligence:test` | `test` | Tester — URL + spec |
| `/qa-intelligence:dev` | `dev` | Dev — URL + source AC |

**Env** = URL. **Expert bar** = refuse pass without gate + gaps + retest plan; learning hints + domain pack in G0; explore→suite loop; targeted retest.

---

## MCP Tool Catalog

Machine-check the scoped 90% QA/QC workload claim with `npm run benchmark:qa-qc`.
The generated JSON distinguishes automated, assisted, and permanently
human-only responsibilities; a missing critical proof fails the command.

### Core pipeline

| Tool | Purpose |
|------|---------|
| `run_regression_suite` | Re-run a saved suite; subset by `case_ids` or `related_defect_ids` |
| `run_expert_qa` | **Only public full-pipeline entry:** optional domain bootstrap + discover/design/execute/evidence/report + suite, E2 hooks, flake taxonomy, and learning |
| `validate_expert_claim` | Hard refuse pass/ready/ship wording when `claim_pass_allowed` is false |
| `bootstrap_domain_pack` | Create/update product `domain-knowledge/` from templates + request |
| `register_regression_suite` / `list_regression_suites` | Persist + list test suites (manual; usually skipped when auto suite_id present) |

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
| `export_defects_for_tracker` | Markdown/Jira **text** + evidence pack + `quality_warnings` — tester pastes into tracker manually (no SNS) |
| `file_defects_to_tracker` | Optional live filing (dry-run default; `confirm_file=true` to POST) — not a notification bus |

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
| `register_requirement` / `list_requirements` | Ingest real requirements for design and expert execution |
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

## Expert output fields (read in this order)

After `run_expert_qa`, hosts should surface:

1. `release_recommendation`
2. `expert_checklist` (`claim_pass_allowed`, `blockers`)
3. `coverage_gaps`
4. `expert_session_report.markdown` (primary user-facing write-up)
5. `smart_retest_suggestion`
6. Then: `expert_judgment`, `expert_senior_hardening`, `expert_risk_matrix`, `ac_quality_review`, `draft_defects`, `suite_id`

Before any pass/ready/ship sentence: call `validate_expert_claim`.

Full Vietnamese walkthrough: [`docs/GUIDE.md`](../docs/GUIDE.md) §8–§11.

---

## Tips

- **Credentials:** always `register_workspace_secret` first, then use `password_secret_ref` / `field_secret_refs` — never plain passwords in tool input.
- **Environments:** non-loopback URLs need `register_workspace_environment` first.
- **API testing:** use `bearer_token_secret_ref` / `basic_auth_password_secret_ref` on `execute_api_smoke`.
- **Oracles:** set `expected_url_includes` / `expected_title_includes` / `expected_network` on AC — generator copies them onto the positive `generated_assertion`.
- **Trace debugging:** `npx playwright show-trace .qa-traces/<file>.zip`
