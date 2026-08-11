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
4. **G0d Domain pack:** call `bootstrap_domain_pack` with absolute `product_root` + `request_context` (URL/AC). Do **not** ask user to `cp` templates.  
5. **G1–G3:** env from URL; discover; bind AC  
6. **G4 Strategy A:** Prefer `run_expert_qa` when product workspace path known (domain pack + auto QA + suite). Else `bootstrap_domain_pack` then `run_auto_qa`. Use returned `auto_registered_suite.suite_id`; do **not** re-call `register_regression_suite` when suite_id present. Optional: `role_b`, `openapi`/`openapi_path`, `include_workflow_journeys`. Honor `flake_taxonomy` + `learning` in output.  
7. **G4 B:** targeted retest via `run_regression_suite` + `smart_retest_suggestion`  
8. **G5–G8:** Output contract; honor `expert_checklist`  

## Exploratory (C)

Close loop: AC candidates → confirm → A → suite. Not “explored” as final claim.
