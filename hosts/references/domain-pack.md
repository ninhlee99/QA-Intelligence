# Domain knowledge pack (Expert Tester)

Expert automation **without** product rules only checks UI/AC.  
Pack adds money / permission / legacy / PII risks the UI map cannot invent.

**User does not copy templates by hand.** On `/qa-intelligence:test` or `:dev`, the agent **bootstraps** the pack into the **product workspace** (repo under test), then fills what it can from the user's request.

---

## Location (product under test — not the QA-Intelligence repo)

```text
<product-git-root>/
  domain-knowledge/          # preferred
    INDEX.md
    business.md
    permissions.md
    money-flows.md
    legacy.md
    glossary.md
```

Fallback dir name: `.qa-domain/` (same files). Prefer `domain-knowledge/`.

---

## G0d — Agent procedure (mandatory)

1. Resolve **product workspace root** (open project / git root of the app being tested — **not** `QA-Intelligence` unless that is the app).
2. Call MCP **`bootstrap_domain_pack`** with:
   - `product_root` — absolute path
   - `request_context` — URL + AC/ticket/source summary
3. Tool creates missing files from templates and seeds stubs (roles/money/auth keywords). Additive update to `business.md` when pack already exists.
4. Read pack; before G4 every high-risk tag in INDEX → Coverage gaps as tested or not tested
5. Never waive money/permission/legacy silently
6. Prefer tool over host filesystem `cp` of templates

## Template source

`hosts/templates/domain-knowledge/` inside the QA Intelligence plugin/repo (also used by `bootstrap_domain_pack`).

## Per-work / per-request

Each serious test request may **update** the pack (append risks seen from this URL/AC). Do not delete human-confirmed content. Prefer additive edits.

---

## Minimum quality bar (claim-pass readiness)

Before claiming pass on critical flows, pack should contain:

1. **business.md**: key user journeys + expected outcomes/invariants
2. **permissions.md**: role matrix for sensitive actions (allow/deny expectations)
3. **money-flows.md**: monetary/stateful invariants, rounding/currency constraints, side effects
4. **legacy.md**: known compatibility/debt constraints that can break modern flows
5. **INDEX.md**: explicit high-risk tags (`money`, `permission`, `legacy`, `pii`) mapped to tested or gap status

If missing, report as coverage gap; do not silently treat as complete domain coverage.

## Data readiness tie-in (G3.5)

When updating pack for a request, add short note for:

- dataset/source assumptions,
- seed/fixture intent,
- cleanup or rollback expectation,
- oracle observability signal per risky path.

Pack note can be concise, but cannot be omitted for claimable pass decisions.
