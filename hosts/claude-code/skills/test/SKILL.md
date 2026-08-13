---
name: test
description: >
  Expert QA tester — URL + spec. Fast path: one MCP call, no double-discover.
  Trigger: "/qa-intelligence:test", "test this page", "retest this case".
---

# QA Intelligence — test

MCP `qa-intelligence`. Evidence from tools only. Full gates: `hosts/references/expert-tester-workflow.md`.

## Fast path (default)

User already gave URL + AC (or suite_id for retest):

1. **Do not** call `discover_ui_surface*` first — `run_expert_qa` already discovers.
2. **Do not** ask G0's 5 questions if URL+AC present.
3. **One full-run call:** `run_expert_qa`; pass `product_root` when available.
   - `headed: true` — visible Playwright window (or MCP env `QA_INTELLIGENCE_HEADED=1`).
   - Keep the standard evidence profile: PNG per executed case, trace/WebM on non-pass. Use `video_policy: all` only for complete audit video.
   - `execute_extension_cases: false` unless roles / OpenAPI / multi-page journey smell.
   - Never set `include_report_html` (HTML lives at `report_path`).
4. Paste to user, in order:
   - `release_recommendation`
   - **Case results** table from `expert_session_report.markdown` (or `test_cases`: id / variant / outcome / evidence)
   - `coverage_gaps` + `report_path` + `suite_id`
5. Pass/ready/ship only after `validate_expert_claim({ proposed_claim, expert_checklist })`.

## Skip (token)

- `list_failure_avoidance_hints` unless retest/flake
- Second discover + rewriting AC when names already in AC
- Explicit evidence overrides unless the user requests a different retention/capture policy
- Full suite after fix → `run_regression_suite` + `case_ids`

## Hard refuses

No pass unless `expert_checklist.claim_pass_allowed` **and** `validate_expert_claim.allowed` for the exact wording. Human `release_signoff` still required.
Unbound / `not_executed` ≠ pass. Secrets only via `*_secret_ref`.
