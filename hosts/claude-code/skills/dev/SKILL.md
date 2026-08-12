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

No “safe to merge” unless `expert_checklist.claim_pass_allowed` **and** `validate_expert_claim.allowed`. Localhost green ≠ production ready. Human release_signoff still required.

---

## Procedure

1. URL (ask if missing) — env from URL  
2. AC from **source**; note code↔comment conflicts  
3. **Discover first** (`discover_ui_surface_after_login` when gated) — rewrite AC so each
   criterion mentions real `accessible_name` + action + oracle (see workflow G2→G3).
   Business-logic-only AC → push back; do not expect MCP to invent fill/click.  
4. G0 + learning hints  
5. Prefer `run_expert_qa` with `product_root` = this repo  
6. Honor `flake_taxonomy` + `learning` + domain gate blockers  
7. Before merge-ready wording: `validate_expert_claim`  
8. After fix: targeted retest only  
