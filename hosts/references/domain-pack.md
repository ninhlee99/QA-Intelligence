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
2. If `domain-knowledge/INDEX.md` or `.qa-domain/INDEX.md` exists → **read** (do not overwrite blindly). Merge new risks from this request into files if clearly missing.
3. If **absent** → **bootstrap**:
   - Read templates from QA-Intelligence install: `hosts/templates/domain-knowledge/*`
   - Create `domain-knowledge/` under product root with those files
   - **Fill from this test request** (URL, AC, ticket, source, roles mentioned):
     - Product name, target URL, date
     - Suspected roles → `permissions.md`
     - Money/payment words → tag `money` + stub in `money-flows.md`
     - Auth/admin/permission words → tag `permission`
     - Migration/legacy words → tag `legacy`
     - Open questions → leave as `<!-- TODO: confirm with human -->`
   - Tell user in one short line: pack created; ask confirm only on high-risk TODOs (money/permission) if ambiguous — **do not block** the whole test wait for a full manual fill
4. Before G4: every high-risk tag in INDEX → will appear in Coverage gaps as tested or not tested
5. Never waive money/permission/legacy silently

## Template source

`hosts/templates/domain-knowledge/` inside the QA Intelligence plugin/repo (agent reads + writes into product workspace).

## Per-work / per-request

Each serious test request may **update** the pack (append risks seen from this URL/AC). Do not delete human-confirmed content. Prefer additive edits.
