# Domain knowledge pack (Expert Tester)

Expert automation **without** product rules only checks UI/AC.  
Pack adds money / permission / legacy / PII risks the UI map cannot invent.

## Where to put it (project under test)

```text
domain-knowledge/          # preferred
  INDEX.md
  business.md
  permissions.md
  money-flows.md           # optional
  legacy.md                # optional
  glossary.md              # optional
```

Or: `.qa-domain/` with the same files.

Copy starters from `hosts/templates/domain-knowledge/`.

## INDEX.md rules

- List domains covered / not covered  
- Tag high-risk rows: `money` | `permission` | `legacy` | `pii`  
- Link files the agent must read for this product  

## How Skills use it

Before G4 execute:

1. If pack exists → read INDEX + relevant files (G0d)  
2. Every high-risk tag → appear in final **Coverage gaps** as tested or not tested  
3. Never waive money/permission/legacy without human PM note in the result  

## Absent pack

Agent states limitation and continues on AC-only — **not** Expert-complete for business rules.
