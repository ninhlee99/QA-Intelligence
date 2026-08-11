---
name: test
description: >
  Expert-level QA tester — URL + spec. Env from URL. Enforces gate, coverage
  gaps, domain pack, learning hints, targeted retest. Trigger:
  "/qa-intelligence:test", "test this page", "retest this case", "QA this URL".
---

# QA Intelligence — test (Expert Tester)

**MUST follow** `hosts/references/expert-tester-workflow.md` (Expert bar + G0→G8).  
Domain pack: `hosts/references/domain-pack.md` + templates under `hosts/templates/domain-knowledge/`.

MCP: `qa-intelligence`. Evidence only from tools.

---

## Hard refuses

Do **not** conclude pass / ship / ready unless Expert bar met (gate + gaps + retest plan + suite_id on serious A).  
Missing pieces → **incomplete Expert run** + blockers.

---

## Procedure

1. **Entry:** URL, AC/spec (or exploratory), secrets, full vs retest  
2. **G0:** 5 questions  
3. **G0 learning:** `list_failure_avoidance_hints` (+ `list_learning_candidates`) — state applicability  
4. **G0d:** If `domain-knowledge/` or `.qa-domain/` exists → read before execute; tag money/permission/legacy/pii into gaps later  
5. **G1–G3:** env from URL; discover; bind AC (never invent)  
6. **G4:**  
   - Retest intent → Strategy B + `smart_retest_suggestion` / case_ids / defects / screen  
   - Else Strategy A (or C→confirm→A)  
   - E2: roles → role compare; API → openapi authz negatives + execute  
7. **G5–G8:** Output contract exactly — gate first  
8. Serious A → `register_regression_suite` (required)

## Exploratory (C)

Must end with AC candidates + human confirm path + then A + suite.  
Do not stop at “I explored” as final quality claim.
