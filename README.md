# QA Intelligence

[![CI](https://github.com/ninhlee99/QA-Intelligence/actions/workflows/repository-validation.yml/badge.svg)](https://github.com/ninhlee99/QA-Intelligence/actions/workflows/repository-validation.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-24-green.svg)](.nvmrc)
[![Status](https://img.shields.io/badge/status-0.9.0--release--candidate-orange.svg)](CHANGELOG.md)

**Production-oriented MCP server that acts as an Expert QA Engineer** inside Claude Code, Cursor, Codex, and Antigravity.

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

Slash syntax depends on the host. If unavailable, ask the agent to use the QA
Intelligence `test` or `dev` skill; both converge on the canonical
`run_expert_qa` workflow.

Env (local/staging) = **endpoint URL**, not a separate command.  
Retest: by `case_ids`, defect ids, or one screen URL — see [`hosts/references/expert-tester-workflow.md`](hosts/references/expert-tester-workflow.md).

## Quick start

```sh
git clone https://github.com/ninhlee99/QA-Intelligence.git
cd QA-Intelligence
npm install
npx playwright install chromium
npm run build
npm install --global .
```

**Hướng dẫn chi tiết (cài MCP, Skill, dùng tool, đọc report):**  
**[docs/GUIDE.md](docs/GUIDE.md)**

Connect one host (tóm tắt — chi tiết trong GUIDE):

| Host | Setup |
|------|--------|
| **Claude Code** | Plugin: `hosts/claude-code/` plus `qa-intelligence-mcp` |
| **Cursor** | Copy `hosts/cursor/mcp.json.example` plus Skills `hosts/cursor/skills/` |
| **Codex** | Validated plugin at `hosts/codex/` |
| **Antigravity** | Copy `hosts/antigravity/mcp_config.json.example`; reuse the open-standard Skills |

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
| `run_expert_qa` | **Canonical full run:** domain context → discovery → design → execution → evidence → report |
| `validate_expert_claim` | Before any pass/ready/ship wording |
| `run_regression_suite` | Retest after fix (`case_ids` / `related_defect_ids`) |
| `discover_ui_workflow` | Multi-page product |
| `discover_and_compare_role_ui_surfaces` | Permission / role gaps |
| `execute_api_smoke` | Standalone HTTP contract checks (or pass `openapi` to `run_expert_qa`) |
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
npm run mcp:start          # production-local stdio MCP
npm run mcp:fixture        # development fixture only
npm run mcp:remote:demo    # development-only HTTP identity demo
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

## Status

`0.9.0` release candidate. Production-local stdio is the supported deployment:
the coding-agent host is the trust boundary and configuration fails closed.
Remote/team deployment remains unsupported until an external IdP, membership
store, secret manager and operational attestations pass the release gates.

## License

[MIT](LICENSE)
