---
name: test
description: >
  Expert QA tester — one MCP call, visible browser. Trigger: "/qa-intelligence:test".
---

# test (Codex)

Fast path: `run_expert_qa` with `headed: true`. Skip extra discover. Never `include_report_html`.

Keep the automatic standard evidence profile: PNG per executed case, trace/WebM on non-pass. Use `video_policy: all` only for complete audit video.

Paste gate + case results matrix + `report_path`. Pass only after `validate_expert_claim`.
