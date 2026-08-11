# QA Intelligence — Product Idea (one page)

## What it is

An **MCP server** that turns Claude Code / Cursor / Codex into an **Expert QA Engineer**.

You give: a **URL** + a **spec** (or source for local).  
It returns: **evidence-backed test results**, **draft defects**, and a **release gate** — not a green pass count.

## What it is not

- Not a Playwright recorder / script dump
- Not a full WCAG / load / pen-test platform
- Not an auto-filer that invents root cause
- Not production SaaS yet (`0.1.0-dev`; GOV-012 still blocks prod)

## Mental model

```
Host (Claude / Cursor / Codex)
  → Skills (/qa-intelligence:test | :dev)
  → MCP tools (discover → generate → execute → report)
  → Agent Runtime (authority: versions, evidence, no fake pass)
```

Core loop:

1. **Discover** live UI (semantic names, not CSS selectors)
2. **Design** risk-based cases (positive / negative / boundary / adversarial)
3. **Execute** with Playwright (flake-aware; screenshot + trace on fail)
4. **Judge** with release recommendation + coverage gaps + smart retest subset
5. **Learn** durable avoidance hints (never silent promote)

## Non-negotiables

- No fabricated pass when gate says otherwise
- No `confirmed_cause` invented by the pipeline
- Unbound AC / not_executed never counted as pass
- Scope honesty: naming smoke ≠ WCAG; API smoke ≠ full authz matrix

## Who uses it

| Role | Trigger | Intent |
|------|---------|--------|
| Tester | `/qa-intelligence:test` | Spec + URL → gate + defects |
| Developer | `/qa-intelligence:dev` | Code → AC → localhost QA before push |

## Where to go next

- Install: [`GUIDE.md`](GUIDE.md)
- Rules: [`../RULES.md`](../RULES.md)
- Tools: [`../hosts/README.md`](../hosts/README.md)
- History (optional): [`../archive/`](../archive/)
