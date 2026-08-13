---
name: dev
description: >
  Expert QA for developers — URL + source AC. Fast path: one MCP call.
  Trigger: "/qa-intelligence:dev", "QA before merge", "retest this screen".
---

# QA Intelligence — dev

Same Expert bar as `:test`. Not a CI cheerleader. Workflow: `hosts/references/expert-tester-workflow.md`.

## Fast path

1. URL (ask if missing). AC from **source**; note code↔comment conflicts.
2. **Do not** discover first — `run_expert_qa` rediscovers. Rewrite AC only if names unknown.
3. `run_expert_qa` with `product_root` = this repo, `headed: true`.
   - `execute_extension_cases: false` unless roles/API/journey smell.
   - Never `include_report_html`.
4. Paste gate + **case results matrix** + `report_path`. After fix: `run_regression_suite` only.
5. Merge-ready wording only after `validate_expert_claim`. Localhost green ≠ production ready.
