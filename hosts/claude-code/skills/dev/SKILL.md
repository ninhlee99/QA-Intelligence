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
3. G0 + learning hints  
4. Prefer `run_expert_qa` with `product_root` = this repo  
5. Honor `flake_taxonomy` + `learning` + domain gate blockers  
6. Before merge-ready wording: `validate_expert_claim`  
7. After fix: targeted retest only  
