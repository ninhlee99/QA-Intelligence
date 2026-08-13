---
name: dev
description: >
  Expert QA for developers — one MCP call. Trigger: "/qa-intelligence:dev".
---

# dev (Cursor)

`run_expert_qa` + `headed: true` + `product_root` = this repo. Skip extra discover. Never `include_report_html`.

Paste gate + case matrix + `report_path`. After fix: `run_regression_suite`. Merge-ready only after `validate_expert_claim`.
