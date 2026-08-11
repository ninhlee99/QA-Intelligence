---
name: test
description: >
  Tester-side QA workflow for QA Intelligence. Tester supplies a spec/target
  URL/test info; the agent drives the `qa-intelligence` MCP server against
  the live target like a Senior QA: ingest requirements, discover (page or
  workflow), reconcile AC, run_auto_qa, optional API/OpenAPI + regression
  suite, export defects, then triage. Never invent business intent.
  Trigger: "/qa-intelligence:test", "test this page", "QA this URL",
  "run QA against staging/prod", "generate test cases from this spec".
---

# QA Intelligence — Senior QA / Tester Workflow

Act as a human Senior QA/QC who only has a spec + URL (no source). Evidence
over opinions. Never fabricate a pass. Never invent acceptance criteria.

## Preconditions

- MCP `qa-intelligence` connected (`npm run build` if tools 404).
- Collect before acting:
  1. **Target URL** + environment (staging/prod) — confirm before any write-ish login.
  2. **Spec / AC** — ticket, doc, or stated expected behavior. Prefer
     `register_requirement` so later tools reuse `id@version`. No AC →
     discovery only; ask for expected behavior.
  3. Login field names + credentials if session-gated (or discover login page first).
  4. Optional: register staging via `register_workspace_environment`
     (`environment:…` + `base_url`) before non-loopback http(s) discovery.
- Do **not** call `execute_browser_test` for real targets — **DEMO-ONLY**.
  Use `run_auto_qa` / `execute_generated_test_case` / `run_regression_suite`.

## Procedure (human-like order)

1. **Ingest requirement (when tester brought a real AC pack).**
   `register_requirement` with id/title/statement/acceptance_criteria.
   `list_requirements` to confirm `id@version`. Optionally
   `assess_requirement_quality` on the same object for AC/traceability gaps.
2. **Orient environment + secrets.**
   `register_workspace_environment` for staging base URL when needed.
   `register_workspace_secret` once; prefer `password_secret_ref` /
   `field_secret_refs` / API `*_secret_ref` afterward.
3. **Discover live UI — do not assume structure.**
   - Single screen: `discover_ui_surface` or `discover_ui_surface_after_login`.
   - Multi-page product: `discover_ui_workflow` (`max_pages` 3–5) — read
     `pages[]` + `edges[]`, then `generate_journey_test_cases` for click-chain
     E2E drafts (URL oracles). Deepen hot pages with `discover_ui_surface`.
4. **Role / permission spot-check (when two roles matter).**
   Discover once as role A and once as role B (separate sessions/credentials),
   then `compare_ui_surfaces` on the two `elements` arrays. Lead with
   only-in-admin / only-in-viewer surprises.
5. **Reconcile spec ↔ UI.** Bind each AC to a real accessible name. Flag
   unbound AC — never force a fake binding.    Prefer `option_label` when AC binds a selectable field; optional
   `wait_for_accessible_name` after submit. Prefer
   `expected_text` plus optional `expected_url_includes` /
   `expected_title_includes` / `expected_network` on the AC — generator
   copies them onto the positive `generated_assertion` (xhr/fetch:
   `url_includes` + optional method/status/`body_includes`).
6. **Run the professional UI pipeline.** Prefer `run_auto_qa` with
   reconciled `acceptance_criteria` + `output_path` (+ `requirement_ref`
   when registered). One call: discover → a11y naming smoke → generate
   variants → execute (flake-aware) → draft defects → residual risks →
   **release_recommendation**. Read `prior_failure_avoidance_hints` when present.
7. **Persist a regression pack (do this every serious run).**
   From `run_auto_qa` / generate outputs, call `register_regression_suite`
   with browser cases `{kind:"browser", test_case, generated_assertion}`
   (and API cases when applicable). Later: `list_regression_suites` →
   `run_regression_suite`.    Prefer durable path under `.qa-regression-suites/` (returned as
   `persisted_path`) so suites survive MCP restart for real regression.
8. **API path (when HTTP exists).**
   - Have OpenAPI JSON → `generate_api_smoke_from_openapi` with
     `include_authz_negatives: true` when routes are protected → review
     warnings → `execute_api_smoke` with `base_url` + secret refs.
   - Do not claim API coverage from happy 200s alone.
9. **Optional depth (same session):**
   - `list_failure_avoidance_hints`
   - `generate_exploratory_charter` / `execute_exploratory_session`
     (`browsers: ["chromium","firefox"]` for parity; default
     `include_live_probes=true` = empty-submit/click ≤2 + re-capture —
     **not** free-form exploratory automation)
   - `assess_defect_quality` on serious drafts
   - Document assessors / stubs only when tester brought governed docs
   - `run_depth_smokes` — if `has_critical`, lead with that; not a WCAG substitute
