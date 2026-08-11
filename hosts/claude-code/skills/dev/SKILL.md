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
4. **G0d:** `bootstrap_domain_pack` on this product repo (`product_root` + request/source context)  
5. Prefer `run_expert_qa` with `product_root` = this repo (or `bootstrap_domain_pack` + `run_auto_qa`). Suite auto-registers — use `suite_id`. Pass `role_b` / `openapi` / `include_workflow_journeys` when E2 applies. Read `flake_taxonomy` + `learning`.  
6. Output contract — `Command: dev`  
7. After fix: targeted retest only  
