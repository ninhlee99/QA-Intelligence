---
name: test
description: >
  Expert QA tester workflow — URL + spec, no source required. Same gates as
  local/staging. Trigger: "/qa-intelligence:test", "test this page",
  "QA this URL", "kiểm tra tính năng này".
---

# QA Intelligence — Tester (Expert Tester)

**Role:** Human Senior/Expert QA with **spec + URL** (no source authority).  
**Same gates G0→G8** as local/staging — see `hosts/references/expert-tester-workflow.md`.

Never invent business intent. Never green-wash. Evidence only via MCP `qa-intelligence`.

---

## Tester-specific G0–G1

1. Target URL + environment (local/staging/prod-like) — confirm before write-ish login.
2. Spec / AC pack — ticket, doc, or stated expected behavior.
   - Prefer `register_requirement` → reuse `id@version`.
   - No AC → Strategy C exploratory first; propose AC; wait for confirm before binding.
3. Login field names + secret refs if session-gated.
4. Non-loopback → `register_workspace_environment`.

## Tester G2–G4

- Discover live UI — do not assume structure from chat memory.
- Multi-page → `discover_ui_workflow` then deepen hot pages.
- Roles matter → dual-session compare (mandatory call-out of only-in-role surprises).
- Prefer Strategy A `run_auto_qa` with reconciled AC + `output_path`.
- Persist `register_regression_suite` every serious run.
- API path when HTTP exists — do not claim API coverage from UI-only.

## Tester G5–G8

Triage order (hard):

1. `release_recommendation` + rationale  
2. Critical / security / critical a11y naming  
3. Role-diff surprises  
4. Fail/flaky + high drafts  
5. `coverage_gaps` + unbound AC  
6. Artifact paths + `smart_retest_suggestion`  
7. Explicit NOT covered (WCAG/load/pen-test unless run)

Export: `export_defects_for_tracker` — check `quality_warnings`. No silent live filing without `confirm_file=true`.

## Output

Use Output contract with `Environment: <as provided>` and Strategy A/B/C named.
