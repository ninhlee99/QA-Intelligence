# Changelog

All notable changes to QA Intelligence are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0-dev] — Unreleased

> Development release. Usable as Expert QA MCP in Claude Code / Cursor / Codex.

### Fully automated Expert Tester loop, P1–P5 (2026-08-11)

- P1: `run_auto_qa` auto-registers a regression suite and returns `suite_id` / `expert_checklist.suite_id_present`.
- P2: `bootstrap_domain_pack` writes/updates `domain-knowledge/` from request context (path = product root).
- P3: `run_auto_qa` optional hooks — `role_b` for role compare, `openapi`/`openapi_path` for API cases in the suite, `include_workflow_journeys` for journey cases in the suite.
- P4: single `run_expert_qa` facade wraps domain pack + auto_qa + suite + checklist.
- P5: flake taxonomy in the report + `learning` block always present in output.

Goal: one `:test`/`:dev` call with URL+AC (+ product_root) returns gate + gaps + checklist + `suite_id` + domain pack path + flake taxonomy + learning, without a second "please register suite" step.

### Automatic standard evidence profile (2026-08-13)

- `run_expert_qa`, `run_auto_qa`, and `execute_generated_test_case` default to PNG for every executed testcase, trace for non-pass outcomes, and WebM for non-pass outcomes.
- `evidence_capture_status` checks requested screenshot and video coverage separately. Missing required artifacts remain `partial`, never silent complete.
- Callers may explicitly select `screenshot_policy` / `video_policy` as `off`, `failure_only`, or `all`; `video_policy: all` is audit/full-session mode.

### P7 — MCP and Skill productization (2026-08-13)

- P7.1: `assess_continuous_qa` exposes incremental selection and quality-trend gates through retained MCP authority.
- P7.2: `assess_deep_testing` exposes responsive, API contract, performance, state-model and mutation outputs without provider judgment.
- P7.3: both operations are advisory/read-only, versioned, budgeted and registered in the shared stdio/remote fixture.
- P7.4: the concise `qa-lead` Skill is packaged identically for Codex, Claude Code and Cursor with generated UI metadata.
- P7.5: QA Lead reconciles these outputs with existing visual-baseline, evidence-lifecycle, signed-bundle and production gates; human release accountability remains explicit.
- P7.6: `npm run benchmark:qa-lead-mcp` checks the complete tool surface, host parity and a 3 KB Skill context ceiling.

### P6 — deterministic deep-testing oracles (2026-08-13)

- P6.1: exact-byte visual baselines detect screenshot drift without claiming perceptual equivalence; a bounded browser/device matrix covers mobile, tablet and desktop.
- P6.2: API contract drift blocks removed operations/responses and newly required parameters.
- P6.3: performance budgets block exceeded values and missing required measurements.
- P6.4: bounded model-based journey generation covers reachable state transitions and avoids cyclic expansion.
- P6.5: mutation adequacy uses valid mutants only and blocks every surviving critical mutant regardless of aggregate score.
- P6.6: `npm run benchmark:deep-testing` exercises responsive, contract, performance, 1,000-transition state-model and mutation gates.

Visual v1 is deliberately an exact integrity oracle. Perceptual layout acceptance still requires a separately governed image-diff policy or human review.

### P5 — Continuous QA Intelligence (2026-08-13)

- P5.1: incremental selection maps changed paths to traced cases, always includes mandatory critical smoke, and escalates shared-infrastructure changes to full regression.
- P5.2: repeated flakes may quarantine only non-critical cases with an owner and expiry; critical journeys or expired/unowned quarantine block release.
- P5.3: quality history detects pass-rate regression, flake SLO breach and escaped-defect breach.
- P5.4: a stable CI quality-decision contract returns pass/block, selected cases, blockers and evidence references.
- P5.5: Ed25519-signed evidence bundles bind a release to the SHA-256 of every artifact and detect later tampering.
- P5.6: `npm run benchmark:continuous-qa` proves deterministic selection over 10,000 cases under a bounded latency budget plus trend/integrity gates.

### P4 — production evidence and release-candidate control (2026-08-13)

