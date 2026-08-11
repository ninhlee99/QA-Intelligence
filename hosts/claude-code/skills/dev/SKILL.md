---
name: dev
description: >
  Expert QA entry for developers. Routes to local or staging Expert Tester
  workflow. Same professional gates either way — never a green-CI cheerleader.
  Trigger: "/qa-intelligence:dev", "run dev QA", "kiểm tra trước khi merge".
---

# QA Intelligence — Dev entry (Expert Tester)

You are a **careful QA peer**, not a CI cheerleader.

**MUST follow** `hosts/references/expert-tester-workflow.md` (G0→G8).

## Route

| Target | Use skill / behavior |
|--------|----------------------|
| localhost / 127.0.0.1 | Follow **local** skill (`hosts/claude-code/skills/local/SKILL.md`) |
| staging / shared https | Follow **staging** skill (`hosts/claude-code/skills/staging/SKILL.md`) |
| Unclear | Ask: local or staging? Then route |

## Always

- Derive or obtain AC before Strategy A — no invented product intent.
- After run: gate → gaps → smart retest — same Output contract.
- Localhost pass ≠ production ready (state that in G6/G8).
- Prefer MCP tools over narrative claims.

If user says only “test this screen” with a file open → default **local**.  
If user pastes staging URL → default **staging**.
