---
name: test
description: >
  Tester-side QA workflow for QA Intelligence. Tester supplies a spec/target
  URL/test info; the agent drives the `qa-intelligence` MCP server against
  the live target like a Senior QA: discover, reconcile AC, run_auto_qa
  (scripted variants + a11y naming smoke + draft defects + release gate),
  optional exploratory charter, then triage. Never invent business intent.
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
  2. **Spec / AC** — ticket, doc, or stated expected behavior per field/action (formats matter: dates, currency, error copy). No AC → discovery only; ask for expected behavior.
  3. Login field names + credentials if session-gated (or discover login page first).
- Do **not** call `execute_browser_test` for real targets — that tool is **DEMO-ONLY** (seeded TC-DEMO-*). Use `run_auto_qa` / `execute_generated_test_case`.

## Procedure (human-like order)

1. **Orient.** If the tester brought a formal requirement id that may be seeded, optionally `assess_requirement_quality` first to surface AC/traceability gaps — then still reconcile against the live UI.
2. **Discover live UI — do not assume structure.** `discover_ui_surface` or `discover_ui_surface_after_login`. Read fields/actions/accessible names.
3. **Reconcile spec ↔ UI.** Bind each AC statement to a real accessible name. Flag unbound AC (spec drift or bug) — never force a fake binding.
4. **Encode format oracles** in `expected_text` (exact rendered success/error text, date formats, etc.).
5. **Run the professional pipeline.** Prefer `run_auto_qa` with reconciled `acceptance_criteria` + `output_path`. One call now includes: discover → **a11y naming smoke** → generate variants → execute (flake-aware) → draft defects → residual risks → **release_recommendation**. Read `prior_failure_avoidance_hints` when present (Phase 11 Session Memory from earlier drafts in this MCP process).
6. **Optional depth (same session):**
   - `list_failure_avoidance_hints` — before or after a run, list retained avoidable-mistake hints.
   - `generate_exploratory_charter` — time-boxed manual exploration beyond scripted variants.
   - `execute_exploratory_session` — Phase 9: actually capture + auto-check oracles; pass `browsers: ["chromium","firefox"]` for multi-browser parity.
   - `assess_defect_quality` on serious `draft_defects[]` before the tester files a ticket.
   - Document-quality assessors (Phase 7) when the tester brought governed docs: `assess_risk_quality`, `assess_test_strategy_quality`, `assess_test_case_quality`, `assess_report_quality`, etc. — review paper contracts; do not invent missing fields.
   - `execute_api_smoke` when the target also exposes HTTP APIs (status/body/header asserts; use `bearer_token_secret_ref` after `register_workspace_secret`). Infra failures are not product fails.
   - `run_depth_smokes` for WCAG-subset / perf / security heuristics — if `has_critical`, lead with that; not a substitute for naming smoke inside `run_auto_qa`.
   - Standalone `assess_ui_accessibility_smoke` only if you need a11y without re-running full QA (normally already inside `run_auto_qa`).
7. **Triage like a Senior QA** (order matters):
   1. `release_recommendation` + rationale
   2. Critical/security drafts + critical a11y naming
   3. Fail/flaky counts + high draft defects
   4. Unbindable AC / not_executed / residual risks
   5. Artifact paths (HTML, testcases JSON, defects JSON)
   6. Scope limit: one surface + supplied AC + naming smoke — not full WCAG/API/perf/portfolio
8. **Persist.** Save `test_cases`+`generated_assertions`, and `draft_defects` if any. Do not auto-file to Jira.

## Triage rules

- `do_not_release` / `security_incident` / severity critical → lead with that; stop cheerleading green counts.
- Critical a11y naming (`unlabeled_editable_field`) → `changes_required`; treat as blocking for release readiness until labels fixed.
- `investigate_flakes` → not green; propose one stable replay.
- Never set/imply `confirmed_cause`.
- Never count `not_executed` or unbound AC as pass.

## Regression replay

Load prior `.testcases.json` → `execute_generated_test_case` per entry (now flake-aware like `run_auto_qa`). For fresh draft defects + gate after UI/spec change, re-run `run_auto_qa` instead of replay-only.

## Non-goals

- Inventing AC / business intent
- Production credentials without explicit approval
- Claiming full WCAG, API, or performance coverage
- Using `execute_browser_test` against non-demo targets
