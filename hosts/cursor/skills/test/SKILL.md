---
name: test
description: >
  Expert QA tester — auto domain pack from request. Trigger: "/qa-intelligence:test".
---

# test (Cursor)

Follow `hosts/references/expert-tester-workflow.md` + `hosts/references/domain-pack.md`.  
Details: `hosts/claude-code/skills/test/SKILL.md`.

Prefer MCP `run_expert_qa` (product_root) or `bootstrap_domain_pack` + `run_auto_qa`. Do not re-register suite when `auto_registered_suite.suite_id` present. Read `flake_taxonomy` + `learning`.
