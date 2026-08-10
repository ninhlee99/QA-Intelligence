---
name: dev
description: >
  Dev-side QA workflow for QA Intelligence. Reads local screen source to
  derive acceptance criteria, registers them, then drives qa-intelligence
  MCP (discover → run_auto_qa → regression suite → optional OpenAPI smoke)
  against localhost before handing to a tester.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "run dev QA",
  "test against localhost with qa-intelligence".
---

# QA Intelligence — Dev Workflow (Senior QA stance)

Validate a screen you just built using **code as AC source**, then exercise
the live UI through MCP. Same tools/output shapes as `/qa-intelligence:test`.
Act like a careful QA peer-reviewer for your own change — not a green-CI cheerleader.

## Preconditions

- MCP connected (`npm run build` if tools fail). See `hosts/README.md`.
- Target running on `localhost` / `127.0.0.1` (loopback allowed without env register).
- Do **not** use `execute_browser_test` (DEMO seeded plans only). Use `run_auto_qa`
  / `run_regression_suite`.

## Procedure

1. **Find the screen source** (route/page/form). Read it — don't guess.
2. **Derive AC from code:** required/optional + validation; success/error →
   `expected_text`; accessible names as UI exposes them. Note code↔comment
   conflicts; don't silently pick one. Optional URL/title oracles when
   navigation changes (`expected_url_includes` / `expected_title_includes`).
3. **`register_requirement`** with derived AC (scope stays this Workspace).
   Keep the returned `requirement_ref` (`id@version`) for later tools.
4. **Discover.** `discover_ui_surface` on the local URL. If the change spans
   multiple routes, `discover_ui_workflow` then `generate_journey_test_cases`
   from `pages`+`edges`, and spot-check hot pages.
5. **`run_auto_qa`** against the local URL with derived `acceptance_criteria`
   (+ `requirement_ref`). Add login_* / secret refs if session-gated. Set
   `output_path` (default `docs/qa-reports/dev/<screen>-<date>.html`).
6. **If generation_findings (unbindable AC):** wrong accessible name or
   missing control — say which after re-checking source.
7. **Register regression suite** from generated `test_case` +
   `generated_assertion` pairs via `register_regression_suite` so the next
   local rebuild can `run_regression_suite` without regenerating everything.
8. **API (when this screen calls your HTTP API).** If OpenAPI/JSON exists in
   repo, `generate_api_smoke_from_openapi` → `execute_api_smoke` on local
   base URL. Add one protected-route case expecting 401/403 when auth exists.
9. **Optional:** `generate_exploratory_charter`; `assess_defect_quality` on
   serious drafts; `export_defects_for_tracker` before asking a tester to file.
10. **Persist:** report HTML + testcases JSON + suite id; save drafts if any.
11. **Summarize gate-first:** `release_recommendation` → fails/flakes/a11y
    critical → unbound AC → residual risks → artifact paths + suite id.
    State scope limit (local surface; naming smoke ≠ WCAG).

## After deploy / on staging

1. `register_workspace_environment` for staging base URL if required.
2. `run_regression_suite` (update `base_url` / field values as needed) **or**
   regenerate with `run_auto_qa` when UI/AC changed.
3. Role-sensitive change → two discoveries + `compare_ui_surfaces`.
4. Retest loop: fix → `run_regression_suite` → only then claim green.

## Non-goals

- Inventing AC not in code
- Claiming production readiness from localhost alone
- DEMO `execute_browser_test` against real apps
- Claiming full API/authz matrix from a single 200 smoke
