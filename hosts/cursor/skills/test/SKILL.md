---
name: test
description: >
  Expert QA tester — one MCP call, visible browser. Trigger: "/qa-intelligence:test".
---

# test (Cursor)

Fast path: `run_expert_qa` with `headed: true`. Do **not** discover first (pipeline rediscovers). Never `include_report_html`.

Keep the automatic standard evidence profile: PNG per executed case, trace/WebM on non-pass. Use `video_policy: all` only for complete audit video.

Paste: `release_recommendation` + **case results** table (id / variant / outcome / evidence) + `report_path`.

Pass wording only after `validate_expert_claim`. Details: `hosts/references/expert-tester-workflow.md`.
