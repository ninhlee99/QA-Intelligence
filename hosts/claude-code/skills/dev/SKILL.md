---
name: dev
description: >
  Dev-side QA workflow for QA Intelligence. Reads the target screen's source
  code in this repo to derive acceptance criteria and test cases, then drives
  the `qa-intelligence` MCP server (dev-entrypoint, local domain) to discover,
  generate, execute, and report — no live spec/tester input required.
  Trigger: "/qa-intelligence:dev", "test this screen locally", "run dev QA",
  "test against localhost with qa-intelligence".
---

# QA Intelligence — Dev Workflow

Purpose: let a developer validate a screen they just built, using the code
itself as the source of truth for what "correct" means, before it ever
reaches a tester.

This is the **code-first** counterpart to `/qa-intelligence:test` (tester
workflow, UI-first, spec-first). Same MCP tools, same output shapes — the
difference is only where acceptance criteria come from.

## Preconditions

- The `qa-intelligence` MCP server is connected (`hosts/claude-code/.claude-plugin/plugin.json` → `dev-entrypoint.js`). If tool calls 404/fail, tell the user to run `npm run build` first (see `hosts/README.md`).
- The target screen is running locally (dev server up) and reachable at a `localhost`/`127.0.0.1` URL. Ask for the URL and port if not given.

## Procedure

1. **Find the screen's source.** Locate the component/route/page backing the target URL in this repo (router config, page component, form component). Read it — don't guess.
2. **Derive acceptance criteria from code, not assumption.** For each field/action the component renders, extract:
   - required vs optional fields, and their validation rules (regex, min/max length, type) straight from the code (schema, validator, form config).
   - the success-path text/state the code renders after a correct submit (the literal string or i18n key) — this becomes `expected_text`.
   - each criterion statement must name the field/action's accessible name as the UI will expose it (label text, `aria-label`, button text) — match what Discovery will actually see, not the internal prop name.
   - if code and any existing spec/comment disagree, note the conflict; do not silently prefer one.
3. **Run the pipeline** via `run_auto_qa` against the local URL, passing the derived `acceptance_criteria`. Supply `login_url` + the five `username_field_name`/`username`/`password_field_name`/`password`/`submit_action_name` fields together if the screen is session-gated (all six or none). Set `output_path` to write the HTML report to disk (default `docs/qa-reports/dev/<screen>-<date>.html` under this repo unless the user asks otherwise).
4. **If `run_auto_qa` reports criteria that couldn't bind to a discovered field/action**, treat that as a real finding: either the code exposes a different accessible name than assumed (re-check step 1), or the code has a bug (field missing / mislabeled). Say which.
5. **Persist the generated test cases for reuse.** Save the `test_cases` + `generated_assertions` arrays from the response as JSON next to the report (e.g. `docs/qa-reports/dev/<screen>-<date>.testcases.json`) — this is the E2E artifact `/qa-intelligence:test` and future dev runs replay via `execute_generated_test_case`.
6. **Summarize**: pass/fail counts, any unbindable criteria, path to the HTML report, path to the saved test case JSON.

## Retesting against a real domain after deploy

Once the screen is deployed to staging/prod, replay the *same* saved test
cases against the real domain instead of regenerating from scratch:

- Load the saved `<screen>-<date>.testcases.json`.
- For each entry, call `execute_generated_test_case` with that exact
  `test_case` + `generated_assertion` object, supplying `field_values` for
  real credentials/data if the positive variant needs them.
- The tool executes against whatever URL the test case's own navigate step
  points to — if that's still `localhost`, ask the user for the staging URL
  and confirm whether to regenerate against it (`generate_test_cases` /
  `run_auto_qa` again with the same `acceptance_criteria` but new `url`)
  instead of reusing a case pinned to a different origin.

## Non-goals

- Do not invent acceptance criteria that aren't traceable to code or an
  explicit spec the user pastes in-conversation.
- Do not fabricate credentials — ask the user for real login values, or use
  values already present in local fixtures/seed data.
- Not for testing screens with no local source in this repo — use
  `/qa-intelligence:test` instead.
