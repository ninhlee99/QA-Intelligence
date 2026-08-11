---
name: test
description: >
  Expert QA tester — auto domain pack from request. Trigger: "/qa-intelligence:test".
---

# test (Cursor)

Follow `hosts/references/expert-tester-workflow.md` + `hosts/references/domain-pack.md`.  
Details: `hosts/claude-code/skills/test/SKILL.md`.

Prefer MCP `bootstrap_domain_pack` + `run_auto_qa` (auto suite_id). Do not re-register suite when `auto_registered_suite.suite_id` present.
