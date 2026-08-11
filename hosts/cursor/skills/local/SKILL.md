---
name: local
description: >
  Expert QA against localhost via qa-intelligence MCP. Same Expert Tester
  gates as staging/tester. Trigger: "/qa-intelligence:local", "QA localhost".
---

# Local — Expert Tester (Cursor)

Follow canonical workflow: `hosts/references/expert-tester-workflow.md` (G0–G8).  
Role details: `hosts/claude-code/skills/local/SKILL.md`.

MCP: configure via `hosts/cursor/mcp.json.example`, then `npm run build`.
Output: Environment `local` + Output contract from the reference.
