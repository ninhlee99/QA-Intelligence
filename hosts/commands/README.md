# Slash command map (host Skills)

These names match Claude Code / Cursor / Codex skill triggers.
All share `hosts/references/expert-tester-workflow.md` (G0–G8).

| Command | Skill | Who | Target |
|---------|-------|-----|--------|
| `/qa-intelligence:local` | `local` | Dev | localhost |
| `/qa-intelligence:staging` | `staging` | Dev / QA | staging allowlist |
| `/qa-intelligence:test` | `test` | Tester | URL + spec |
| `/qa-intelligence:dev` | `dev` | Dev | routes → local or staging |

Every command must end with the **Output contract** (gate → gaps → retest → artifacts).
Evidence steps call MCP `qa-intelligence` tools.
