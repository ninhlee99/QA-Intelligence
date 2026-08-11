# QA Intelligence

An MCP server that acts as an **Expert QA Engineer** inside Claude Code, Cursor, and Codex. Point it at a live URL + spec, and it discovers the UI, generates risk-based test cases, executes them, drafts defects with evidence, and gives you a release gate — without you guiding it step by step.

## Quick start (5 minutes)

```sh
git clone <repo-url> QA-Intelligence
cd QA-Intelligence
npm install && npm run build
```

Then connect your host (pick one):

| Host | Config |
|------|--------|
| **Claude Code** | Install plugin from `hosts/claude-code/` |
| **Cursor** | Copy `hosts/cursor/mcp.json.example` → Cursor MCP settings, replace path |
| **Codex** | Install plugin from `hosts/codex/` |

Full install instructions: [`docs/GUIDE.md`](docs/GUIDE.md)

## What it does

```
You: "QA this staging URL against this spec"

QA Intelligence:
  1. Discovers live UI  →  semantic element map
  2. Reconciles spec AC  →  flags unbound criteria
  3. Generates test cases  →  positive / negative / boundary / adversarial
  4. Executes with Playwright  →  flake-aware, screenshots + traces on fail
  5. Drafts defects  →  severity, evidence pack, no invented root cause
  6. Gives release gate  →  recommend_release / changes_required / do_not_release
  7. Reports coverage gaps  →  explicitly states what was NOT tested
```

Trigger inside any connected host:
- `/qa-intelligence:test` — tester workflow (URL + spec)
- `/qa-intelligence:dev` — developer workflow (read source → derive AC → test localhost)

## Expert QA principles

The agent **never**:
- Fabricates a pass when the release gate says otherwise
- Invents `confirmed_cause` — only `suspected_cause` + evidence
- Silently drops unbound AC or `not_executed` cases
- Claims WCAG/load/pen-test coverage it didn't perform

The agent **always**:
- Surfaces `coverage_gaps` in every run output
- Provides `smart_retest_suggestion` (exact `case_ids` to re-run after fix)
- Links trace `.zip` files in HTML reports for failed runs
- Warns before export if defects have quality issues

## Core MCP tools

| Tool | When to use |
|------|-------------|
| `run_auto_qa` | Full pipeline — discover → generate → execute → report |
| `run_regression_suite` | Re-run after a fix (subset by `case_ids` / `related_defect_ids`) |
| `discover_ui_workflow` | Multi-page product, builds page graph |
| `discover_and_compare_role_ui_surfaces` | Auth/permission testing |
| `execute_api_smoke` | HTTP API contract testing |
| `generate_exploratory_charter` + `execute_exploratory_session` | No spec available |
| `export_defects_for_tracker` | Markdown/Jira export with quality pre-check |
| `compare_ui_baseline` + `compare_ui_surface_to_baseline` | Regression visual/structural diff |

Full tool catalog: [`hosts/README.md`](hosts/README.md)

## Requirements

- Node.js `>=24 <25` (see `.nvmrc`)
- npm
- Playwright browsers installed automatically via `npm install`

## Project status

`0.1.0-dev` — development only. The MCP server runs today against real targets.
Production deployment (OIDC auth, governed membership, Vault) is blocked on
GOV-012 G2–G6. See [`docs/GUIDE.md`](docs/GUIDE.md) for what's live vs. pending.

## Repository structure

```
src/           TypeScript source
  adapters/    Playwright execution engine
  discovery/   UI surface + workflow discovery
  test-design/ Test generation + run_auto_qa pipeline
  reporting/   HTML report + coverage gap analysis
  memory/      Session memory + durable learning
  bug-analysis/ Defect drafting + quality assessment
hosts/         MCP integration packages (Claude Code, Cursor, Codex)
  claude-code/skills/dev/   Developer QA workflow
  claude-code/skills/test/  Tester QA workflow
  cursor/                   Cursor-specific configs
  codex/                    Codex-specific configs
docs/          Install guide + proposals
specs/         Governance specifications (SPEC-001 … SPEC-213)
adr/           Architecture decisions (ADR-001 … ADR-023)
```

For governance, spec reading order, and architecture decisions:
see `governance/READING_ORDER.md` and `governance/ARCHITECTURE_PRINCIPLES.md`.
