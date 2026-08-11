# Changelog

All notable changes to QA Intelligence are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0-dev] — Unreleased

> Development release. Usable as Expert QA MCP in Claude Code / Cursor / Codex.

### Project reshape — product-first GitHub (2026-08-11)

- Moved historical SPECs / ADRs / GOV / playbooks / stub package roots → `archive/governance-baseline/`
- Added `RULES.md` (10 non-negotiables), `LICENSE` (MIT), `docs/PRODUCT.md`
- CI slimmed to typecheck + test + audit (+ optional schema examples); dropped SPEC-index gate from default `validate`
- README rewritten for GitHub: badges, quick start, core tools, clear status

### Expert QA upgrade (2026-08-11)

**Thinking layer**
- `run_auto_qa` output now includes `coverage_gaps` — explicitly states what was NOT tested (not-executed cases, unbindable AC, unlabeled fields, scope limits). Expert QA rule: never claim pass by silence.
- `run_auto_qa` output now includes `smart_retest_suggestion` — exact `case_ids` / `related_defect_ids` for targeted retest after a fix; never re-run full suite when only a subset failed.
- Rewrote `hosts/claude-code/skills/test/SKILL.md` and `dev/SKILL.md` — risk-first triage, 3 strategies (Full/Regression/Exploratory), 5 pre-task assessment questions, tool map by purpose.

**Evidence quality**
- HTML report: trace `.zip` evidence rendered as clickable link with `npx playwright show-trace` hint.
- `discover_ui_workflow`: persists `network_hints` to `SessionMemory` cross-run; subsequent runs expose `prior_network_hints` for AC authoring — never invent routes.
- `export_defects_for_tracker`: pre-export `quality_warnings` gate — flags `confirmed_cause` set (pipeline never confirms cause), no evidence, non-draft status.

**Multi-host Skills**
- Added `hosts/cursor/skills/test/SKILL.md`, `hosts/cursor/skills/dev/SKILL.md`
- Added `hosts/codex/skills/test/SKILL.md`, `hosts/codex/skills/dev/SKILL.md`

---

### Durable learning + Playwright traces (2026-08-10)

- Playwright fail-only traces → `.qa-traces/` with clickable evidence in HTML report.
- `avoid:*` session memory entries durable across MCP restarts → `.qa-avoidance-hints/`.
- Learning candidates durable → `.qa-learning-candidates/`.
- Mistake occurrence counts durable → `.qa-mistake-occurrences/`.
- `FileBackedCandidateRepository` replaces in-memory candidate store.

### Visual & surface baselines (2026-08-10)

- `capture_ui_baseline` / `compare_ui_baseline` — exact PNG hash+dims under `.qa-baselines/`; mismatch is observation only, not auto-fail.
- `register_ui_surface_baseline` / `compare_ui_surface_to_baseline` — named-control drift detection under `.qa-surface-baselines/`.
- Stable `avoid:<classification>:<test_ref>` recurrence keys; auto-raise learning candidate on repeat failure.
- `list_learning_candidates` — never auto-promotes.

### Document quality assessors (2026-08-10)

Seven `assess_*_quality` MCP tools: BA, risk, strategy, test case, dataset, automation asset, report.
Each returns governed findings via the same deterministic rule engine used by requirement review.
Generate stubs: `generate_business_analysis_stub`, `generate_risk_stub`, `generate_test_strategy_stub`.

### API + depth testing (2026-08-10)

- `generate_api_smoke_from_openapi` + `execute_api_smoke` — OpenAPI → smoke cases with optional authz negatives.
- `run_depth_smokes` — WCAG-subset, perf threshold, security heuristics; `has_critical` never hidden by green counts.

### Exploratory + multi-browser (2026-08-10)

- `execute_exploratory_session` — bounded live probes, auto-check leak/naming oracles, `manual_follow_up` signal.
- `browser` param on `discover_ui_surface` / `run_auto_qa` (`chromium` | `firefox` | `webkit`).

### Senior QA pipeline (2026-08-10)

- `run_auto_qa` — single call: discover → a11y naming smoke → generate variants → execute (flake-aware) → HTML/JSON report → draft defects → residual risks → release gate.
- `run_regression_suite` — re-run a saved suite; subset by `case_ids` / `related_defect_ids`.
- `register_regression_suite` / `list_regression_suites` — durable under `.qa-regression-suites/`.
- `discover_ui_workflow` — multi-page crawl, pages + edges + `network_hints`.
- `discover_and_compare_role_ui_surfaces` — dual login sessions + named-control diff.
- `export_defects_for_tracker` — Markdown/Jira text + evidence pack.
- `generate_journey_test_cases` — E2E click journeys from workflow edges.

### Credential & environment registry (2026-08-10)

- `register_workspace_secret` / `list_workspace_secrets` — secrets never listed back.
- `password_secret_ref` / `field_secret_refs` / `bearer_token_secret_ref` on all relevant tools.
- `register_workspace_environment` / `list_workspace_environments` — non-loopback URLs must match allowlist.
- SSO/MFA wait path on `discover_ui_surface_after_login`.

### Test data & learning (2026-08-10)

- `register_test_dataset` with synthetic `field_samples` → `resolve_test_dataset_fields` → `field_values`.
- `register_knowledge_record` — durable knowledge under `.qa-knowledge/`.
- `create_automation_asset` — stub → `.qa-automation-assets/`.
- `list_failure_avoidance_hints` — Session Memory `avoid:*` read side; `prior_failure_avoidance_hints` injected into `run_auto_qa` output.

### Test generation & execution (2026-08-07)

- `generate_test_cases` — positive / negative / boundary / adversarial variants from AC + discovered UI.
- `execute_generated_test_case` — flake-aware execution, screenshot on fail.
- `run_auto_qa` initial version: discover → generate → execute → HTML report.
- AC oracle passthrough: `expected_url_includes` / `expected_title_includes` / `expected_network` copied onto positive `generated_assertion`.
- Network oracle: Playwright captures xhr/fetch; `expected_network` couples submit→API in one plan.

### UI discovery (2026-08-07)

- `discover_ui_surface` — live Semantic UI Map (fields, actions, accessible names).
- `discover_ui_surface_after_login` — same, after semantic login.
- `PlaywrightExecutionEngine` — semantic `type` / `click` / `select` / `wait_for`, multi-step plans, URL/title/network oracles, flake detection, screenshots.

### Foundation (2026-08-06)

- MCP server over `@modelcontextprotocol/sdk` (stdio + Streamable HTTP transports).
- Agent Runtime, Evaluation Engine, Knowledge Store, Rule Engine, Workspace isolation.
- Requirement review: `assess_requirement_quality`, `register_requirement`, `discover_product_context`.
- `execute_browser_test` — DEMO ONLY with seeded plans.
- Host integration packages: Claude Code, Cursor, Codex.
- 66 specifications (SPEC-001–213), 23 ADRs, governance (GOV-001–012).
