---
name: dev
description: >
  Dev-side QA workflow for QA Intelligence. Reads local screen source to
  derive acceptance criteria, then drives qa-intelligence MCP
  (discover → a11y naming smoke → generate → execute → draft defects →
  release gate) against localhost before handing to a tester.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "run dev QA",
  "test against localhost with qa-intelligence".
---

# QA Intelligence — Dev Workflow (Senior QA stance)

Validate a screen you just built using **code as AC source**, then exercise
the live UI through MCP. Same tools/output shapes as `/qa-intelligence:test`.
Act like a careful QA peer-reviewer for your own change — not a green-CI cheerleader.

## Preconditions

- MCP connected (`npm run build` if tools fail). See `hosts/README.md`.
- Target running on `localhost` / `127.0.0.1`. Ask URL/port if missing.
- Do **not** use `execute_browser_test` (DEMO seeded plans only). Use `run_auto_qa`.

## Procedure

1. **Find the screen source** (route/page/form). Read it — don't guess.
2. **Derive AC from code:** required/optional + validation rules; success/error text → `expected_text`; accessible names as the UI exposes them (label/`aria-label`/button text). Note code↔comment conflicts; don't silently pick one.
3. **`run_auto_qa`** against the local URL with derived `acceptance_criteria`. Add login_* sextet if session-gated. Set `output_path` (default `docs/qa-reports/dev/<screen>-<date>.html`). Pipeline includes **a11y naming smoke** + flake-aware execution + draft defects + release gate.
4. **If generation_findings (unbindable AC):** either wrong accessible name assumption or missing/mislabeled control — say which after re-checking source.
5. **Optional:** `generate_exploratory_charter` for manual edge hunting; `assess_defect_quality` on serious drafts before asking a tester to file.
6. **Persist:** `test_cases`+`generated_assertions` JSON beside the report; save `draft_defects` if any.
7. **Summarize gate-first:** `release_recommendation` → fails/flakes/a11y critical → unbound AC → residual risks → artifact paths. State scope limit (single surface; naming smoke ≠ WCAG).

## After deploy

Replay saved testcases via `execute_generated_test_case` against staging URL (update navigate target / field_values as needed). Regenerate with `run_auto_qa` when UI or AC changed.

## Non-goals

- Inventing AC not in code
- Claiming production readiness from localhost alone
- DEMO `execute_browser_test` against real apps
