# Contributing

## Setup

```sh
git clone https://github.com/ninhlee99/QA-Intelligence.git
cd QA-Intelligence
npm install
npm run build
```

Node `>=24 <25` (see `.nvmrc`).

## Commands

```sh
npm run build
npm run typecheck
npm test                 # build + all tests
npm run validate         # typecheck + test + audit
npm run validate:schemas # optional JSON Schema examples
npm run mcp:dev
npm run mcp:remote
```

## Layout

```text
src/                 MCP + Expert QA pipeline
  adapters/playwright/
  discovery/
  test-design/       run_auto_qa, generation, regression
  reporting/         HTML, coverage_gaps, release gate
  bug-analysis/
  memory/            durable avoid:* hints
  mcp/               entrypoints + tool registry
hosts/               Claude Code / Cursor / Codex Skills
tests/
docs/PRODUCT.md      product idea
RULES.md             non-negotiables
archive/             historical SPECs/ADRs (optional reading)
```

## Add an MCP tool

1. Skill in `src/<domain>/`
2. Runtime executor `*-runtime-executor.ts`
3. Register in `src/mcp/dev-fixture.ts` (agent id + tool definition)
4. Add name to `tests/mcp/tool-catalog.smoke.test.ts`
5. Document in `hosts/README.md`

## Rules

Read **[RULES.md](RULES.md)** before changing agent behavior.

## Code style

- TypeScript strict — no `any`
- Private fields: `#field`
- Prefer `Readonly<>` / `readonly` arrays
- Pure functions stay I/O-free; side effects in executors
- Tests run against `dist/` (`npm test` builds first)
