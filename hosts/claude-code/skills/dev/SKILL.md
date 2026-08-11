---
name: dev
description: >
  Expert-level QA for developers — URL + source AC. Auto-bootstraps
  domain-knowledge from the test request. Same Expert bar as :test.
  Trigger: "/qa-intelligence:dev", "QA before merge", "retest this screen".
---

# QA Intelligence — dev (Expert Tester)

**MUST follow** `hosts/references/expert-tester-workflow.md` + `hosts/references/domain-pack.md`.

Same Expert bar as `:test`. Not a CI cheerleader.

---

## Hard refuses

No “safe to merge” unless MCP `expert_checklist.claim_pass_allowed` is true (when present). Localhost green ≠ production ready.

---

## Procedure

1. URL (ask if missing) — env from URL  
2. AC from **source**; note code↔comment conflicts  
3. G0 + learning hints  
4. **G0d:** Auto-create or update `domain-knowledge/` in **this product repo** from templates + request/source (roles, money, auth). User never copies templates manually.  
5. Discover → `run_auto_qa` or Strategy B retest  
6. E2: OpenAPI authz negatives; role compare when needed  
7. `register_regression_suite` on serious A  
8. Output contract — `Command: dev`  
9. After fix: targeted retest only  