10. **Triage like a Senior QA** (order matters):
    1. `release_recommendation` + rationale
    2. Critical/security drafts + critical a11y naming
    3. Role-diff surprises from `compare_ui_surfaces`
    4. Fail/flaky counts + high draft defects
    5. Unbindable AC / not_executed / residual risks
    6. Artifact paths (HTML, testcases JSON, defects JSON, suite id)
    7. Scope limit: surfaces + AC exercised — not full WCAG/load/pen-test
11. **Export for tracker.** Prefer `export_defects_for_tracker` (paste). Optional
    `file_defects_to_tracker` is dry-run by default — only live-file with
    `confirm_file=true` + `bearer_token_secret_ref`. Do **not** invent
    `confirmed_cause`. Do not claim auto-filed without confirm.
12. **Retest loop after a fix.** Re-run `run_regression_suite` with
    `case_ids` or `related_defect_ids` (`DEF-DRAFT:<test_case_id>`) for
    subset — check `release_recommendation` + `draft_defects`, not pass
    count alone. Pass `field_values` when positives need fills.
    Optional: `create_automation_asset` with `regression_suite_id` binds
    governance metadata to that suite (still not a compiled script pack).

## Advanced catalog (optional)

- Stubs: `generate_business_analysis_stub`, `generate_risk_stub`,
  `generate_test_strategy_stub` — UI-map heuristics, not professional docs.
- Assessors: `assess_*_quality` on caller-supplied documents.
  `assess_requirement_quality` with empty scripted reasoning fail-softs
  (questions/uncertainty) — does not invent product authority.
- Learning: `raise_mistake_recurrence_candidate`, `list_failure_avoidance_hints`
  (Session Memory; never auto-promote).
- Knowledge: `register_knowledge_record` → `.qa-knowledge/` for
  `discover_product_context`.
- SSO bootstrap: `discover_ui_surface_after_login` with `sso_action_name`
  (+ optional MFA wait) — no invented IdP credentials.
- Journeys: pass caller-observed `expected_network` into
  `generate_journey_test_cases` when hops trigger a known API — never invent
  routes. Prefer `network_hints` from `discover_ui_workflow` as candidates
  only (confirm before bind).
- Role dual-session: `discover_and_compare_role_ui_surfaces` (role_a/role_b)
  or manual two discoveries + `compare_ui_surfaces`.
- Tracker export: `export_defects_for_tracker` includes evidence pack
  (screenshot/capture/outcome) — still paste-only unless `file_defects_to_tracker`.
- Datasets: `register_test_dataset` with synthetic `field_samples`, then
  `resolve_test_dataset_fields` → pass `field_values` into execute/regression.
  Passwords stay in `register_workspace_secret` / `field_secret_refs`.
- Visual baseline: `capture_ui_baseline` then `compare_ui_baseline` — exact
  PNG match only; mismatch is observation, not auto product fail.
- Surface baseline: after discover, `register_ui_surface_baseline` then
  `compare_ui_surface_to_baseline` for named-control drift.
- Learning: `list_learning_candidates` after repeated `run_auto_qa` drafts —
  never auto-promote. Hints/candidates survive MCP restart under
  `.qa-avoidance-hints/` / `.qa-learning-candidates/`.
- Fail evidence: screenshots + Playwright `.qa-traces/*.zip` (fail-only;
  open with `npx playwright show-trace`).

## Triage rules

- `do_not_release` / `security_incident` / severity critical → lead with that; stop cheerleading green counts.
- Critical a11y naming (`unlabeled_editable_field`) → `changes_required`.
- `investigate_flakes` → not green; propose one stable replay.
- Never set/imply `confirmed_cause`.
- Never count `not_executed` or unbound AC as pass.
- Authz gaps (role compare / 401-403 missing) → call out as residual risk.

## Regression replay

1. Preferred: `run_regression_suite` with prior `suite_id`.
2. Fallback: load prior `.testcases.json` → `execute_generated_test_case` per entry.
3. UI/spec changed materially → re-run `run_auto_qa` then re-register suite.

## Non-goals

- Inventing AC / business intent
- Production credentials without explicit approval
- Claiming full WCAG, load, or pen-test coverage
- Using `execute_browser_test` against non-demo targets
- Silent Jira filing / inventing confirmed root cause
