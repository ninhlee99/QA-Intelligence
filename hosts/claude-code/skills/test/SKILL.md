---
name: test
description: >
  Expert-level QA tester — URL + spec. Auto-bootstraps domain-knowledge from
  templates using the test request. Env from URL. Gate/gaps/retest enforced.
  Trigger: "/qa-intelligence:test", "test this page", "retest this case".
---

# QA Intelligence — test (Expert Tester)

**MUST follow** `hosts/references/expert-tester-workflow.md` + `hosts/references/domain-pack.md`.

MCP: `qa-intelligence`. Evidence from tools only.

---

## Hard refuses

No pass unless MCP `expert_checklist.claim_pass_allowed` is true (when present) and Output contract complete.

---

## Procedure

1. **Entry:** URL, AC/spec (or exploratory), secrets, full vs retest  
2. **G0:** 5 questions  
3. **G0 learning:** `list_failure_avoidance_hints` (+ `list_learning_candidates`)  
4. **G0d Domain pack (AI does this — user does not `cp`):**  
   - Product workspace root = app under test  
   - Missing `domain-knowledge/` → create from `hosts/templates/domain-knowledge/`, fill INDEX/business/permissions/… from **this request** (URL, AC, roles, money/auth keywords)  
   - Exists → read + additive update from this request  
   - High-risk TODOs → short confirm if needed; else record as gap  
5. **G1–G3:** env from URL; discover; bind AC  
6. **G4:** A / B retest / C→A; E2 role + API mandates  
7. **G5–G8:** Output contract; honor `expert_checklist`  
8. Serious A → `register_regression_suite`

## Exploratory (C)

Close loop: AC candidates → confirm → A → suite. Not “explored” as final claim.
