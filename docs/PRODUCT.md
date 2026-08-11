# QA Intelligence — Product Idea (one page)

## What it is

An **Expert-shaped QA agent**: Skills enforce professional discipline; MCP supplies **evidence** (discover → risk-based cases → execute → gate → gaps → targeted retest).

Commands: `/qa-intelligence:test` | `/qa-intelligence:dev`  
Environment = **URL** you pass (local or staging).

## Level claim (honest)

| Claim | Status |
|-------|--------|
| Expert **process** (G0–G8, refuse green-wash, targeted retest) | Yes — Skills + MCP outputs |
| Expert **scoped** UI/AC/API with domain pack | Target — pack in `domain-knowledge/` required for business rules |
| Replace human Expert / release accountability | **No** — human signs off; pen-test & novel domain stay human |

## What it is not

- Not a recorder / script dump  
- Not full WCAG / load / pen-test  
- Not inventing root cause or AC  
- Not production SaaS IdP yet (`0.1.0-dev`)

## Mental model

```
Host → :test | :dev Skill (Expert bar)
    → domain pack + learning hints (G0)
    → MCP tools (evidence)
    → Output contract (gate → gaps → retest → suite_id)
    → Human accountable for release
```

## Expert upgrades built in

1. **Refuse pass** without gate + coverage gaps + retest plan  
2. **Domain pack** — agent **auto-creates/updates** `domain-knowledge/` in the product workspace from templates + the test request (user does not `cp` by hand)  
3. **Learning hints** listed before execute  
4. **E2 mandates:** roles → compare; OpenAPI → authz negatives  
5. **Explore must close loop** → AC confirm → full run → suite  
6. **Retest** by case / defect / screen — not whole world  

## Who uses it

| Role | Command | Intent |
|------|---------|--------|
| Tester | `:test` | Spec + URL → Expert result |
| Developer | `:dev` | Source AC + URL → same bar |

## Where next

- Workflow: [`../hosts/references/expert-tester-workflow.md`](../hosts/references/expert-tester-workflow.md)  
- Domain pack: [`../hosts/references/domain-pack.md`](../hosts/references/domain-pack.md)  
- Install: [`GUIDE.md`](GUIDE.md) · Rules: [`../RULES.md`](../RULES.md)