- P4.1: one validated production operations config owns monitoring, kill-switch key, incident owner, rollback/security references and bounded canary percentage.
- P4.2: file monitoring sink persists redacted operational events and computes a failure-rate SLO.
- P4.3: the environment kill switch is a Playwright-engine default, so browser entry points cannot omit it accidentally.
- P4.4: security, rollback and incident-owner attestations require existing evidence under the governed root, matching SHA-256 and a valid approval window.
- P4.5: canary assessment requires automatic rollback above threshold and verifies restoration time plus post-recovery semantics.
- P4.6: `npm run release-candidate:check` combines regression, resilience, browser parity, production config, monitoring, attestations and canary evidence. `release-candidate:report` is the non-mutating diagnostic form.

P4 supplies gates; it does not manufacture security approval, an on-call owner, rollback proof or canary results.

### P3.3–P3.6 operational hardening (2026-08-13)

- P3.3: evidence manifest retention is exposed as `manage_evidence_lifecycle`; preview is default, purge requires explicit confirmation and `evidence:delete`, legal hold and artifact-root isolation fail closed. Visual type actions redact secrets plus common PII field classes.
- P3.4: retries are limited to infrastructure/transient dependency failures. Product assertions, policy failures and invalid tests are never hidden by retry. Atomic per-testcase checkpoints resume only when the testcase digest matches.
- P3.5: `npm run benchmark:resilience` runs deterministic chaos/recovery/redaction probes and writes `.qa-benchmarks/qa-resilience.json`. Token usage is an explicitly labelled context-byte proxy, not provider billing telemetry.
- P3.6: an execution kill switch blocks before browser launch, operational counters expose failure/retry/recovery/evidence state, and `npm run readiness:production` fails unless all production ownership and safety gates are supplied.

Current production status is intentionally not inferred from passing unit tests. Use `npm run readiness:report` for the exact unresolved gates.

### Project reshape — product-first GitHub (2026-08-11)

- Moved historical SPECs / ADRs / GOV / playbooks / stub package roots → `archive/governance-baseline/`
- Added `RULES.md` (10 non-negotiables), `LICENSE` (MIT), `docs/PRODUCT.md`
- CI slimmed to typecheck + test + audit (+ optional schema examples); dropped SPEC-index gate from default `validate`
- README rewritten for GitHub: badges, quick start, core tools, clear status

### Domain pack auto-bootstrap (2026-08-11)

- Skills/workflow: on `:test`/`:dev`, agent creates or updates `domain-knowledge/` in the **product** workspace from templates + request — user does not copy templates manually
- `docs/NEXT.md` updated: user only supplies URL/spec and confirms high-risk TODOs

### MCP expert_checklist (2026-08-11)

- `run_auto_qa` and `run_regression_suite` return `expert_checklist` with `claim_pass_allowed`, blockers, host_actions
- HTML report includes Expert checklist section
- Skills must honor `claim_pass_allowed` — no green-wash
- `docs/NEXT.md` — split user vs agent remaining work

### Expert-level Skill upgrade E1–E5 (2026-08-11)

- Expert bar: refuse pass without gate + coverage_gaps + retest plan (+ suite_id on serious A)
- G0 learning: must call failure-avoidance / learning candidates before execute
- G0d domain pack: `domain-knowledge/` or `.qa-domain/` + templates under `hosts/templates/domain-knowledge/`
- E2 mandates in workflow: role compare; OpenAPI authz negatives when applicable
- E4: exploratory must close loop (AC confirm → run_auto_qa → suite)
- E5: PRODUCT.md honest scoped-Expert vs human accountability
- RULES.md items 11–13

### Skills simplified to test + dev (2026-08-11)

- Removed `:local` / `:staging` skills — environment inferred from user URL
- Only `/qa-intelligence:test` and `/qa-intelligence:dev`
- Retest section strengthened: `case_ids`, `related_defect_ids`, one screen URL, `execute_generated_test_case`; serious runs must register regression suite

### Expert Tester Skills — local / staging / tester (2026-08-11)

- Shared gates G0–G8: `hosts/references/expert-tester-workflow.md`
- Skills: `local`, `staging`, `test`, `dev` (router) on Claude Code, Cursor, Codex
- Same Expert process for every role; only AC provenance + env hygiene differ
- Raises process maturity (forced gate/gaps/retest); evidence still via MCP tools

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
