# Dogfood findings — companytools bug retest (DJ keyword AND/OR search)

Source: real dogfood on repo `daijob6_companytools`, retesting bug "keyword search
wrong when using or/and" via the `/qa-intelligence:dev` skill. Records the
bugs/gaps hit while using `run_expert_qa`, `run_auto_qa`, `generate_test_cases`,
`discover_ui_surface*`, and chrome-devtools MCP, plus fix proposals from an
expert-tester point of view.

Date: see git blame. Tester: dogfood session via Claude Code.

**Status (2026-08-12):** BUG-1/2/3 + GAP-1/2/3/4 shipped on `fix/dogfood-bugs-and-gaps`.
WORKFLOW-1 (AC binding) documented in Expert workflow — not a "headless" bug.

---

## Real root cause (retest browser got stuck)

The tool **does** use a real browser (Playwright/Chrome). Not "simulated HTTP"
or "headless vs real".

Two layers:

1. **Discovery** — opens the real page, lists Semantic UI elements → usually OK.
2. **Test generation** — AC text → bind element + type/click/select + oracle.
   AC that only describes business logic ("OR must be broader than AND")
   **is not enough** → the generator **deliberately refuses to invent** the
   action (SPEC-207 §6) → unbound / skip.

Fix to match real end-user behavior: **discover first → write AC as
action + input + oracle** (using the real `accessible_name` from the map).
Comparing 2 searches: 2 cases + absolute `expected_result_count` (or manual
comparison); seed fixture data, don't rely on random dev DB state. Detail:
`hosts/references/expert-tester-workflow.md` § G2→G3.

---

## Bugs

### BUG-1 / BUG-2 / BUG-3 — ✅ Fixed
See commit `fix(dogfood): unblock expert QA diagnostics and login UX`.

---

## Gaps / features

### GAP-1…4 — ✅ Fixed (see GAP feat commit)
### GAP-5 chrome-devtools — Open / out of repo scope
### WORKFLOW-1 AC binding — ✅ Documented (skill + workflow); code does not "auto-infer" AC

---

## Next (when companytools is ready)

1. `discover_ui_surface_after_login` on `/resume_searches/new`
2. Rewrite AC with `キーワード` / `検索` (or the real label) + `expected_result_count`
3. `run_expert_qa` / `lite_mode` + `include_screenshot` — real type+submit in browser
4. Compare AND vs OR counts on seeded fixture
