---
name: test
description: >
  Tester-side QA workflow for QA Intelligence. Tester supplies a spec/target
  URL/test info; the agent drives the `qa-intelligence` MCP server against
  the live target (discover UI, analyze it, write test cases — covering UI
  fields, actions, and formats like dates), executes them, and produces an
  HTML report plus a reusable E2E test case JSON.
  Trigger: "/qa-intelligence:test", "test this page", "QA this URL",
  "run QA against staging/prod", "generate test cases from this spec".
---

# QA Intelligence — Tester Workflow

Purpose: let a tester who only has a spec and a target URL (no access to
source) get the target screen analyzed and tested through the real UI.

This is the **UI-first** counterpart to `/qa-intelligence:dev` (dev
workflow, code-first). Same MCP tools, same output shapes — the difference
is only where acceptance criteria come from and which environment is
exercised.

## Preconditions

- The `qa-intelligence` MCP server is connected. If tool calls 404/fail, tell the user to run `npm run build` first.
- Ask the tester for what's missing before starting:
  1. **Target URL** (staging/prod/whatever environment they mean).
  2. **Spec / test info** — a requirement doc, acceptance criteria, ticket, or plain description of what the screen should do. If they only give a URL with no spec, say discovery can map the UI but acceptance criteria still need *something* to test against — ask them to state expected behavior per field/action (including any format rules, e.g. "date must show as DD/MM/YYYY").
  3. Login credentials + field names if the target is session-gated (or let Discovery find the login form first).

## Procedure

1. **Discover the live UI first — do not assume structure.** Call `discover_ui_surface` (or `discover_ui_surface_after_login` if session-gated) on the target URL to get the real Semantic UI Map: fields, actions, accessible names, current text/format on screen.
2. **Reconcile spec against what's actually there.** Match each spec/acceptance-criteria statement to a discovered field or action by its accessible name. Flag anything in the spec that has no matching element (possible bug or spec drift) — don't force a binding that isn't real.
3. **Pay attention to format details called out in the spec or visible on screen**: date formats, number/currency formats, locale text, placeholder text, error copy. Encode these as `expected_text` on the relevant criterion so generation checks the exact rendered format, not just "a date appears."
4. **Generate test cases.** Prefer `run_auto_qa` (discover + generate + execute + report in one call) with the reconciled `acceptance_criteria`; use `generate_test_cases` + `execute_generated_test_case` separately if you need to inspect/adjust generated cases before running them (e.g. to fill in real field values only after seeing what was generated).
5. **Get the HTML report.** Set `output_path` so the run writes a self-contained HTML file (e.g. `docs/qa-reports/test/<target>-<date>.html`). Report location + pass/fail summary back to the tester.
6. **Persist test cases as an E2E artifact.** Save the response's `test_cases` + `generated_assertions` arrays as JSON (e.g. `docs/qa-reports/test/<target>-<date>.testcases.json`). This is what makes the next run replayable without re-discovering or re-generating: future calls can feed the same objects straight into `execute_generated_test_case`.
7. **Summarize for the tester**: what was covered (per field: positive/negative/boundary/adversarial), what couldn't be bound to a real element, pass/fail counts, report path, test case JSON path.

## Reusing saved test cases on a later run

Load the prior `<target>-<date>.testcases.json` and call
`execute_generated_test_case` per entry instead of regenerating — same
target, faster feedback, catches regressions against the exact cases already
reviewed. Only regenerate (`generate_test_cases`/`run_auto_qa`) when the
spec or the UI itself changed.

## Non-goals

- Do not fabricate acceptance criteria the tester didn't provide or that
  aren't visible on the discovered UI — ask instead of guessing business
  intent.
- Do not use real production credentials without the tester's explicit
  say-so; confirm which environment before running anything against it.
- Not for screens only reachable via this repo's local dev server with no
  spec — that's `/qa-intelligence:dev`.
