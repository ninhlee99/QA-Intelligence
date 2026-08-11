# QA Intelligence

[![CI](https://github.com/ninhlee99/QA-Intelligence/actions/workflows/repository-validation.yml/badge.svg)](https://github.com/ninhlee99/QA-Intelligence/actions/workflows/repository-validation.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-green.svg)](.nvmrc)
[![Status](https://img.shields.io/badge/status-0.1.0--dev-yellow.svg)](CHANGELOG.md)

**MCP server that acts as an Expert QA Engineer** inside Claude Code, Cursor, and Codex.

Point it at a live URL + spec. It discovers the UI, designs risk-based tests, executes with Playwright, drafts defects with evidence, and returns a **release gate** — not a green pass count.

```text
You:  /qa-intelligence:test  https://staging.example.com/login
Agent:
  G0 assess → G1 env → G2 discover → G3 bind AC → G4 execute
  → G5 release gate → G6 coverage_gaps → G7 artifacts → G8 next action
```

**Skills:**

| Trigger | Role |
|---------|------|
| `/qa-intelligence:test` | Tester — URL + spec |
| `/qa-intelligence:dev` | Dev — URL + AC from source |

Env (local/staging) = **endpoint URL**, not a separate command.  
Retest: by `case_ids`, defect ids, or one screen URL — see [`hosts/references/expert-tester-workflow.md`](hosts/references/expert-tester-workflow.md).

## Quick start

```sh
git clone https://github.com/ninhlee99/QA-Intelligence.git
cd QA-Intelligence
npm install
npx playwright install chromium
npm run build
```

**Hướng dẫn chi tiết (cài MCP, Skill, dùng tool, đọc report):**  
**[docs/GUIDE.md](docs/GUIDE.md)**

Connect one host (tóm tắt — chi tiết trong GUIDE):

| Host | Setup |
|------|--------|
| **Claude Code** | Plugin: `hosts/claude-code/` → `:test` / `:dev` + MCP entrypoint |
| **Cursor** | Copy `hosts/cursor/mcp.json.example` (**absolute** path) + Skills `hosts/cursor/skills/` |
| **Codex** | Plugin / config: `hosts/codex/` |

**Scope:** Skill + MCP = **test + report** only (no SNS / Slack notify).

## Why this exists

Most AI “QA” tools dump scripts or cheerlead green CI. This one behaves like a senior tester:

| Always | Never |
|--------|--------|
| Surfaces `coverage_gaps` | Fabricates a pass |
| Gives `smart_retest_suggestion` | Invents `confirmed_cause` |
| Links fail traces in HTML report | Claims WCAG / load / pen-test not run |
| Warns before defect export | Puts passwords on the MCP wire |

Rules: **[RULES.md](RULES.md)** · Idea: **[docs/PRODUCT.md](docs/PRODUCT.md)** · Workflow: **[hosts/references/expert-tester-workflow.md](hosts/references/expert-tester-workflow.md)** · Domain pack: **[hosts/references/domain-pack.md](hosts/references/domain-pack.md)**

## Core tools

| Tool | Use when |
|------|----------|
| `run_expert_qa` | **Preferred** Expert entry: domain pack + full pipeline |
| `run_auto_qa` | Full pipeline on a URL + AC (auto suite, optional E2 hooks) |
| `validate_expert_claim` | Before any pass/ready/ship wording |
| `run_regression_suite` | Retest after fix (`case_ids` / `related_defect_ids`) |
| `discover_ui_workflow` | Multi-page product |
| `discover_and_compare_role_ui_surfaces` | Permission / role gaps |
| `execute_api_smoke` | HTTP contract checks (or via `openapi` on run_auto_qa) |
| `export_defects_for_tracker` | Paste-ready defect **text** (tester pastes tracker manually) |

Full catalog + durable dirs: **[hosts/README.md](hosts/README.md)**  
Install & usage (detailed): **[docs/GUIDE.md](docs/GUIDE.md)**

## Repo layout

```text
src/           Expert QA MCP implementation
hosts/         Claude Code / Cursor / Codex packages + Skills
docs/          PRODUCT + GUIDE
tests/         Automated tests
archive/       Historical SPECs/ADRs/GOV (not required to run)
ontology/      Runtime semantic vocabulary
schemas/       Optional JSON Schema examples
```

## Develop

```sh
npm run typecheck
npm test
npm run mcp:dev      # stdio MCP
npm run mcp:remote   # HTTP MCP + demo token on stderr
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Status

`0.1.0-dev` — usable against real targets in development hosts.  
Production IdP / Vault / GOV production gates are not claimed yet.

## License

[MIT](LICENSE)
