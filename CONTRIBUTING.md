# Contributing to QA Intelligence

## Prerequisites

- Node.js `>=24 <25` (use `nvm use` with the repo's `.nvmrc`)
- npm

## Setup

```sh
git clone <repo-url> QA-Intelligence
cd QA-Intelligence
npm install
npm run build
```

## Development commands

```sh
npm run build          # compile TypeScript → dist/
npm run typecheck      # type-check only, no emit
npm test               # build + run all tests
npm run validate       # full gate: governance + schemas + typecheck + test + audit
npm run mcp:dev        # start local stdio MCP server
npm run mcp:remote     # start remote HTTP MCP server (prints token to stderr)
```

## Running tests

```sh
npm test                          # all tests
node --test dist/tests/path/to/specific.test.js   # one file
```

Tests run against compiled `dist/` — always `npm run build` first or use `npm test` which builds automatically.

## Project structure

```
src/
  adapters/playwright/     Playwright execution engine (browser interaction, traces)
  api-testing/             HTTP API smoke testing
  bug-analysis/            Defect drafting, quality assessment, evidence pack
  candidate-repository/    Learning candidate storage (in-memory + file-backed)
  credentials/             Workspace credential registry
  depth-smokes/            a11y / perf / security heuristic checks
  discovery/               UI surface discovery, workflow crawl, baselines
  environments/            Workspace environment allowlist
  execution/               ExecuteBrowserTest (demo path)
  knowledge/               Knowledge Store, file-backed search
  learning-engine/         Mistake recurrence tracker, candidate raising
  mcp/                     MCP server entrypoints, dev-fixture, tool registry
  memory/                  Session memory (durable avoidance hints)
  reporting/               HTML report, coverage gap analysis, professional QA analysis
  requirement-review/      Requirement quality assessment
  test-design/             Test case generation, run_auto_qa pipeline, regression suites
  visual-testing/          PNG baseline capture + comparison
tests/
  adapters/                Playwright engine tests
  bug-analysis/            Defect drafting tests
  discovery/               UI surface tests
  mcp/                     MCP tool catalog smoke tests, integration tests
  memory/                  Durable learning restart tests
  visual-testing/          PNG baseline tests
hosts/
  claude-code/             Claude Code plugin + Skills
  cursor/                  Cursor MCP config examples + Skills
  codex/                   Codex plugin + Skills
```

## Adding a new MCP tool

1. Implement the Skill in `src/<domain>/`.
2. Create a Runtime Executor in `src/<domain>/<skill>-runtime-executor.ts`.
3. Register in `src/mcp/dev-fixture.ts` — add agent/skill constants, executor map entry, and tool definition.
4. Add to `tests/mcp/tool-catalog.smoke.test.ts` `EXPECTED_TOOLS` array.
5. Document in `hosts/README.md` tool catalog.

Follow the `CompositeAgentRunExecutor` pattern — every tool is keyed by a unique agent `id`.

## Key invariants (never break these)

- **No fabricated passes.** `release_recommendation` must reflect actual outcomes.
- **No invented root cause.** `confirmed_cause` is never set by the pipeline — only `suspected_cause`.
- **No silent AC drops.** Unbindable AC must appear in `generation_findings`, not be silently ignored.
- **Evidence required.** Every defect draft must carry screenshot or trace path.
- **Deterministic rules first** (ADR-002). LLM reasoning only where rules can't decide.

## Code conventions

- TypeScript strict mode — no `any`, no `as unknown as`.
- Private fields via `#field` (not `_field` or `private`).
- Immutable types via `Readonly<>` and `readonly` arrays.
- No I/O in pure functions — side effects only in runtime executors or entrypoints.
- Tests against compiled `dist/` (not `ts-node`) — keeps CI and local identical.

## Governance

This project uses a formal spec+ADR governance model. New architecture decisions require an ADR. New domain concepts require a SPEC update. See `governance/ARCHITECTURE_PRINCIPLES.md` and `SPEC-007`.

Production enablement requires GOV-012 G2–G6. Current status: `0.1.0-dev`.
